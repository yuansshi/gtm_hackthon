import { recipientCommunicationBlock } from './communication-policy.js';
import { digest } from './store.js';

export const suppressedContact = (state, recipient) => !!recipientCommunicationBlock(state, 'email', recipient) || (String(recipient || '').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []).some(email => (state.contactSuppressions || []).some(item => item.addressHash === digest({ businessId: state.businessId, email })));

// A new account context invalidates pending acknowledgements as well as approvals.
export function invalidateAccountDrafts(state, leadId, { reason, outcomeId = null, intakeId = null }) {
  const ids = [];
  for (const draft of state.drafts.filter(draft => draft.leadId === leadId && ['draft', 'rejected', 'approved'].includes(draft.status))) {
    draft.version = (draft.version || 1) + 1; draft.status = 'draft'; draft.approvedHash = null; draft.approvedAt = null;
    draft.reviewReason = reason; draft.contextOutcomeId = outcomeId; draft.contextIntakeId = intakeId; ids.push(draft.id);
  }
  return ids;
}
