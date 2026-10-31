import { randomUUID } from 'node:crypto';
import { createResearchBrief, missingResearchFields, businessById } from '../src/businesses.js';
import { researchCatalog, competitors, costs, pipelineStages } from './catalog.js';
import { addActivity, AppError, digest, now } from './store.js';
import { checkMx, reviewCandidate } from './evidence.js';
import { createModelProvider } from './model.js';
import { localIntake, validIntakeValue } from './intake.js';
import { billingSummary } from './billing.js';
import { analyzePipeline } from '../src/pipeline-metrics.js';
import { createOutcomeReporter, markOutcomeProjection } from './outcomes.js';

export const profileKeys = ['company', 'productFamilies', 'capabilities', 'commercial', 'icp', 'expansionDecisions'];
export const profileDigest = s => digest(Object.fromEntries(profileKeys.map(k => [k, s[k]])));
const findLead = (s, id) => { const lead = s.leads.find(l => l.id === id); if (!lead) throw new AppError(404, 'Account not found in this business.', 'lead_not_found'); return lead; };
const findDraft = (s, id) => { const d = s.drafts.find(d => d.id === id); if (!d) throw new AppError(404, 'Draft not found in this business.', 'draft_not_found'); return d; };
export function exclusionReason(lead, state) {
  if (!/united states|\busa?\b/i.test(state.icp.regions) || lead.country !== 'United States') return 'Outside the currently supported US research collection.';
  if (!state.icp.segments.some(s => /OEM|manufacturer/i.test(s))) return 'The current research collection supports equipment OEM campaigns only.';
  if (!state.productFamilies.includes(lead.productFamily)) return 'Relevant product family is not selected in this campaign.';
  const domains = (state.icp.excludedDomains || '').split(/[\s,;]+/).map(d => d.toLowerCase().replace(/^www\./, '')).filter(Boolean);
  if (domains.includes(lead.domain.replace(/^www\./, ''))) return 'Excluded company domain in customer profile.';
  return null;
}
const requireEligible = (lead, state) => { const reason = exclusionReason(lead, state); if (reason) throw new AppError(409, reason, 'account_excluded'); };

export function metrics(state, { asOf } = {}) {
  const reached = stage => state.leads.filter(l => l.events.some(e => e.stage === stage)).length;
  const contacted = reached('Contacted'); const replied = reached('Replied'); const meetings = reached('Meeting booked');
  const groups = new Map();
  for (const l of state.leads) {
    const key = `${l.industry}|${l.fit.tier}`; const group = groups.get(key) || { industry: l.industry, tier: l.fit.tier, total: 0, contacted: 0, replied: 0, meetings: 0 };
    group.total++; if (l.events.some(e => e.stage === 'Contacted')) group.contacted++; if (l.events.some(e => e.stage === 'Replied')) group.replied++; if (l.events.some(e => e.stage === 'Meeting booked')) group.meetings++; groups.set(key, group);
  }
  const analytics = analyzePipeline(state, { asOf });
  const experiments = ['A', 'B'].map(variant => {
    const groups = analytics.experiments.filter(group => group.variant === variant);
    const drafts = [...new Map(state.drafts.filter(draft => groups.some(group => group.draftIds.includes(draft.id))).map(draft => [draft.id, draft])).values()];
    const recipients = new Set(drafts.map(draft => draft.leadId));
    const linkedReplies = new Set(analytics.records.filter(record => record.events.some(event => event.stage === 'Replied' && drafts.some(draft => draft.id === event.draftId && draft.leadId === record.id && Date.parse(event.at) >= Date.parse(draft.sentAt)))).map(record => record.id));
    return { variant, sent: drafts.length, recipients: recipients.size, responses: linkedReplies.size, replyRate: recipients.size ? linkedReplies.size / recipients.size : null, attribution: 'Explicit same-account draft link only' };
  });
  return { accounts: state.leads.length, selected: state.leads.filter(l => l.selected).length, contacted, replied, meetings,
    qualifiedRfqs: reached('RFQ received'), quotes: reached('Quote sent'), won: reached('Closed won'),
    replyRate: analytics.reach.find(row => row.stage === 'Replied').rate, meetingRate: analytics.reach.find(row => row.stage === 'Meeting booked').rate,
    liveAccepted: state.drafts.filter(d => d.status === 'accepted').length, simulated: state.drafts.filter(d => d.status === 'simulated').length,
    stages: pipelineStages.map(stage => ({ stage, current: state.leads.filter(l => l.stage === stage).length, reached: reached(stage) })),
    segments: [...groups.values()], experiments,
    caveat: 'Stage transitions are attributed to their recorded actor. Simulated outreach is separately identified and is not a delivered message. Conversion rates use the same recorded-contact cohort and require outcomes after contact. A/B comparisons require explicit reply-to-draft links and are descriptive, not causal.' };
}

