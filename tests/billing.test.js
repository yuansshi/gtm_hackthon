import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { reloadCredits, billingSummary, maxBalance } from '../server/billing.js';
import { createService } from '../server/service.js';
import { createApp } from '../server/app.js';

const graph = { sync: async () => {}, snapshot: async businessId => ({ businessId, nodes: [], edges: [] }), paths: async () => [] };
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtm-billing-')); const store = createStore(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  return { store, service: createService({ store, graph }) };
}
test('reloading is atomic, repeat-safe, business scoped and preserves profile approval', async t => {
  const { store, service } = await fixture(t); service.approveProfile('allco', true, store.read('allco').revision);
  const request = { packId: 'growth', requestId: randomUUID() };
  const receipt = reloadCredits(store, 'allco', request);
  assert.equal(receipt.balanceBefore, 100); assert.equal(receipt.balanceAfter, 600); assert.equal(receipt.paymentStatus, 'not_charged');
  assert.equal(reloadCredits(store, 'allco', request).id, receipt.id);
  assert.equal(store.read('allco').wallet.ledger.length, 1); assert.equal(store.read('allco').wallet.credits, 600);
  assert.equal(store.read('allco').approved, true); assert.equal(store.read('huasheng').wallet.credits, 100);
  assert.throws(() => reloadCredits(store, 'allco', { ...request, packId: 'starter' }), { code: 'reload_request_conflict' });
  const other = reloadCredits(store, 'huasheng', request); assert.notEqual(other.id, receipt.id); assert.equal(other.businessId, 'huasheng');
});
test('custom reload amounts and maximum balances reject invalid requests before granting credits', async t => {
  const { store } = await fixture(t);
  for (const customCredits of [-1, 0, 1.5, NaN, Infinity, 100001, '100']) assert.throws(() => reloadCredits(store, 'allco', { packId: 'custom', customCredits, requestId: randomUUID() }), { code: 'invalid_reload_amount' });
  assert.throws(() => reloadCredits(store, 'allco', { packId: 'starter', customCredits: 10000, requestId: randomUUID() }), { code: 'invalid_credit_pack' });
  assert.throws(() => reloadCredits(store, 'allco', { packId: 'unknown', requestId: randomUUID() }), { code: 'invalid_credit_pack' });
  assert.equal(store.read('allco').wallet.credits, 100); assert.equal(store.read('allco').wallet.ledger.length, 0);
  store.mutate('allco', s => { s.wallet.credits = maxBalance - 5; });
  assert.throws(() => reloadCredits(store, 'allco', { packId: 'starter', requestId: randomUUID() }), { code: 'balance_limit' });
  reloadCredits(store, 'allco', { packId: 'custom', customCredits: 5, requestId: randomUUID() });
  assert.equal(store.read('allco').wallet.credits, maxBalance);
});
test('a reload restores access after insufficient credits and usage/refund totals reconcile', async t => {
  const { store, service } = await fixture(t);
  const reserve = store.reserve('allco', 'discovery', 100); store.settle('allco', reserve, true);
  await assert.rejects(service.graphView('allco'), { code: 'insufficient_credits' });
  reloadCredits(store, 'allco', { packId: 'custom', customCredits: 10, requestId: randomUUID() });
  await service.graphView('allco');
  const pending = store.reserve('allco', 'enrichment', 5);
  assert.equal(billingSummary(store.read('allco')).reserved, 5); store.settle('allco', pending, false);
  const summary = billingSummary(store.read('allco'));
  assert.equal(summary.available, 9); assert.equal(summary.reloaded, 10); assert.equal(summary.consumed, 101); assert.equal(summary.refunded, 5); assert.equal(summary.reserved, 0); assert.equal(summary.lowBalance, true);
});
test('credit balances, receipts and reload deduplication survive a database restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtm-reload-persist-')); let store = createStore(dir);
  try {
    const request = { packId: 'custom', customCredits: 237, requestId: randomUUID() };
    const receipt = reloadCredits(store, 'allco', request); store.close(); store = createStore(dir);
    assert.equal(store.read('allco').wallet.credits, 337); assert.equal(reloadCredits(store, 'allco', request).receiptNumber, receipt.receiptNumber);
    assert.equal(store.read('allco').wallet.ledger.length, 1);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
test('reload HTTP API validates payloads, rejects forged balance grants, and reset retains billing', async t => {
  const { store, service } = await fixture(t); const server = createApp({ store, service, serveStatic: false }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}/api`;
  const session = await fetch(root + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const cookie = session.headers.get('set-cookie').split(';')[0]; const { csrf } = await session.json(); const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf };
  const post = (route, body) => fetch(root + '/businesses/allco' + route, { method: 'POST', headers, body: JSON.stringify(body) });
  const request = { packId: 'starter', requestId: randomUUID() };
  for (const body of [{ ...request, credits: 999999 }, { ...request, balanceAfter: 5000 }, { ...request, businessId: 'huasheng' }, { packId: 'starter' }, { packId: 'custom', customCredits: -10, requestId: randomUUID() }]) assert.equal((await post('/billing/reloads', body)).status, 400);
  assert.equal((await post('/credits', {})).status, 400);
  const first = await post('/billing/reloads', request); assert.equal(first.status, 200); const data = await first.json();
  const second = await post('/billing/reloads', request); assert.equal(second.status, 200); assert.equal((await second.json()).reloadReceipt.id, data.reloadReceipt.id);
  assert.equal(store.read('allco').wallet.credits, 200); assert.equal(store.read('allco').wallet.ledger.length, 1);
  assert.equal((await post('/reset', {})).status, 200); assert.equal((await post('/reset', {})).status, 200);
  assert.equal(store.read('allco').wallet.credits, 200); assert.equal(store.read('allco').wallet.ledger[0].receiptNumber, data.reloadReceipt.receiptNumber);
  assert.equal(store.read('huasheng').wallet.credits, 100);
});
