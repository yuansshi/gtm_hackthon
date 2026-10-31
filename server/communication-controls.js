import { randomUUID } from 'node:crypto';
import { AppError, addActivity, digest, now } from './store.js';
import { communicationTarget, maskedCommunicationTarget } from '../src/communication-targets.js';
import { accountCommunicationBlock, communicationKey, recipientCommunicationBlock } from './communication-policy.js';

const fail = (message, code = 'invalid_communication_decision') => { throw new AppError(409, message, code); };
export function createCommunicationControls({ store, snapshot }) {
  const decision = (id, input, action, values, apply) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId || '') || !input.acknowledged) fail('Confirm this communication preference decision.');
    const hash = digest({ action, values }), before = store.read(id);
    const previous = (before.communicationOperations || []).find(item => item.id === input.requestId);
    if (previous) { if (previous.hash !== hash) fail('This request ID belongs to a different communication decision.', 'communication_request_conflict'); return snapshot(id); }
    store.mutate(id, state => {
      const record = apply(state);
      state.communicationOperations ||= [];
      state.communicationOperations.unshift({ id: input.requestId, restrictionId: record.id, version: record.version, action, hash, decision: values, at: now() });
    }, input.revision);
    return snapshot(id);
  };
  const hold = (id, input) => {
    let target;
    try { target = communicationTarget(input.kind, input.target); } catch (error) { throw new AppError(400, error.message, 'invalid_communication_target'); }
    if (!['opt_out', 'bounce', 'complaint', 'manual_hold'].includes(input.reason) || !Number.isFinite(Date.parse(input.reportedAt)) || Date.parse(input.reportedAt) > Date.now() || typeof input.note !== 'string' || input.note.length > 500) fail('Record a valid reason, non-future request time and optional note of at most 500 characters.');
    return decision(id, input, 'hold', { kind: input.kind, targetKey: communicationKey({ businessId: id }, input.kind, target), reason: input.reason, reportedAt: input.reportedAt, note: input.note.trim() }, state => {
      state.communicationRestrictions ||= [];
      const key = communicationKey(state, input.kind, target);
      let record = state.communicationRestrictions.find(item => item.targetKey === key);
      if (!record) { record = { id: randomUUID(), kind: input.kind, targetKey: key, display: maskedCommunicationTarget(input.kind, target), ...(input.kind === 'account' ? { domain: target } : {}), version: 0 }; state.communicationRestrictions.unshift(record); }
      Object.assign(record, { version: record.version + 1, status: 'active', reason: input.reason, reportedAt: new Date(input.reportedAt).toISOString(), note: input.note.trim(), recordedAt: now(), release: null });
      let cleared = 0;
      for (const lead of state.leads) if (accountCommunicationBlock(state, lead)) lead.selected = false;
      for (const draft of state.drafts) {
        const lead = state.leads.find(item => item.id === draft.leadId);
        if (!['draft', 'approved', 'rejected'].includes(draft.status) || !(accountCommunicationBlock(state, lead) || recipientCommunicationBlock(state, draft.channel, draft.recipient))) continue;
        draft.version++; draft.status = 'draft'; draft.approvedHash = null; draft.approvedAt = null; draft.recipient = ''; draft.reviewReason = 'communication_restricted'; cleared++;
      }
      addActivity(state, 'Do-not-contact hold recorded', `${record.display}; ${record.kind === 'account' ? 'all outreach channels and targeted contact processing' : record.kind + ' channel'}. ${cleared} editable approval(s) cleared. User-reported; no external message sent.`, 'You', { communicationRestrictionId: record.id });
      return record;
    });
  };
  const release = (id, input) => {
    if (!['permission_updated', 'recorded_in_error'].includes(input.reason) || typeof input.note !== 'string' || !input.note.trim() || input.note.length > 500) fail('Record why this hold can be released, with a note of at most 500 characters.');
    return decision(id, input, 'release', { restrictionId: input.restrictionId, expectedVersion: input.expectedVersion, reason: input.reason, note: input.note.trim() }, state => {
      const record = (state.communicationRestrictions || []).find(item => item.id === input.restrictionId);
      if (!record || record.status !== 'active' || record.version !== input.expectedVersion) fail('This hold changed. Refresh and review its current version before release.', 'stale_communication_decision');
      Object.assign(record, { version: record.version + 1, status: 'released', release: { reason: input.reason, note: input.note.trim(), at: now() } });
      addActivity(state, 'Communication hold released', `${record.display}; your recorded decision does not restore old recipients, shortlist selections or approvals. Provider restrictions remain separate.`, 'You', { communicationRestrictionId: record.id });
      return record;
    });
  };
  return { hold, release };
}