export function createService({ store, graph, review = reviewCandidate, mx = checkMx, model = createModelProvider() }) {
  const snapshot = id => { const s = store.read(id); return { ...s, billing: billingSummary(s), assistantRuns: (s.assistantRuns || []).map(r => ({ ...r, applicable: r.profileHash === profileDigest(s) })), assistant: model.status(), competitors: competitors[id], metrics: metrics(s), researchBrief: createResearchBrief(s) }; };
  const recordOutcome = createOutcomeReporter({ store, graph, competitors, snapshot });
  const updateProfile = (s, incoming) => {
    const before = profileDigest(s);
    const previousIcp = structuredClone(s.icp);
    const supplierHash = value => digest({ company: value.company, products: value.productFamilies, capabilities: value.capabilities, commercial: value.commercial });
    const previousSupplier = supplierHash(s);
    for (const key of profileKeys) if (incoming[key] !== undefined) s[key] = incoming[key];
    if (before !== profileDigest(s)) {
      s.approved = false; s.approvedAt = null;
      for (const draft of s.drafts) if (!['accepted', 'simulated', 'dispatching'].includes(draft.status)) { draft.approvedHash = null; draft.status = 'draft'; }
      for (const lead of s.leads) { lead.excludedReason = exclusionReason(lead, s); if (lead.excludedReason) lead.selected = false; }
      for (const field of Object.keys(s.assistantFieldProvenance || {})) if (JSON.stringify(previousIcp[field]) !== JSON.stringify(s.icp[field]) || (s.assistantFieldProvenance[field].basis === 'catalog_hypothesis' && previousSupplier !== supplierHash(s))) delete s.assistantFieldProvenance[field];
      addActivity(s, 'Profile updated', 'Research and unsent-message approvals cleared because campaign context changed.');
    }
    s.profileImported = true;
  };
  const saveProfile = (id, incoming, revision) => store.mutate(id, s => updateProfile(s, incoming), revision).state;

  const beginAssistant = (id, kind, requestId, payload, mode, revision) => {
    const initial = store.read(id); const requestHash = digest({ kind, payload, mode, profileHash: profileDigest(initial) });
    const previous = initial.assistantRuns?.find(r => r.id === requestId);
    if (previous) {
      if (previous.requestHash !== requestHash) throw new AppError(409, 'This request ID belongs to different input or profile context.', 'request_id_conflict');
      if (previous.status === 'running') throw new AppError(409, 'This request is already running. Wait for its result.', 'request_in_progress');
      if (previous.status === 'failed') throw new AppError(409, 'This attempt failed. Review the error before explicitly starting a new request.', 'request_already_failed');
      return { previous };
    }
    if (initial.revision !== revision) throw new AppError(409, 'This workspace changed. Reload before requesting assistant processing.', 'revision_conflict');
    if (initial.assistantRuns?.some(r => r.status === 'running')) throw new AppError(409, 'An assistant request is already running for this business.', 'assistant_busy');
    if (mode === 'model') model.requireConfigured();
    const reservation = mode === 'model' ? store.reserve(id, 'inference', costs.inference, payload.leadId) : null;
    const run = { id: requestId, kind, mode, requestHash, profileHash: profileDigest(initial), status: 'running', startedAt: now(), reservation };
    store.mutate(id, s => { s.assistantRuns ||= []; s.assistantRuns.unshift(run); addActivity(s, `${kind === 'intake' ? 'ICP' : 'Draft'} assistant started`, mode === 'model' ? 'Explicitly requested project model processing. No approval or message delivery is authorized.' : 'Local extraction only; no external model request.', mode === 'model' ? 'Model assistant' : 'Local assistant'); });
    return { initial, run };
  };
  const failAssistant = (id, run, error) => {
    if (run.reservation) store.settle(id, run.reservation, false);
    store.mutate(id, s => { const current = s.assistantRuns.find(r => r.id === run.id); current.status = 'failed'; current.error = error instanceof AppError ? error.message : 'Assistant processing failed. No proposal was applied.'; current.errorCode = error.code || 'assistant_failed'; current.completedAt = now(); current.providerUsage = error.providerUsage || null; if (run.reservation) { const entry = s.wallet.ledger.find(e => e.id === run.reservation); entry.providerUsage = error.providerUsage || null; entry.providerBilling = 'Local credit refund does not establish a provider refund.'; } addActivity(s, 'Assistant request failed', current.error, 'Reviewer'); });
  };
  const finishAssistant = (id, run, result, metadata, applyResult) => {
    store.mutate(id, s => {
      if (profileDigest(s) !== run.profileHash) throw new AppError(409, 'The profile changed while the assistant was working. Results were not applied.', 'stale_assistant_context');
      const current = s.assistantRuns.find(r => r.id === run.id);
      current.result = result; current.metadata = metadata; current.status = 'completed'; current.completedAt = now();
      if (applyResult) applyResult(s, current);
      if (run.reservation) { const entry = s.wallet.ledger.find(e => e.id === run.reservation); entry.providerUsage = metadata?.usage || null; entry.status = 'consumed'; }
      addActivity(s, 'Assistant proposal ready', 'Review the proposed fields or draft. Research and message approval still require separate explicit review.', 'Reviewer');
    });
  };
  const inferProfile = async (id, { message, mode = 'local', requestId, acknowledgedExternalProcessing = false, revision }) => {
    if (mode === 'model' && !acknowledgedExternalProcessing) throw new AppError(400, 'Confirm sending this business’s profile and input to the project model.', 'external_processing_review_required');
    const started = beginAssistant(id, 'intake', requestId, { message }, mode, revision);
    if (started.previous) return { ...snapshot(id), activeAssistantRunId: started.previous.id };
    const { initial, run } = started;
    let generated;
    try {
      generated = mode === 'local' ? { value: localIntake(message), metadata: { provider: 'Local rules', usage: null } } : await model.intake({ message, profile: createResearchBrief(initial), sources: businessById(id).sources, requestId });
      finishAssistant(id, run, generated.value, generated.metadata);
      return { ...snapshot(id), activeAssistantRunId: run.id };
    } catch (error) { error.providerUsage ||= generated?.metadata?.usage; failAssistant(id, run, error); throw error; }
  };
  const reviewIntake = (id, runId, { decisions, acknowledged, revision }) => {
    if (!acknowledged) throw new AppError(400, 'Review the proposed field changes first.', 'review_required');
    store.mutate(id, s => {
      const run = s.assistantRuns?.find(r => r.id === runId && r.kind === 'intake');
      if (!run || run.status !== 'completed') throw new AppError(404, 'Completed intake proposal not found in this business.', 'proposal_not_found');
      if (run.reviewedAt) throw new AppError(409, 'This proposal has already been reviewed.', 'proposal_already_reviewed');
      if (profileDigest(s) !== run.profileHash) throw new AppError(409, 'The profile changed. Request a new proposal before applying suggestions.', 'stale_assistant_context');
      const fields = new Set(); const icp = { ...s.icp }; const accepted = [];
      for (const d of decisions) {
        const suggestion = run.result.suggestions.find(p => p.field === d.field);
        if (!suggestion || fields.has(d.field)) throw new AppError(400, 'Review only unique fields from this proposal.', 'invalid_proposal_field');
        fields.add(d.field);
        if (d.decision === 'dismissed') continue;
        const value = d.decision === 'accepted' ? suggestion.value : d.value;
        if (!validIntakeValue(d.field, value)) throw new AppError(400, 'An adjusted field has an invalid value.', 'invalid_proposal_value');
        icp[d.field] = value; accepted.push({ ...suggestion, value, decision: d.decision });
      }
      if (fields.size !== run.result.suggestions.length) throw new AppError(400, 'Accept, adjust, or dismiss every suggested field.', 'incomplete_proposal_review');
      updateProfile(s, { icp }); s.assistantFieldProvenance ||= {};
      for (const field of accepted) s.assistantFieldProvenance[field.field] = { ...field, confidence: field.decision === 'adjusted' ? 1 : field.confidence, basis: field.decision === 'adjusted' ? 'Owner-adjusted target' : field.basis, method: run.mode === 'model' ? 'Uncalibrated model suggestion reviewed by owner' : 'Explicit local extraction reviewed by owner', runId, reviewedAt: now() };
      run.decisions = decisions; run.reviewedAt = now(); run.acceptedFields = accepted.map(f => f.field);
      addActivity(s, 'ICP suggestions reviewed', `${accepted.length} accepted or adjusted; ${decisions.length - accepted.length} dismissed. Any profile changes revoke prior research and unsent-message approvals.`, 'You');
    }, revision);
    return snapshot(id);
  };
  const approveProfile = (id, acknowledged, revision) => store.mutate(id, s => {
    if (!acknowledged) throw new AppError(400, 'Confirm the customer profile review first.', 'review_required');
    const missing = missingResearchFields(s); if (missing.length) throw new AppError(400, `Complete: ${missing.join(', ')}.`, 'profile_incomplete');
    s.approved = true; s.approvedAt = now(); s.approvedProfileHash = profileDigest(s);
    addActivity(s, 'Customer profile approved', 'Approved for prospect research. Technical compatibility and commercial terms remain subject to review.');
  }, revision).state;

  const startDiscovery = id => {
    const initial = store.read(id);
    if (!initial.approved) throw new AppError(409, 'Approve this business’s customer profile first.', 'profile_approval_required');
    const running = initial.jobs.find(j => j.status === 'running');
    if (running) return running;
    const reservation = store.reserve(id, 'discovery', costs.discovery);
    const job = { id: randomUUID(), status: 'running', startedAt: now(), profileHash: profileDigest(initial), steps: [], reservation };
    store.mutate(id, s => { s.jobs.unshift(job); s.jobs = s.jobs.slice(0, 20); addActivity(s, 'Discovery started', 'Reviewing primary company pages and checking target geography.', 'Planner'); });
    const step = (actor, summary) => store.mutate(id, s => { const j = s.jobs.find(x => x.id === job.id); j.steps.push({ actor, summary, at: now() }); addActivity(s, `${actor} handoff`, summary, actor); });
    const completion = (async () => {
      try {
        step('Planner', `Scope: ${initial.company.name}; ${initial.icp.regions}; ${initial.icp.segments.join(', ')}. Only this business’s sources and contacts will be used.`);
        let candidates = researchCatalog.filter(c => c.businesses.includes(id));
        const excluded = [];
        candidates = candidates.filter(c => {
          const reason = exclusionReason(c, initial);
          if (reason) excluded.push({ name: c.name, reason }); return !reason;
        });
        step('Builder', `Fetching up to ${candidates.length} real candidate accounts. These are research starting points; no RFQ or supplier opening is assumed.`);
        const results = [];
        for (const candidate of candidates) results.push(await review(candidate, initial));
        step('Reviewer', `${results.length} candidates have inline primary sources. Company size, named buying authority, mailbox deliverability, and purchase intent remain unknown unless separately verified.`);
        step('Security reviewer', 'Allowlisted HTTPS sources only. Private destinations, unsupported redirects, and oversized pages are blocked. No outbound message was queued.');
        store.mutate(id, s => {
          if (!s.approved || profileDigest(s) !== job.profileHash) throw new AppError(409, 'Profile changed while research was running. Results were not applied.', 'stale_research');
          for (const lead of results) {
            const existing = s.leads.find(l => l.id === lead.id);
            if (existing) Object.assign(existing, lead, { excludedReason: null, selected: existing.selected, stage: existing.stage, events: existing.events, contact: existing.contact });
            else s.leads.push(lead);
          }
          const j = s.jobs.find(x => x.id === job.id); j.status = 'completed'; j.completedAt = now(); j.excluded = excluded;
          addActivity(s, 'Discovery completed', `${results.length} real accounts reviewed. ${excluded.length} excluded by geography / collection scope.`, 'Research agent');
        });
        await graph.sync(store.read(id), competitors[id]);
        store.settle(id, reservation, true);
      } catch (error) {
        store.settle(id, reservation, false);
        store.mutate(id, s => { const j = s.jobs.find(x => x.id === job.id); j.status = 'failed'; j.error = error.message; j.completedAt = now(); addActivity(s, 'Discovery needs attention', error.message, 'Reviewer'); });
      }
    })();
    // Keep an observable promise for shutdown/tests; never restart a running job from a UI poll.
    job.completion = completion;
    return job;
  };

  const selectLead = (id, leadId, selected) => store.mutate(id, s => { const l = findLead(s, leadId); if (selected) requireEligible(l, s); l.selected = selected; addActivity(s, selected ? 'Account shortlisted' : 'Account removed from shortlist', l.name); }).state;
  const enrich = async (id, leadId) => {
    const initial = store.read(id); const lead = findLead(initial, leadId);
    requireEligible(lead, initial);
    if (!initial.approved) throw new AppError(409, 'Customer profile approval is required.', 'profile_approval_required');
    const reservation = store.reserve(id, 'enrichment', costs.enrichment, leadId);
    try {
      const result = lead.publicEmail ? await mx(lead.publicEmail) : { status: 'not_available', records: [] };
      store.mutate(id, s => {
        const current = findLead(s, leadId);
        current.contact = { ...current.contact, mxStatus: result.status, mxRecords: result.records, checkedAt: now(), mailboxStatus: 'unverified', verificationProvider: 'Public source + DNS MX', enrichmentNote: 'DNS mail routing does not verify this mailbox or identify a purchasing decision-maker. Configure a vendor for deliverability verification.' };
        addActivity(s, 'Contact research checked', `${lead.name}: ${lead.publicEmail ? 'published company address; MX ' + result.status : 'no public email established'}. Mailbox remains unverified.`, 'Enrichment agent');
      });
      store.settle(id, reservation, true); return snapshot(id);
    } catch (error) { store.settle(id, reservation, false); throw error; }
  };

  const draft = (id, leadId, channel = 'email', variant = 'A', sequenceStep = 0) => store.mutate(id, s => {
    if (!s.approved) throw new AppError(409, 'Approve the current profile before drafting.', 'profile_approval_required');
    const lead = findLead(s, leadId); if (!lead.selected) throw new AppError(409, 'Shortlist the account first.', 'shortlist_required');
    requireEligible(lead, s);
    const existing = s.drafts.find(d => !d.modelMetadata && d.leadId === leadId && d.channel === channel && d.variant === variant && d.sequenceStep === sequenceStep && d.profileHash === profileDigest(s));
    if (existing) return existing.id;
    const product = id === 'allco' ? 'custom hydraulic cylinders' : 'wear-resistant castings';
    const greeting = `Hello ${lead.name} engineering and sourcing team,`;
    const value = variant === 'A' ? `I saw your ${lead.application.toLowerCase()} portfolio [1]. ${s.company.name} supplies ${product} [2].` : `Could you help us understand your supplier qualification process for ${product}? Your ${lead.application.toLowerCase()} portfolio appears relevant to our initial research [1].`;
    const ask = 'If there is a suitable application, could we review your qualification requirements and, where appropriate, a drawing, specification, and expected quantity?';
    const caveat = 'Any compatibility, pricing, and delivery proposal would follow technical review.';
    const body = channel === 'linkedin' ? `${greeting}\n\n${value}\n\n${sequenceStep ? 'Following up on the introduction below. ' : ''}${ask}\n\n${caveat}` : `${greeting}\n\n${sequenceStep ? 'Following up on our supplier introduction.\n\n' : ''}${value}\n\n${ask}\n\n${caveat}\n\nBest,\n${s.company.name}\n\n[1] ${lead.source}\n[2] ${s.company.website}`;
    const d = { id: randomUUID(), businessId: id, leadId, channel, variant, sequenceStep, suggestedDay: [0, 3, 7][sequenceStep],
      recipient: channel === 'email' ? lead.contact.email || '' : lead.contact.linkedIn || '',
      subject: `${sequenceStep ? 'Follow-up: ' : ''}${product} — supplier qualification`, body,
      profileHash: profileDigest(s), status: 'draft', version: 1, approvedHash: null, createdAt: now(),
      generation: 'Source-grounded template; no model used', sources: [lead.source, s.company.website], actor: 'Drafting agent' };
    s.drafts.unshift(d); addActivity(s, 'Outreach draft prepared', `${lead.name}; ${channel}; variant ${variant}; step ${sequenceStep + 1}. Human review required.`, 'Drafting agent'); return d.id;
  }).result;

  const draftWithModel = async (id, leadId, { channel = 'email', variant = 'A', sequenceStep = 0, requestId, acknowledgedExternalProcessing = false, revision }) => {
    if (!acknowledgedExternalProcessing) throw new AppError(400, 'Confirm sending the supplier profile and this account’s public evidence to the project model.', 'external_processing_review_required');
    const before = store.read(id); const account = findLead(before, leadId);
    if (!before.approved || !account.selected) throw new AppError(409, 'Approve the profile and shortlist this account first.', 'profile_approval_required');
    requireEligible(account, before);
    const started = beginAssistant(id, 'draft', requestId, { leadId, channel, variant, sequenceStep }, 'model', revision);
    if (started.previous) return { ...snapshot(id), activeDraftId: started.previous.draftId };
    const { initial, run } = started;
    let generated;
    try {
      const sources = [...new Set([account.source, account.contactSource, account.signal.source, ...account.people.map(p => p.source), initial.company.website])];
      const context = { supplier: createResearchBrief(initial), account: { name: account.name, application: account.application, facts: account.facts, source: account.source, signal: account.signal, people: account.people.map(p => ({ name: p.name, role: p.role, relevance: p.relevance, source: p.source })), qualification: 'No current RFQ, buying authority, or purchase intent confirmed.' }, channel, variant, sequenceStep };
      generated = await model.draft({ context, sources, requestId });
      finishAssistant(id, run, generated.value, generated.metadata, (s, currentRun) => {
        const lead = findLead(s, leadId); requireEligible(lead, s);
        if (!s.approved || !lead.selected) throw new AppError(409, 'Account or profile approval changed during generation.', 'stale_assistant_context');
        const d = { id: randomUUID(), businessId: id, leadId, channel, variant, sequenceStep, suggestedDay: [0, 3, 7][sequenceStep], recipient: channel === 'email' ? lead.contact.email || '' : lead.contact.linkedIn || '',
          subject: generated.value.subject, body: generated.value.body, claims: generated.value.claims, qualificationQuestions: generated.value.qualificationQuestions,
          profileHash: profileDigest(s), status: 'draft', version: 1, approvedHash: null, createdAt: now(), generation: `OpenAI / ${generated.metadata.model}; human review required`, sources: [...new Set(generated.value.claims.map(c => c.sourceUrl))], actor: 'Model drafting agent', modelMetadata: generated.metadata, assistantRunId: run.id };
        s.drafts.unshift(d); currentRun.draftId = d.id;
      });
      return { ...snapshot(id), activeDraftId: store.read(id).assistantRuns.find(r => r.id === run.id).draftId };
    } catch (error) { error.providerUsage ||= generated?.metadata?.usage; failAssistant(id, run, error); throw error; }
  };

  const editDraft = (id, draftId, patch, expectedVersion) => store.mutate(id, s => {
    const d = findDraft(s, draftId);
    if (expectedVersion !== undefined && d.version !== expectedVersion) throw new AppError(409, 'This draft changed in another session. Reload it before editing.', 'stale_draft');
    if (['accepted', 'simulated', 'dispatching', 'delivery_unknown'].includes(d.status)) throw new AppError(409, 'A dispatched or uncertain-delivery message is immutable.', 'draft_locked');
    for (const key of ['body', 'subject', 'recipient']) if (patch[key] !== undefined) d[key] = patch[key];
    d.version++; d.approvedHash = null; d.status = 'draft'; d.approvedAt = null;
    addActivity(s, 'Draft edited', 'Previous approval revoked. Review the exact recipient, subject, and message again.');
  }).state;
  const messageHash = d => digest({ body: d.body, subject: d.subject, recipient: d.recipient, version: d.version, profileHash: d.profileHash, businessId: d.businessId, channel: d.channel, sequenceStep: d.sequenceStep });
  const approveDraft = (id, draftId, acknowledged, version) => store.mutate(id, s => {
    const d = findDraft(s, draftId);
    if (!acknowledged || d.version !== version) throw new AppError(409, 'Review the current draft version before approval.', 'stale_draft');
    if (!s.approved || d.profileHash !== profileDigest(s)) throw new AppError(409, 'Draft context changed. Generate a draft from the approved profile.', 'stale_profile');
    if (d.status !== 'draft' && d.status !== 'rejected') throw new AppError(409, 'Only an editable draft can be approved.', 'draft_locked');
    if (!d.body.trim() || (d.channel === 'email' && !d.subject.trim())) throw new AppError(400, 'Message and subject must not be empty.', 'empty_message');
    d.approvedHash = messageHash(d); d.approvedAt = now(); d.status = 'approved';
    addActivity(s, 'Exact message approved', `Recipient, subject, content, channel, and version ${d.version} recorded for ${findLead(s, d.leadId).name}.`, 'You', { draftId });
  }).state;
  const rejectDraft = (id, draftId) => store.mutate(id, s => { const d = findDraft(s, draftId); if (['accepted', 'simulated', 'dispatching'].includes(d.status)) throw new AppError(409, 'Dispatched messages cannot be rejected.', 'draft_locked'); d.status = 'rejected'; d.approvedHash = null; addActivity(s, 'Draft rejected', `Outreach to ${findLead(s, d.leadId).name} remains unsent.`, 'You'); }).state;

  const simulateSend = async (id, draftId) => {
    const result = store.mutate(id, s => {
      const d = findDraft(s, draftId);
      if (d.status === 'simulated') return d.id; // idempotent: no duplicate charge or send
      if (d.status !== 'approved' || !d.approvedHash || d.approvedHash !== messageHash(d)) throw new AppError(409, 'A valid human approval of this exact message is required.', 'approval_required');
      if (!s.approved || d.profileHash !== profileDigest(s)) throw new AppError(409, 'The approved campaign context is stale.', 'stale_profile');
      if (!d.recipient.trim()) throw new AppError(400, 'A recipient is required, even for a dry run. Do not invent an email or LinkedIn profile.', 'recipient_required');
      if (s.drafts.some(other => other.id !== d.id && other.leadId === d.leadId && other.channel === d.channel && other.sequenceStep === d.sequenceStep && ['simulated', 'accepted'].includes(other.status))) throw new AppError(409, 'A variant for this account, channel, and step has already been dispatched.', 'variant_already_sent');
      if (s.wallet.credits < costs.outreach) throw new AppError(402, 'Insufficient credits. No message was dispatched.', 'insufficient_credits');
      const lead = findLead(s, d.leadId);
      requireEligible(lead, s);
      s.wallet.credits -= costs.outreach; s.wallet.ledger.unshift({ id: randomUUID(), kind: 'outreach', leadId: lead.id, credits: costs.outreach, status: 'consumed', externalStatus: 'not_connected', mode: 'dry_run', at: now() });
      d.status = 'simulated'; d.sentAt = now(); d.deliveryMode = 'dry_run'; d.deliveryId = randomUUID();
      if (lead.stage === 'Matched') lead.stage = 'Contacted';
      lead.events.push({ stage: 'Contacted', at: now(), actor: 'Outreach agent', approvedBy: 'You', mode: 'dry_run', draftId });
      addActivity(s, 'Approved outreach dry run', `${lead.name}; ${d.channel}; variant ${d.variant}. Recorded locally; no external message sent.`, 'Outreach agent', { approvedBy: 'You', draftId, mode: 'dry_run' });
      return d.id;
    });
    await graph.sync(result.state, competitors[id]); return snapshot(id);
  };
  const stage = (id, leadId, next) => store.mutate(id, s => {
    if (!pipelineStages.includes(next)) throw new AppError(400, 'Unknown pipeline stage.', 'invalid_stage');
    const lead = findLead(s, leadId); if (lead.stage === next) return;
    lead.stage = next; lead.events.push({ stage: next, at: now(), actor: 'You', mode: 'user_reported' });
    addActivity(s, 'Opportunity stage updated', `${lead.name} → ${next}. User-reported change.`, 'You', { leadId, stage: next, mode: 'user_reported' });
  }).state;
  const graphView = async id => {
    const reservation = store.reserve(id, 'graph_query', costs.graph_query);
    try { const state = store.read(id); await graph.sync(state, competitors[id]); markOutcomeProjection(store, id, state); const data = await graph.snapshot(id); const paths = await graph.paths(id); store.settle(id, reservation, true); return { ...data, paths }; }
    catch (error) { store.settle(id, reservation, false); throw error; }
  };
  return { snapshot, saveProfile, approveProfile, inferProfile, reviewIntake, draftWithModel, startDiscovery, selectLead, enrich, draft, editDraft, approveDraft, rejectDraft, simulateSend, stage, recordOutcome, graphView, assistantStatus: () => model.status() };
}
