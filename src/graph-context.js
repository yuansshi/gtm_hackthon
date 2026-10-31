// Billing transport progress changes the workspace revision but not graph facts.
// Compare only graph inputs; projection bookkeeping and private connection notes
// do not make a valid graph snapshot stale.
export function graphContextKey(state, competitors = state.competitors || []) {
  const fields = ['id', 'domain', 'name', 'industry', 'location', 'source', 'contactSource', 'facts', 'sourceIntakeId', 'evidenceNeedsReview', 'evidenceStatus', 'excludedReason', 'companyProfile', 'signal', 'marketSignals', 'people'];
  return JSON.stringify({ businessId: state.businessId, approved: state.approved, company: state.company, products: state.productFamilies, icp: state.icp, capabilities: state.capabilities, commercial: state.commercial, competitors,
    leads: state.leads.map(lead => ({ ...Object.fromEntries(fields.map(key => [key, lead[key]])), outcomes: (lead.events || []).filter(event => event.recordType === 'outcome') })),
    sent: state.drafts.filter(draft => ['accepted','simulated'].includes(draft.status)).map(({id,leadId,status,channel,variant,sequenceStep,sentAt})=>({id,leadId,status,channel,variant,sequenceStep,sentAt})),
    people: state.personReviews || [],
    connections: (state.knownConnections || []).map(({id,reviewId,personKey,status,relationship,attestedAt,revokedAt})=>({id,reviewId,personKey,status,relationship,attestedAt,revokedAt})),
  }, (key,value)=>key==='graphStatus'?undefined:value);
}
