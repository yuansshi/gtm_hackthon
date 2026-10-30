import { randomUUID } from 'node:crypto';
import { AppError, addActivity, now } from './store.js';
import { costs } from './catalog.js';

export const creditPacks = [
  { id: 'starter', name: 'Quick reload', credits: 100 },
  { id: 'growth', name: 'Campaign reload', credits: 500 },
  { id: 'scale', name: 'Extended reload', credits: 1000 },
];
export const maxCustomCredits = 100000;
export const maxBalance = 1000000;
const amountFor = ({ packId, customCredits }) => {
  if (packId === 'custom') {
    if (!Number.isSafeInteger(customCredits) || customCredits < 1 || customCredits > maxCustomCredits) throw new AppError(400, `Enter a whole number from 1 to ${maxCustomCredits.toLocaleString()}.`, 'invalid_reload_amount');
    return customCredits;
  }
  const pack = creditPacks.find(p => p.id === packId);
  if (!pack || customCredits !== undefined) throw new AppError(400, 'Choose a supported credit pack or the custom option.', 'invalid_credit_pack');
  return pack.credits;
};
const sameRequest = (entry, packId, amount) => {
  if (entry.packId !== packId || entry.credits !== -amount) throw new AppError(409, 'This reload request was already used for a different amount.', 'reload_request_conflict');
  return entry;
};
export function reloadCredits(store, businessId, { packId, customCredits, requestId }) {
  const amount = amountFor({ packId, customCredits });
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new AppError(400, 'A valid reload request ID is required.', 'invalid_reload_request');
  const existing = store.read(businessId).wallet.ledger.find(e => e.kind === 'credit_reload' && e.requestId === requestId);
  if (existing) return sameRequest(existing, packId, amount);
  return store.mutate(businessId, s => {
    const duplicate = s.wallet.ledger.find(e => e.kind === 'credit_reload' && e.requestId === requestId);
    if (duplicate) return sameRequest(duplicate, packId, amount);
    if (s.wallet.credits + amount > maxBalance) throw new AppError(400, `The demo balance cannot exceed ${maxBalance.toLocaleString()} credits.`, 'balance_limit');
    const before = s.wallet.credits;
    const entry = { id: randomUUID(), requestId, kind: 'credit_reload', packId, businessId, credits: -amount, status: 'consumed', mode: 'demo', externalStatus: 'not_connected', actor: 'You', at: now(), balanceBefore: before, balanceAfter: before + amount, paymentStatus: 'not_charged' };
    entry.receiptNumber = `CR-${entry.at.slice(0, 10).replaceAll('-', '')}-${entry.id.slice(0, 8).toUpperCase()}`;
    s.wallet.credits += amount; s.wallet.ledger.unshift(entry);
    addActivity(s, 'Credits reloaded', `${amount.toLocaleString()} demo credits added to ${s.company.name}. No payment collected. Receipt ${entry.receiptNumber}.`, 'You', { receiptId: entry.id, mode: 'demo' });
    return entry;
  }).result;
}
export function billingSummary(state) {
  const entries = state.wallet.ledger;
  const reloads = entries.filter(e => e.credits < 0 && e.status === 'consumed');
  const consumed = entries.filter(e => e.credits > 0 && e.status === 'consumed').reduce((sum, e) => sum + e.credits, 0);
  const reserved = entries.filter(e => e.credits > 0 && e.status === 'reserved').reduce((sum, e) => sum + e.credits, 0);
  const refunded = entries.filter(e => e.credits > 0 && e.status === 'refunded').reduce((sum, e) => sum + e.credits, 0);
  return { mode: 'demo', businessId: state.businessId, owner: state.company.name, currency: 'demo credits', available: state.wallet.credits, included: state.wallet.initialCredits, reloaded: reloads.reduce((sum, e) => sum - e.credits, 0), consumed, reserved, refunded, reloadCount: reloads.length,
    lowBalance: state.wallet.credits < 10, packs: creditPacks, maxCustomCredits, maxBalance, costs,
    paymentStatus: 'No payment provider connected. Reloads add demo credits only.' };
}
