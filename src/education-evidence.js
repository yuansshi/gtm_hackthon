import { personDateFresh, personReviewCurrent, personSourceKey } from './people-evidence.js';

export const educationLabels = { attended: 'Published study or attendance', degree: 'Published degree claim' };
export const institutionIdentity = (domain, name) => JSON.stringify({ domain, name: String(name).replace(/\s+/g, ' ').trim().toLowerCase() });
export function educationReviewCurrent(review, state, lead, at = Date.now()) {
  const person = (state.personReviews || []).find(item => item.id === review.personReviewId && item.leadId === review.leadId);
  return !!lead && !!person && review.status === 'reviewed' && review.leadId === lead.id && review.personKey === person.personKey && review.accountKey === personSourceKey(lead) && personReviewCurrent(person, lead, at) && personDateFresh(review.checkedAt, at) && personDateFresh(review.institution.checkedAt, at);
}
export const currentEducationReviews = (state, lead, personReviewId) => personReviewId ? (state.educationReviews || []).filter(review => review.personReviewId === personReviewId && educationReviewCurrent(review, state, lead)) : [];
// Projection carries public passages only, not internal context hashes or operation bookkeeping.
export const publicEducationEvidence = review => ({ id: review.id, personReviewId: review.personReviewId, kind: review.kind, quote: review.quote, source: review.source, checkedAt: review.checkedAt, institutionKey: review.institutionKey, institution: review.institution, reviewedAt: review.reviewedAt, qualification: 'Owner-reviewed public education claim; attendance, degree and dates not independently verified.' });
