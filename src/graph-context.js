// Billing transport progress changes the workspace revision but not graph facts.
// Compare only graph inputs; projection bookkeeping and private connection notes
// do not make a valid graph snapshot stale.
import { buyingLinkStatus } from './buying-evidence.js';
import { competitorReviewCurrent } from './competitor-evidence.js';
export function graphContextKey(state, competitors = state.competitors || []) {
  const fields = ['id', 'domain', 'name', 'industry', 'location', 'source', 'contactSource', 'facts', 'sourceIntakeId', 'evidenceNeedsReview', 'evidenceStatus', 'excludedReason', 'companyProfile', 'signal', 'marketSignals', 'people'];
  return JSON.stringify({ businessId: state.businessId, approved: state.approved, company: state.company, products: state.productFamilies, icp: state.icp, capabilities: state.capabilities, commercial: state.commercial, competitors,
    leads: state.leads.map(lead => ({ ...Object.fromEntries(fields.map(key => [key, lead[key]])), outcomes: (lead.events || []).filter(event => event.recordType === 'outcome') })),
    sent: state.drafts.filter(draft => ['accepted','simulated'].includes(draft.status)).map(({id,leadId,status,channel,variant,sequenceStep,sentAt})=>({id,leadId,status,channel,variant,sequenceStep,sentAt})),
    competitorsReviewed: (state.competitorReviews || []).map(({ comparisonNote, ...review }) => review),
    competitorValidity: (state.competitorReviews || []).map(review => [review.id, competitorReviewCurrent(review, state)]),
    buyingLinks: (state.buyingLinks || []).map(({ profileKey, accountKey, ...link }) => link),
    buyingValidity: (state.buyingLinks || []).map(link => [link.id, buyingLinkStatus(link, state, state.leads.find(lead => lead.id === link.leadId), Date.now(), competitors)]),
    people: state.personReviews || [],
    connections: (state.knownConnections || []).map(({id,reviewId,personKey,status,relationship,attestedAt,revokedAt})=>({id,reviewId,personKey,status,relationship,attestedAt,revokedAt})),
  }, (key,value)=>key==='graphStatus'?undefined:value);
}
