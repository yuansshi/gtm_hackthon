import { randomUUID } from 'node:crypto';
import { AppError, addActivity, digest, now } from './store.js';
import { pipelineStages } from './catalog.js';
import { invalidateAccountDrafts } from './review-policy.js';

const reports = state => state.leads.flatMap(lead => (lead.events || []).filter(event => event.recordType === 'outcome').map(event => ({ lead, event })));
const invalid = message => { throw new AppError(400, message, 'invalid_outcome'); };

export function markOutcomeProjection(store, id, projectedState) {
  const ids = new Set(reports(projectedState).map(({ event }) => event.id));
  if (!reports(store.read(id)).some(({ event }) => ids.has(event.id) && event.graphStatus !== 'synced')) return;
  store.mutate(id, state => { for (const { event } of reports(state)) if (ids.has(event.id)) event.graphStatus = 'synced'; });
}

export function createOutcomeReporter({ store, graph, competitors, snapshot }) {
  return async (id, leadId, input) => {
    if (!input || !['user_reported', 'demo'].includes(input.kind) || !pipelineStages.slice(1).includes(input.stage)) invalid('Choose a supported outcome and report type.');
    if (input.acknowledged !== true) throw new AppError(400, 'Confirm the outcome and attribution before recording it.', 'outcome_review_required');
    if (!Number.isSafeInteger(input.revision) || input.revision < 0 || typeof input.updateStage !== 'boolean') invalid('Use the current workspace revision and choose whether to update the stage.');
    if (typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) invalid('Use a valid outcome request ID.');
    if (typeof input.note !== 'string' || !input.note.trim() || input.note.length > 2000) invalid('Add an outcome note of at most 2,000 characters.');
    const time = typeof input.occurredAt === 'string' ? Date.parse(input.occurredAt) : NaN;
    if (!Number.isFinite(time) || new Date(time).toISOString() !== input.occurredAt) invalid('Use a valid UTC occurrence timestamp.');
    if (time > Date.now()) invalid('An outcome cannot occur in the future.');
    let evidenceUrl = input.evidenceUrl || '';
    if (evidenceUrl) {
      try { const url = new URL(evidenceUrl); if (url.protocol !== 'https:' || url.username || url.password || evidenceUrl.length > 1000) invalid('Use an HTTPS reference without embedded credentials.'); evidenceUrl = url.href; }
      catch { invalid('Use a valid HTTPS reference without embedded credentials.'); }
    }
    if (input.draftId && (typeof input.draftId !== 'string' || input.draftId.length > 100)) invalid('Choose a recorded outbound message.');
    if (input.respondent && (typeof input.respondent.name !== 'string' || typeof input.respondent.source !== 'string' || input.respondent.name.length > 200 || input.respondent.source.length > 1000)) invalid('Choose a source-backed person from this account.');
    const payload = { leadId, kind: input.kind, stage: input.stage, occurredAt: input.occurredAt, note: input.note.trim(), evidenceUrl, draftId: input.draftId || null, respondent: input.respondent ? { name: input.respondent.name, source: input.respondent.source } : null, updateStage: input.updateStage };
    const requestHash = digest(payload);
    const initial = store.read(id);
    const lead = initial.leads.find(lead => lead.id === leadId);
    if (!lead) throw new AppError(404, 'Account not found in this business.', 'lead_not_found');
    const previous = reports(initial).find(({ event }) => event.requestId === input.requestId);
    if (previous && previous.event.requestHash !== requestHash) throw new AppError(409, 'This request ID already recorded a different outcome. Start a new report for different input.', 'outcome_request_conflict');
    let outcomeId = previous?.event.id;
    if (!previous) {
      store.mutate(id, state => {
        if (state.revision !== input.revision) throw new AppError(409, 'This workspace changed. Reload before recording the outcome.', 'revision_conflict');
        const account = state.leads.find(lead => lead.id === leadId);
        let linked;
        if (payload.draftId) {
          linked = state.drafts.find(draft => draft.id === payload.draftId && draft.leadId === leadId && draft.businessId === id);
          if (!linked || !['simulated', 'accepted'].includes(linked.status)) throw new AppError(409, 'Link an immutable outbound record from this account and business.', 'invalid_outcome_attribution');
          if ((input.kind === 'demo') !== (linked.status === 'simulated')) throw new AppError(409, 'Local dry runs can only be linked to demo outcomes. Actual reports can only link provider-accepted messages.', 'outcome_mode_mismatch');
          if (!Number.isFinite(Date.parse(linked.sentAt)) || time < Date.parse(linked.sentAt)) throw new AppError(409, 'The reported outcome must occur at or after the linked outbound message.', 'outcome_before_message');
        }
        let respondent = null;
        if (payload.respondent) {
          const person = (account.people || []).find(person => person.name === payload.respondent.name && person.source === payload.respondent.source);
          if (!person) throw new AppError(409, 'The selected respondent is not in this account’s source-backed people. Reload the account.', 'invalid_outcome_respondent');
          respondent = { name: person.name, role: person.role || '', source: person.source, provenance: person.provenance || 'published_source' };
        }
        const latestTime = (account.events || []).reduce((latest, event) => Number.isFinite(Date.parse(event.at)) ? Math.max(latest, Date.parse(event.at)) : latest, -Infinity);
        if (input.updateStage && time < latestTime) throw new AppError(409, 'A newer stage event is already recorded. Uncheck the stage update to add this as history.', 'outcome_before_latest');
        outcomeId = randomUUID();
        const mode = input.kind === 'demo' ? 'dry_run' : 'user_reported';
        const invalidatedDraftIds = invalidateAccountDrafts(state, leadId, { reason: 'account_outcome_changed', outcomeId });
        account.events ||= [];
        account.events.push({ id: outcomeId, requestId: input.requestId, requestHash, recordType: 'outcome', stage: payload.stage, at: payload.occurredAt, recordedAt: now(), actor: 'You', mode, provenance: 'user_reported', providerVerified: false, note: payload.note, evidenceUrl, draftId: payload.draftId, respondent, updateStage: input.updateStage, invalidatedDraftIds, graphStatus: 'pending' });
        if (input.updateStage) account.stage = input.stage;
        addActivity(state, input.kind === 'demo' ? 'Demo outcome recorded' : 'User-reported outcome recorded', `${account.name} → ${input.stage}. ${linked ? `Linked to ${linked.channel}, variant ${linked.variant}, step ${linked.sequenceStep + 1}.` : 'No outbound-message attribution.'} ${input.updateStage ? 'Current stage updated.' : 'History only; current stage retained.'}`, 'You', { leadId, outcomeId, draftId: payload.draftId, mode, provenance: 'user_reported' });
      });
    }
    const saved = store.read(id);
    const event = reports(saved).find(({ event }) => event.id === outcomeId).event;
    if (event.graphStatus !== 'synced') {
      try { await graph.sync(saved, competitors[id]); markOutcomeProjection(store, id, saved); }
      catch { /* The durable report remains saved. An explicit retry/query repairs the projection. */ }
    }
    const result = snapshot(id);
    const projection = reports(result).find(({ event }) => event.id === outcomeId).event.graphStatus;
    return { ...result, recordedOutcomeId: outcomeId, outcomeReplay: !!previous, outcomeProjection: projection, outcomeDraftsForReview: result.drafts.filter(draft => event.invalidatedDraftIds?.includes(draft.id) && ['draft', 'rejected'].includes(draft.status)).length };
  };
}
