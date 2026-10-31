export const competitiveCategories = ['Direct', 'Indirect', 'Alternative'];
export const pricingLabels = { published: 'Published price passage', quote_required: 'Quote explicitly required', not_established: 'Pricing not established in reviewed pages' };
export const competitorContext = state => JSON.stringify({ company: state.company, products: state.productFamilies, capabilities: state.capabilities, commercial: state.commercial, icp: state.icp });
export function competitorDateFresh(value, hours = 24 * 30, clock = Date.now()) {
  const age = clock - Date.parse(value);
  return Number.isFinite(age) && age >= 0 && age <= hours * 3600000;
}
export const competitorReviewCurrent = (review, state, clock = Date.now()) => review?.status === 'reviewed' && state.approved && review.contextKey === competitorContext(state) && review.pages.every(page => competitorDateFresh(page.checkedAt, 24 * 30, clock));
// Literal excerpts are review proposals, never inferred facts or pricing claims.
export function proposeCompetitivePassages(name, identityText, detailText) {
  const excerpt = (text, index) => {
    if (index < 0) return '';
    let start = Math.max(0, index - 80), end = Math.min(text.length, index + 400);
    if (start) start = text.indexOf(' ', start) + 1;
    if (end < text.length) { const boundary = text.lastIndexOf(' ', end); if (boundary > index) end = boundary; }
    return text.slice(start, end).trim();
  };
  const pick = expression => excerpt(detailText, detailText.search(expression));
  const published = /(?:[$€£¥]\s*\d|\b(?:USD|EUR|GBP|CNY)\s*\d|\d\s*(?:USD|EUR|GBP|CNY)\b)/i;
  const quote = /quote|quotation|contact.{0,100}pric|request.{0,100}pric/i;
  const pricingMode = published.test(detailText) ? 'published' : quote.test(detailText) ? 'quote_required' : 'not_established';
  return { identityQuote: excerpt(identityText, identityText.toLowerCase().indexOf(name.toLowerCase())), positioningQuote: pick(/manufactur|hydraulic|cylinder|casting|wear part|provid|design/i), packagingQuote: pick(/series|package|\bkit\b|custom|standard|modular/i), differentiatorQuote: pick(/patent|warranty|certif|\bISO\b|pressure|quality|toleran|support/i), pricingMode, pricingQuote: pricingMode === 'not_established' ? '' : pick(pricingMode === 'published' ? published : quote), comparisonNote: '' };
}
export function competitiveReferences(state, catalog = state.competitors || []) {
  const reviews = state.competitorReviews || [];
  const references = [...catalog];
  for (const review of reviews) if (!references.some(item => item.id === review.referenceId)) references.push({ id: review.referenceId, name: review.name, category: review.category, source: review.pages[0].url, focus: 'Owner-added competitive reference', pricing: 'Not established', angle: 'Review source evidence before comparing.' });
  return references.map(reference => {
    const review = reviews.find(item => item.referenceId === reference.id && ['reviewed', 'needs_review'].includes(item.status));
    return { ...reference, review: review || null, current: !!review && competitorReviewCurrent(review, state) };
  });
}
