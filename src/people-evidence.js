export const relationshipLabels = {
  worked_together: 'We worked together',
  know_personally: 'I know this person personally',
  can_request_intro: 'I can request an introduction',
};

export const normalizePersonText = value => String(value || '').replace(/\s+/g, ' ').trim();
export const personSourceKey = lead => JSON.stringify({ domain: lead.domain, source: lead.source, intake: lead.sourceIntakeId || null, needsReview: !!lead.evidenceNeedsReview });
export const personDateFresh = (value, at = Date.now(), days = 30) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= at && at - Date.parse(value) <= days * 86400000;
export const personReviewCurrent = (review, lead, at = Date.now()) => review?.status === 'reviewed' && review.accountKey === personSourceKey(lead) && !lead.evidenceNeedsReview && personDateFresh(review.checkedAt, at) && (!review.formerEmployer || personDateFresh(review.formerEmployer.checkedAt, at));
export const currentPersonReviews = (state, lead) => (state.personReviews || []).filter(review => review.leadId === lead.id && personReviewCurrent(review, lead));

// Keep original indexes for existing reply-to-person attribution. Overlay only an
// exact name/source identity; matching names alone never merge two people.
export function projectedPeople(state, lead) {
  const reviews = currentPersonReviews(state, lead);
  const used = new Set();
  const decorate = (person, review) => {
    if (!review) return person;
    used.add(review.id);
    const connection = (state.knownConnections || []).find(item => item.reviewId === review.id && item.status === 'active');
    return { ...person, name: review.name, role: review.role, source: review.source, previousCompany: review.formerEmployer?.name || null, publicReview: review, reviewCurrent: true,
      knownConnection: connection ? { id: connection.id, relationship: connection.relationship, attestedAt: connection.attestedAt, provenance: 'owner_attestation' } : null,
      relevance: 'Owner-reviewed published role; current employment and buying authority unverified.' };
  };
  const people = (lead.people || []).map((person, index) => ({ suffix: `person:${lead.id}:${index}`, person: decorate(person, reviews.find(review => review.name.toLowerCase() === person.name.toLowerCase() && review.source === person.source)) }));
  for (const review of reviews.filter(review => !used.has(review.id))) people.push({ suffix: `published-person:${review.personKey}`, person: decorate({}, review) });
  return people;
}
