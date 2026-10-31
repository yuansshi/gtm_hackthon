// Billing transport progress changes the workspace revision but not graph facts.
// Compare only graph inputs; projection bookkeeping and private connection notes
// do not make a valid graph snapshot stale.
import { buyingLinkStatus } from './buying-evidence.js';
import { educationReviewCurrent, publicEducationEvidence } from './education-evidence.js';
import { personReviewCurrent } from './people-evidence.js';
import { competitorReviewCurrent } from './competitor-evidence.js';
export function graphContextKey(state, competitors = state.competitors || [], clock = Date.now()) {
  const leads = state.leads || [], drafts = state.drafts || [];
  const fields = ['id', 'domain', 'name', 'industry', 'location', 'source', 'contactSource', 'facts', 'sourceIntakeId', 'evidenceNeedsReview', 'evidenceStatus', 'excludedReason', 'companyProfile', 'signal', 'marketSignals', 'people'];
  return JSON.stringify({ businessId: state.businessId, approved: state.approved, company: state.company, products: state.productFamilies, icp: state.icp, capabilities: state.capabilities, commercial: state.commercial, competitors,
    leads: leads.map(lead => ({ ...Object.fromEntries(fields.map(key => [key, lead[key]])), outcomes: (lead.events || []).filter(event => event.recordType === 'outcome') })),
    sent: drafts.filter(draft => ['accepted','simulated'].includes(draft.status)).map(({id,leadId,status,channel,variant,sequenceStep,sentAt,deliveryProvider,deliveryStatus,providerAcceptedAt,deliveryReceiptAt})=>({id,leadId,status,channel,variant,sequenceStep,sentAt,deliveryProvider,deliveryStatus,providerAcceptedAt,deliveryReceiptAt})),
    competitorsReviewed: (state.competitorReviews || []).map(({ comparisonNote, ...review }) => review),
    competitorValidity: (state.competitorReviews || []).map(review => [review.id, competitorReviewCurrent(review, state, clock)]),
    buyingLinks: (state.buyingLinks || []).map(({ profileKey, accountKey, ...link }) => link),
    buyingValidity: (state.buyingLinks || []).map(link => [link.id, buyingLinkStatus(link, state, leads.find(lead => lead.id === link.leadId), clock, competitors)]),
    people: state.personReviews || [],
    personValidity: (state.personReviews || []).map(review => { const lead = leads.find(item => item.id === review.leadId); return [review.id, !!lead && personReviewCurrent(review, lead, clock)]; }),
    education: (state.educationReviews || []).map(publicEducationEvidence),
    educationValidity: (state.educationReviews || []).map(review => [review.id, educationReviewCurrent(review, state, leads.find(item => item.id === review.leadId), clock)]),
    connections: (state.knownConnections || []).map(({id,reviewId,personKey,status,relationship,attestedAt,revokedAt})=>({id,reviewId,personKey,status,relationship,attestedAt,revokedAt})),
  }, (key,value)=>key==='graphStatus'?undefined:value);
}
