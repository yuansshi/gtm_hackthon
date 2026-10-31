// A new account context invalidates pending acknowledgements as well as approvals.
export function invalidateAccountDrafts(state, leadId, { reason, outcomeId = null, intakeId = null }) {
  const ids = [];
  for (const draft of state.drafts.filter(draft => draft.leadId === leadId && ['draft', 'rejected', 'approved'].includes(draft.status))) {
    draft.version = (draft.version || 1) + 1; draft.status = 'draft'; draft.approvedHash = null; draft.approvedAt = null;
    draft.reviewReason = reason; draft.contextOutcomeId = outcomeId; draft.contextIntakeId = intakeId; ids.push(draft.id);
  }
  return ids;
}
