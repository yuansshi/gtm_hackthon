export const signalKinds = {
  leadership: 'Leadership appointment', hiring: 'Hiring activity', expansion: 'Facility expansion',
  product_launch: 'Product launch', funding: 'Funding announcement', negative: 'Hiring freeze or closure',
};
const day = 86400000;
export function signalFresh(signal, asOf = Date.now()) {
  const event = Date.parse(`${signal.eventDate}T00:00:00.000Z`), checked = Date.parse(signal.checkedAt);
  return signal.status === 'accepted' && signal.kind !== 'negative' && event <= asOf && asOf - event <= 180 * day && checked <= asOf && asOf - checked <= 7 * day;
}
export const activeSignals = (lead, asOf = Date.now()) => (lead.marketSignals || []).filter(signal => signalFresh(signal, asOf));
export const signalHold = lead => (lead.marketSignals || []).some(signal => signal.kind === 'negative' && ['accepted', 'needs_review'].includes(signal.status) && signal.acceptedAt);
export const signalContext = lead => (lead.marketSignals || []).filter(signal => signal.acceptedAt).map(signal => ({ id: signal.id, status: signal.status, kind: signal.kind, quote: signal.quote, dateQuote: signal.dateQuote, eventDate: signal.eventDate }));
