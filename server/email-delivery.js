import { requireMessageBrief } from './message-brief.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, digest, now, addActivity } from './store.js';
import { costs } from './catalog.js';
import { communicationContext, requireCommunicationAllowed } from './communication-policy.js';
import { recipientTarget, maskedCommunicationTarget } from '../src/communication-targets.js';
import { liveMessage } from './sendgrid-provider.js';

const fail = (status, message, code) => { throw new AppError(status, message, code); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const lockedDraftStatuses = ['accepted', 'simulated', 'dispatching', 'delivery_unknown'];
export const messageHash = draft => digest({ body: draft.body, subject: draft.subject, recipient: draft.recipient, version: draft.version, profileHash: draft.profileHash, businessId: draft.businessId, channel: draft.channel, sequenceStep: draft.sequenceStep, ...(draft.messageBrief ? { messageBrief: draft.messageBrief } : {}), ...(draft.approvedDeliveryMode === 'live' ? { deliveryMode: 'live', senderHash: draft.approvedSenderHash, liveMessage: draft.approvedLiveMessage } : {}) });
const companyKey = state => digest({ name: state.company.name, website: state.company.website });
const fresh = value => Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() && Date.now() - Date.parse(value) <= 15 * 60000;
const draftFor = (state, id) => state.drafts.find(draft => draft.id === id) || fail(404, 'Draft not found in this business.', 'draft_not_found');
const leadFor = (state, id) => state.leads.find(lead => lead.id === id) || fail(404, 'Account not found in this business.', 'lead_not_found');
const eventTypes = ['processed', 'deferred', 'delivered', 'bounce', 'dropped', 'spamreport', 'unsubscribe', 'group_unsubscribe'];
const restrictiveEvents = ['bounce', 'spamreport', 'unsubscribe', 'group_unsubscribe'];
const eventSchema = z.object({ event: z.enum(eventTypes), email: z.string().max(320), timestamp: z.number().int().positive(), sg_event_id: z.string().min(1).max(256), sg_message_id: z.string().min(1).max(512), gtm_dispatch_id: z.string().uuid(), gtm_business_id: z.enum(['allco', 'huasheng']), asm_group_id: z.number().int().optional() });
export function markDeliveryProjection(store, id, state) {
  const ids = new Set((state.delivery?.attempts || []).map(item => item.id));
  if (!store.read(id).delivery?.attempts?.some(item => ids.has(item.id) && item.graphStatus === 'pending')) return;
  store.mutate(id, current => { for (const item of current.delivery?.attempts || []) if (ids.has(item.id)) item.graphStatus = 'synced'; });
}
export function createEmailDelivery({ store, graph, competitors, provider, snapshot, profileDigest, requireEligible, requireFreshSignals, requireFreshCompany, accountContextDigest, prepareBilling }) {
  const project = async id => { const state = store.read(id); try { await graph.sync(state, competitors[id]); markDeliveryProjection(store, id, state); } catch { /* Durable receipts repair through a later graph query/replay. */ } return snapshot(id); };
  const ready = state => {
    const config = provider.binding(state.businessId), sender = state.delivery?.sender;
    return config.configured && sender?.bindingHash === config.hash && fresh(sender.checkedAt) && state.delivery?.senderConfirmation?.senderHash === sender.hash && state.delivery.senderConfirmation.companyKey === companyKey(state) && state.delivery?.checks?.[0]?.status === 'completed';
  };
  const view = state => {
    const config = provider.binding(state.businessId), data = state.delivery || {};
    return { provider: 'SendGrid', enabled: config.enabled, configured: config.configured, available: !!ready(state) && !data.requiresInvestigation, bindingHash: config.hash, webhookUrl: config.webhookUrl, sender: data.sender || null, confirmed: data.senderConfirmation?.senderHash === data.sender?.hash && data.senderConfirmation?.companyKey === companyKey(state), checks: data.checks || [], attempts: data.attempts || [], requiresInvestigation: !!data.requiresInvestigation, fixture: !!provider.status().fixture, status: !config.configured ? 'Live email not configured' : data.requiresInvestigation ? 'Provider receipt requires investigation' : ready(state) ? 'Sender confirmed · live approval required' : 'Check and confirm this business’s sender' };
  };
  const preview = (state, draft) => { if (!ready(state) || draft.channel !== 'email') return null; try { return { ...liveMessage(draft, state.delivery.sender), bindingHash: provider.binding(state.businessId).hash }; } catch { return null; } };
  const approval = (state, draft) => {
    provider.requireConfigured(state.businessId);
    if (state.delivery?.requiresInvestigation) fail(409, 'Investigate the conflicting provider receipt before live approval.', 'delivery_investigation_required');
    if (!ready(state) || draft.channel !== 'email') fail(409, 'Live email needs a current confirmed sender for this business. LinkedIn remains a dry run.', 'delivery_sender_confirmation_required');
    const message = preview(state, draft); if (!message) fail(400, 'Choose one valid email recipient before live approval.', 'recipient_required');
    return { approvedDeliveryMode: 'live', approvedSenderHash: message.senderHash, approvedLiveMessage: message };
  };
  const checkSender = async (id, input) => {
    if (!uuid(input.requestId) || !input.acknowledged) fail(400, 'Confirm checking this project’s sender and unsubscribe group.', 'delivery_sender_review_required');
    const config = provider.requireConfigured(id), before = store.read(id), hash = digest({ bindingHash: config.hash });
    const old = before.delivery?.checks?.find(item => item.id === input.requestId);
    if (old) { if (old.hash !== hash) fail(409, 'This request ID belongs to another sender configuration.', 'delivery_request_conflict'); return snapshot(id); }
    if (before.delivery?.checks?.some(item => item.status === 'running')) fail(409, 'Wait for the sender check to finish.', 'delivery_check_running');
    store.mutate(id, state => { state.delivery ||= {}; state.delivery.checks ||= []; state.delivery.checks.unshift({ id: input.requestId, hash, status: 'running', startedAt: now() }); state.delivery.checks = state.delivery.checks.slice(0, 30); }, input.revision);
    try {
      const sender = await provider.checkSender(id);
      store.mutate(id, state => {
        if (provider.binding(id).hash !== config.hash) fail(409, 'Sender configuration changed during the check.', 'stale_delivery_sender');
        const previous = state.delivery.sender;
        state.delivery.sender = sender;
        Object.assign(state.delivery.checks.find(item => item.id === input.requestId), { status: 'completed', completedAt: now() });
        if (previous?.hash !== sender.hash) { state.delivery.senderConfirmation = null; for (const draft of state.drafts.filter(draft => draft.status === 'approved' && draft.approvedDeliveryMode === 'live')) { draft.status = 'draft'; draft.version++; draft.approvedHash = null; draft.approvedAt = null; draft.reviewReason = 'delivery_sender_changed'; } }
        addActivity(state, 'Project email identity checked', 'Sender, reply address, postal footer and unsubscribe group need your confirmation. No email sent.');
      });
    } catch (error) { store.mutate(id, state => Object.assign(state.delivery.checks.find(item => item.id === input.requestId), { status: 'failed', completedAt: now(), error: error instanceof AppError ? error.message : 'Sender check failed. No email sent.' })); }
    return snapshot(id);
  };
  const confirmSender = (id, input) => {
    if (!input.acknowledged) fail(400, 'Review the sender, reply address, postal footer and unsubscribe group first.', 'delivery_sender_review_required');
    store.mutate(id, state => {
      const config = provider.requireConfigured(id), sender = state.delivery?.sender;
      if (input.bindingHash !== config.hash || input.senderHash !== sender?.hash || sender.bindingHash !== config.hash || !fresh(sender.checkedAt) || state.delivery.checks[0]?.status !== 'completed') fail(409, 'The sender check changed or expired. Check it again.', 'stale_delivery_sender');
      state.delivery.senderConfirmation = { senderHash: sender.hash, companyKey: companyKey(state), confirmedAt: now(), actor: 'You' };
      addActivity(state, 'Business email identity confirmed', `${state.company.name}; sender and footer reviewed. Every live message still needs separate approval.`);
    }, input.revision); return snapshot(id);
  };
  const restrict = (state, address, reason) => {
    state.contactSuppressions ||= []; const addressHash = digest({ businessId: state.businessId, email: address });
    if (!state.contactSuppressions.some(item => item.addressHash === addressHash)) state.contactSuppressions.push({ addressHash, at: now(), reason: 'SendGrid ' + reason });
    for (const draft of state.drafts.filter(item => ['draft', 'approved', 'rejected'].includes(item.status) && item.channel === 'email')) {
      let target; try { target = recipientTarget('email', draft.recipient); } catch { continue; }
      if (target !== address) continue;
      draft.version++; draft.status = 'draft'; draft.recipient = ''; draft.approvedHash = null; draft.approvedAt = null; draft.reviewReason = 'contact_processing_restricted';
    }
    for (const lead of state.leads) if (lead.contact?.email?.toLowerCase() === address) lead.contact.processingRestricted = true;
  };
  const validate = (state, draft, expectedVersion) => {
    if (draft.version !== expectedVersion || draft.status !== 'approved' || draft.approvedDeliveryMode !== 'live' || !draft.approvedHash || draft.approvedHash !== messageHash(draft)) fail(409, 'Approve this exact message for live email before sending.', 'live_approval_required');
    requireMessageBrief(draft);
    if (!state.approved || draft.profileHash !== profileDigest(state)) fail(409, 'The approved campaign context changed.', 'stale_profile');
    if ((state.delivery?.attempts || []).filter(item => Date.parse(item.submittedAt) >= Date.now() - 60000).length >= 5) fail(429, 'This business reached the prototype limit of five live submissions per minute. Wait before reviewing another send.', 'delivery_rate_limited');
    const lead = leadFor(state, draft.leadId); requireEligible(lead, state); requireFreshSignals(draft, lead); requireFreshCompany(draft, lead); requireCommunicationAllowed(state, lead, 'email', draft.recipient);
    if (!ready(state) || draft.approvedSenderHash !== state.delivery.sender.hash || draft.channel !== 'email') fail(409, 'The sender check or confirmation changed. Review it again.', 'stale_delivery_sender');
    if (state.delivery?.requiresInvestigation) fail(409, 'A conflicting provider receipt needs investigation before more live mail.', 'delivery_investigation_required');
    if (state.drafts.some(other => other.id !== draft.id && other.leadId === draft.leadId && other.channel === draft.channel && other.sequenceStep === draft.sequenceStep && lockedDraftStatuses.includes(other.status))) fail(409, 'This account/channel/step already has a dispatched or uncertain variant.', 'variant_already_sent');
    return lead;
  };
  const accepted = (state, attempt, at, messageId) => {
    if (['accepted', 'receipt_conflict'].includes(attempt.status)) return;
    if (attempt.status === 'rejected') { attempt.status = 'receipt_conflict'; attempt.error = 'Signed receipt conflicts with a definitive rejection. Investigate provider records; no automatic re-charge or resend.'; state.delivery.requiresInvestigation = true; return; }
    attempt.status = 'accepted'; attempt.error = null; attempt.completedAt = now(); if (!attempt.deliveryStatus || attempt.deliveryStatus === 'submitting') attempt.deliveryStatus = 'accepted'; attempt.acceptedAt = at; attempt.messageId ||= messageId || null; attempt.graphStatus = 'pending';
    const entry = state.wallet.ledger.find(item => item.id === attempt.reservation); store.settleUsageInState(state, entry, true); entry.externalStatus = 'provider_accepted';
    const draft = state.drafts.find(item => item.id === attempt.draftId && item.version === attempt.version && item.approvedHash === attempt.approvalHash);
    if (draft) {
      Object.assign(draft, { status: 'accepted', deliveryMode: 'live', deliveryProvider: 'SendGrid', deliveryId: attempt.id, sentAt: attempt.submittedAt, providerAcceptedAt: at, deliveryStatus: attempt.deliveryStatus || 'accepted' });
      const lead = state.leads.find(item => item.id === draft.leadId);
      if (lead && !lead.events.some(item => item.draftId === draft.id && item.mode === 'live' && item.stage === 'Contacted')) { if (lead.stage === 'Matched') lead.stage = 'Contacted'; lead.events.push({ stage: 'Contacted', at: attempt.submittedAt, actor: 'Outreach agent', approvedBy: 'You', mode: 'live', draftId: draft.id }); }
    }
    addActivity(state, 'Live email accepted by provider', 'SendGrid accepted the approved message. Inbox delivery and a reply are not established.', 'Outreach agent', { draftId: attempt.draftId, mode: 'live', deliveryId: attempt.id });
  };
  const send = async (id, draftId, input) => {
    if (!uuid(input.requestId) || !input.acknowledged) fail(400, 'Confirm sending this approved live email now.', 'live_send_acknowledgement_required');
    const initial = store.read(id), requestHash = digest({ draftId, version: input.version });
    const old = initial.delivery?.attempts?.find(item => item.id === input.requestId);
    if (old) { if (old.requestHash !== requestHash) fail(409, 'This send ID belongs to another message/version.', 'delivery_request_conflict'); return project(id); }
    const draft = draftFor(initial, draftId), lead = validate(initial, draft, input.version); provider.requireConfigured(id);
    if ((initial.delivery?.attempts || []).length >= 500) fail(409, 'This prototype reached its 500-attempt history limit. Export/review records before further delivery.', 'delivery_history_limit');
    const policyContext = communicationContext(initial), accountHash = accountContextDigest(lead);
    const sender = await provider.checkSender(id);
    if (sender.hash !== draft.approvedSenderHash) fail(409, 'The provider sender or footer changed. Check/confirm it and approve the new exact message.', 'stale_delivery_sender');
    const address = draft.approvedLiveMessage.to;
    if (await provider.suppressed(id, address)) { store.mutate(id, state => { restrict(state, address, 'suppression'); addActivity(state, 'Provider suppression enforced', 'The selected address is suppressed. No email was sent and no local credit charged.'); }); fail(409, 'SendGrid suppresses this address. No email was sent.', 'contact_suppressed'); }
    await prepareBilling(id, { path: `/drafts/${draftId}/send`, requestId: input.requestId });
    const current = store.read(id), currentDraft = draftFor(current, draftId);
    const replay = current.delivery?.attempts?.find(item => item.id === input.requestId); if (replay) return project(id);
    validate(current, currentDraft, input.version);
    if (currentDraft.approvedHash !== draft.approvedHash || accountContextDigest(leadFor(current, draft.leadId)) !== accountHash || communicationContext(current) !== policyContext || provider.binding(id).hash !== sender.bindingHash) fail(409, 'Account, approval or preferences changed during preflight. Review the current message before sending.', 'stale_delivery_context');
    const reservation = store.reserve(id, 'outreach', costs.outreach, draft.leadId, { mode: 'live', dispatchId: input.requestId });
    try {
      store.mutate(id, state => {
        const exact = draftFor(state, draftId); validate(state, exact, input.version);
        state.delivery.attempts ||= [];
        state.delivery.attempts.unshift({ id: input.requestId, requestHash, draftId, leadId: draft.leadId, version: draft.version, approvalHash: draft.approvedHash, messageBrief: draft.messageBrief ? structuredClone(draft.messageBrief) : null, message: structuredClone(draft.approvedLiveMessage), recipientDisplay: maskedCommunicationTarget('email', address), reservation, status: 'sending', submittedAt: now(), deliveryStatus: 'submitting', events: [], seenEventIds: [], graphStatus: 'pending' });
        exact.status = 'dispatching'; exact.deliveryMode = 'live'; exact.deliveryId = input.requestId;
        state.wallet.ledger.find(item => item.id === reservation).externalStatus = 'provider_requested';
        addActivity(state, 'Live email submission started', 'One immutable request recorded before transmission. It will not replay automatically.', 'Outreach agent', { draftId, mode: 'live', deliveryId: input.requestId });
      });
    } catch (error) { store.settle(id, reservation, false); throw error; }
    try {
      const result = await provider.send(id, draft.approvedLiveMessage, input.requestId);
      if (result?.accepted !== true || !Number.isFinite(Date.parse(result.acceptedAt))) fail(503, 'Provider acceptance could not be confirmed. Do not resend.', 'delivery_unknown');
      store.mutate(id, state => {
        const attempt = state.delivery.attempts.find(item => item.id === input.requestId);
        if (attempt.messageId && result.messageId && attempt.messageId !== result.messageId && !attempt.messageId.startsWith(result.messageId + '.')) { state.delivery.requiresInvestigation = true; attempt.receiptConflict = true; attempt.error = 'Provider message identifiers disagree. Investigate before further live email.'; }
        attempt.messageId ||= result.messageId;
        accepted(state, attempt, result.acceptedAt, result.messageId);
      });
    } catch (error) {
      store.mutate(id, state => {
        const attempt = state.delivery.attempts.find(item => item.id === input.requestId); if (['accepted', 'receipt_conflict'].includes(attempt.status)) return;
        const exact = draftFor(state, draftId), entry = state.wallet.ledger.find(item => item.id === reservation);
        const rejected = ['delivery_rejected', 'delivery_not_configured', 'stale_delivery_sender'].includes(error.code);
        Object.assign(attempt, { status: rejected ? 'rejected' : 'unknown', error: rejected ? 'Provider rejected this request. Local credits refunded; fresh human approval required.' : 'Provider acceptance is unknown. Do not resend; inspect provider records and wait for signed events.', completedAt: now() });
        if (rejected) { store.settleUsageInState(state, entry, false); exact.status = 'draft'; exact.version++; exact.approvedHash = null; exact.approvedAt = null; exact.reviewReason = 'delivery_rejected'; entry.externalStatus = 'provider_rejected'; }
        else { exact.status = 'delivery_unknown'; entry.externalStatus = 'provider_unknown'; }
        addActivity(state, rejected ? 'Live email rejected' : 'Live email acceptance unknown', attempt.error, 'Outreach agent', { draftId, mode: 'live', deliveryId: input.requestId });
      });
    }
    return project(id);
  };
  const events = async (bytes, signature, timestamp) => {
    provider.verifyEvents(bytes, signature, timestamp);
    let values; try { values = JSON.parse(bytes.toString('utf8')); } catch { fail(400, 'Invalid event JSON.', 'invalid_delivery_event'); }
    if (!Array.isArray(values) || values.length > 100) fail(400, 'Expected at most 100 signed events.', 'invalid_delivery_event');
    const affected = new Set(); let matched = 0, ignored = 0;
    for (const raw of values) {
      const parsed = eventSchema.safeParse(raw); if (!parsed.success) { ignored++; continue; } const event = parsed.data;
      const id = event.gtm_business_id, state = store.read(id), attempt = state.delivery?.attempts?.find(item => item.id === event.gtm_dispatch_id);
      let address; try { address = recipientTarget('email', event.email); } catch { ignored++; continue; }
      if (!attempt || attempt.message.to !== address || event.timestamp * 1000 < Date.parse(attempt.submittedAt) - 300000 || event.timestamp * 1000 > Date.now() + 300000 || attempt.messageId && event.sg_message_id !== attempt.messageId && !event.sg_message_id.startsWith(attempt.messageId + '.') || event.event === 'group_unsubscribe' && event.asm_group_id !== attempt.message.group.id) { ignored++; continue; }
      if (attempt.seenEventIds.includes(event.sg_event_id)) { ignored++; continue; }
      store.mutate(id, current => {
        const record = current.delivery.attempts.find(item => item.id === attempt.id); if (record.seenEventIds.includes(event.sg_event_id)) return;
        record.seenEventIds.push(event.sg_event_id); const at = new Date(event.timestamp * 1000).toISOString();
        record.events.unshift({ id: event.sg_event_id, type: event.event, at, receivedAt: now(), messageId: event.sg_message_id, provenance: 'signed_sendgrid' }); record.events = record.events.slice(0, 100);
        if (restrictiveEvents.includes(event.event)) restrict(current, address, event.event);
        accepted(current, record, at, event.sg_message_id);
        const rank = { processed: 1, deferred: 2, delivered: 3, bounce: 4, dropped: 4, spamreport: 5, unsubscribe: 6, group_unsubscribe: 6 };
        const terminal = ['delivered', 'bounce', 'dropped', 'spamreport', 'unsubscribe', 'group_unsubscribe'].includes(record.deliveryStatus);
        if ((!terminal || !['processed', 'deferred'].includes(event.event)) && (!record.lastEventAt || Date.parse(at) > Date.parse(record.lastEventAt) || at === record.lastEventAt && rank[event.event] >= (rank[record.deliveryStatus] || 0))) { record.deliveryStatus = event.event === 'processed' ? 'accepted' : event.event; record.lastEventAt = at; }
        const draft = current.drafts.find(item => item.id === record.draftId && item.version === record.version && item.approvedHash === record.approvalHash); if (draft?.status === 'accepted') { draft.deliveryStatus = record.deliveryStatus; draft.deliveryReceiptAt = record.lastEventAt; }
        addActivity(current, 'Signed email receipt recorded', `SendGrid event: ${event.event}. This is not a reply or evidence of buyer intent.`, 'Delivery provider', { draftId: record.draftId, deliveryId: record.id, mode: 'live' });
      });
      affected.add(id); matched++;
    }
    for (const id of affected) await project(id);
    return { matched, ignored };
  };
  return { view, preview, approval, checkSender, confirmSender, send, events, status: provider.status };
}
