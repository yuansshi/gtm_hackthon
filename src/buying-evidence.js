import { signalFresh, signalHold } from './market-signals.js';
import { companyHoldReasons } from './company-evidence.js';
import { competitiveReferences, competitorReviewCurrent } from './competitor-evidence.js';

export const buyingKinds = { evaluation: 'Job → published evaluation', displacement: 'Supplier renewal / churn' };
export const buyingProfileKey = state => JSON.stringify({ company: state.company, products: state.productFamilies, capabilities: state.capabilities, commercial: state.commercial, icp: state.icp });
export const buyingAccountKey = lead => JSON.stringify({ id: lead.id, domain: lead.domain, source: lead.source, intake: lead.sourceIntakeId || null, application: lead.application, name: lead.name });
export const buyingSignalKey = signal => signal && JSON.stringify({ id: signal.id, source: signal.source, quote: signal.quote, kind: signal.kind, eventDate: signal.eventDate, dateQuote: signal.dateQuote, acceptance: signal.acceptedVersion || signal.acceptedAt });
export function calendarDay(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return NaN;
  const timestamp = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : NaN;
}
export function buyingWindowActive(link, clock = Date.now()) {
  return calendarDay(link.startDate) <= clock && clock < calendarDay(link.endDate) + 86400000;
}
export function buyingLinkStatus(link, state, lead, clock = Date.now(), catalog = state.competitors || []) {
  if (link.status !== 'reviewed') return link.status;
  if (link.businessId !== state.businessId || !state.approved || !lead || lead.id !== link.leadId || lead.evidenceNeedsReview || lead.excludedReason || signalHold(lead) || companyHoldReasons(lead, state).length || link.profileKey !== buyingProfileKey(state) || link.accountKey !== buyingAccountKey(lead)) return 'needs_review';
  const signal = lead.marketSignals?.find(item => item.id === link.signalId);
  if (!signal?.acceptedAt || buyingSignalKey(signal) !== link.signalKey || !signalFresh(signal, clock)) return 'needs_review';
  if (link.kind === 'evaluation') {
    const job = lead.marketSignals?.find(item => item.id === link.jobSignalId);
    if (signal.kind !== 'evaluation' || job?.kind !== 'job_requisition' || !job.acceptedAt || !signalFresh(job, clock) || buyingSignalKey(job) !== link.jobSignalKey) return 'needs_review';
  } else {
    const competitor = competitiveReferences(state, catalog).find(item => item.id === link.competitorId);
    if (!['renewal', 'churn'].includes(signal.kind) || !competitor?.review || !competitorReviewCurrent(competitor.review, state, clock) || competitor.review.id !== link.competitorReviewId) return 'needs_review';
  }
  if (!Number.isFinite(calendarDay(link.startDate)) || !Number.isFinite(calendarDay(link.endDate))) return 'needs_review';
  if (clock < calendarDay(link.startDate)) return 'upcoming';
  return buyingWindowActive(link, clock) ? 'active' : 'expired';
}
export function publicBuyingEvidence(link) {
  const keys = ['id', 'kind', 'leadId', 'startDate', 'endDate', 'windowQuote', 'source', 'jobTitle', 'jobQuote', 'jobSource', 'competitorId', 'competitorName', 'competitorSource', 'competitorIdentityQuote', 'reviewedAt'];
  return Object.fromEntries(keys.filter(key => link[key] !== undefined).map(key => [key, link[key]]));
}
