import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createGraph } from '../server/graph.js';
import { createService } from '../server/service.js';
import { createApp } from '../server/app.js';
import { researchCatalog, competitors } from '../server/catalog.js';
import { checkSourceUrl, privateAddress, reviewCandidate, checkMx, scoreAccount } from '../server/evidence.js';

const memoryGraph = { sync: async () => {}, snapshot: async id => ({ businessId: id, nodes: [], edges: [] }), paths: async () => [] };
async function setup(t, graph = memoryGraph, review) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gtm-test-'));
  const store = createStore(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const service = createService({ store, graph, review, mx: async () => ({ status: 'found', records: [{ exchange: 'mail.example.test', priority: 10 }] }) });
  const approve = () => service.approveProfile('allco', true, store.read('allco').revision);
  const seed = () => store.mutate('allco', s => { s.leads = [{ ...researchCatalog[0], fit: scoreAccount(researchCatalog[0], s), selected: true, stage: 'Matched', contact: { email: 'test@example.test', mailboxStatus: 'unverified' }, events: [{ stage: 'Matched', actor: 'fixture', at: new Date().toISOString() }] }]; });
  return { directory, store, service, approve, seed };
}
test('human approval cannot be bypassed; edits and profile changes invalidate it', async t => {
  const { store, service, approve, seed } = await setup(t); approve(); seed();
  const id = service.draft('allco', 'elliott');
  await assert.rejects(service.simulateSend('allco', id), { code: 'approval_required' });
  assert.throws(() => service.approveDraft('allco', id, false, 1), { code: 'stale_draft' });
  service.approveDraft('allco', id, true, 1);
  service.editDraft('allco', id, { body: 'Edited content' });
  await assert.rejects(service.simulateSend('allco', id), { code: 'approval_required' });
  assert.throws(() => service.approveDraft('allco', id, true, 1), { code: 'stale_draft' });
  service.approveDraft('allco', id, true, 2);
  service.saveProfile('allco', { icp: { ...store.read('allco').icp, regions: 'Canada' } }, store.read('allco').revision);
  await assert.rejects(service.simulateSend('allco', id), { code: 'approval_required' });
  assert.equal(store.read('allco').wallet.credits, 100);
  assert.throws(() => service.startDiscovery('allco'), { code: 'profile_approval_required' });
});
test('dry-run sends are idempotent, immutable, and prevent sending both A/B variants', async t => {
  const { store, service, approve, seed } = await setup(t); approve(); seed();
  const a = service.draft('allco', 'elliott', 'email', 'A'); const b = service.draft('allco', 'elliott', 'email', 'B');
  service.approveDraft('allco', a, true, 1); service.approveDraft('allco', b, true, 1);
  await Promise.all([service.simulateSend('allco', a), service.simulateSend('allco', a)]);
  assert.equal(store.read('allco').wallet.credits, 99);
  assert.equal(store.read('allco').wallet.ledger.length, 1);
  assert.equal(store.read('allco').leads[0].events.filter(e => e.stage === 'Contacted').length, 1);
  assert.throws(() => service.editDraft('allco', a, { body: 'changed after send' }), { code: 'draft_locked' });
  await assert.rejects(service.simulateSend('allco', b), { code: 'variant_already_sent' });
  assert.equal(service.snapshot('allco').metrics.liveAccepted, 0);
  assert.equal(service.snapshot('allco').metrics.simulated, 1);
});
test('quota enforcement happens before work and failed jobs refund once', async t => {
  let calls = 0;
  const { store, service, approve } = await setup(t, memoryGraph, async () => { calls++; throw new Error('Fixture failure'); }); approve();
  store.mutate('allco', s => { s.wallet.credits = 0; });
  assert.throws(() => service.startDiscovery('allco'), { code: 'insufficient_credits' }); assert.equal(calls, 0);
  store.mutate('allco', s => { s.wallet.credits = 10; });
  const job = service.startDiscovery('allco'); await job.completion;
  assert.equal(calls, 1); assert.equal(store.read('allco').wallet.credits, 10);
  store.settle('allco', job.reservation, false); assert.equal(store.read('allco').wallet.credits, 10);
  assert.equal(store.read('allco').jobs[0].status, 'failed'); assert.equal(store.read('allco').leads.length, 0);
});
test('business scoped IDs and revision conflicts protect independent workspaces', async t => {
  const { store, service, approve, seed } = await setup(t); approve(); seed();
  const id = service.draft('allco', 'elliott');
  assert.throws(() => service.selectLead('huasheng', 'elliott', true), { code: 'lead_not_found' });
  assert.throws(() => service.approveDraft('huasheng', id, true, 1), { code: 'draft_not_found' });
  assert.equal(store.read('huasheng').leads.length, 0);
  assert.throws(() => service.saveProfile('allco', {}, 0), { code: 'revision_conflict' });
});
test('new campaign exclusions block historic accounts without deleting their history', async t => {
  const { store, service, approve, seed } = await setup(t); approve(); seed();
  service.saveProfile('allco', { icp: { ...store.read('allco').icp, excludedDomains: 'www.elliottequip.com' } }, store.read('allco').revision);
  approve();
  assert.equal(store.read('allco').leads.length, 1);
  assert.equal(store.read('allco').leads[0].selected, false);
  assert.throws(() => service.selectLead('allco', 'elliott', true), { code: 'account_excluded' });
  await assert.rejects(service.enrich('allco', 'elliott'), { code: 'account_excluded' });
  assert.equal(store.read('allco').wallet.credits, 100);
});
test('research results from a changed profile never overwrite the new campaign', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const { store, service, approve } = await setup(t, memoryGraph, async candidate => { await gate; return candidate; }); approve();
  const job = service.startDiscovery('allco');
  assert.equal(service.startDiscovery('allco').id, job.id);
  service.saveProfile('allco', { icp: { ...store.read('allco').icp, regions: 'Canada' } }, store.read('allco').revision);
  release(); await job.completion;
  assert.equal(store.read('allco').leads.length, 0);
  assert.equal(store.read('allco').jobs[0].status, 'failed');
  assert.equal(store.read('allco').wallet.credits, 100);
});
test('SQLite keeps profiles and usage across restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gtm-persist-')); let store = createStore(directory);
  try {
    store.mutate('allco', s => { s.company.name = 'Persistence fixture'; });
    const entry = store.reserve('allco', 'graph_query', 1); store.settle('allco', entry, true);
    store.close(); store = createStore(directory);
    assert.equal(store.read('allco').company.name, 'Persistence fixture');
    assert.equal(store.read('allco').wallet.credits, 99);
    assert.equal(store.read('huasheng').wallet.credits, 100);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
test('native Kuzu persists directional multi-hop paths without crossing businesses', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtm-native-'));
  const store = createStore(dir); let graph = await createGraph(dir);
  try {
    store.mutate('allco', s => { s.leads = [researchCatalog[0]]; });
    await graph.sync(store.read('allco'), competitors.allco); await graph.sync(store.read('huasheng'), competitors.huasheng);
    assert.equal((await graph.paths('allco'))[0].person, 'Andrew Schumacher');
    assert.equal((await graph.paths('huasheng')).length, 0);
    assert.ok((await graph.snapshot('allco')).edges.some(e => e.type === 'previously_employed_at'));
    await graph.close(); graph = await createGraph(dir);
    assert.equal((await graph.paths('allco'))[0].company, 'Elliott Equipment Company');
    assert.ok((await graph.snapshot('huasheng')).nodes.every(n => n.id.startsWith('huasheng:')));
    store.mutate('allco', s => { s.leads[0].excludedReason = 'Outside the revised campaign'; });
    await graph.sync(store.read('allco'), competitors.allco);
    assert.equal((await graph.paths('allco')).length, 0);
    assert.ok((await graph.snapshot('allco')).nodes.some(n => n.name === 'Elliott Equipment Company'));
  } finally { await graph.close(); store.close(); await rm(dir, { recursive: true, force: true }); }
});
test('source fetches reject private destinations and MX never claims mailbox verification', async () => {
  assert.ok(privateAddress('127.0.0.1')); assert.ok(privateAddress('::1')); assert.ok(!privateAddress('8.8.8.8'));
  await assert.rejects(checkSourceUrl('http://elliottequip.com/'), { code: 'source_not_allowed' });
  await assert.rejects(checkSourceUrl('https://example.test/'), { code: 'source_not_allowed' });
  await assert.rejects(checkSourceUrl('https://elliottequip.com/', async () => [{ address: '192.168.1.2' }]), { code: 'private_source' });
  assert.equal((await checkMx('test@example.test', async () => [{ exchange: '.', priority: 0 }])).status, 'missing');
  const reviewed = await reviewCandidate(researchCatalog[0], { businessId: 'allco', icp: { regions: 'US', segments: ['OEM'] } }, { readSource: async url => ({url, title:'Test source', text:'Primary evidence fixture', checkedAt:new Date().toISOString(), fetchStatus:'reachable'}) });
  assert.equal(reviewed.contact.mailboxStatus, 'unverified'); assert.equal(reviewed.sourceReviews[0].fetchStatus, 'reachable');
});
test('API requires a session, CSRF, permitted Origin and typed scoped requests', async t => {
  const { store, service } = await setup(t);
  const app = createApp({ store, service, serveStatic: false }); const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}/api`;
  assert.equal((await fetch(root + '/businesses/allco')).status, 401);
  const session = await fetch(root + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const cookie = session.headers.get('set-cookie').split(';')[0]; const { csrf } = await session.json();
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf };
  assert.equal((await fetch(root + '/businesses/allco/credits', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(root + '/businesses/allco/credits', { method: 'POST', headers: { ...headers, 'x-csrf-token': 'é'.repeat(64) }, body: '{}' })).status, 403);
  assert.equal((await fetch(root + '/businesses/allco/credits', { method: 'POST', headers: { ...headers, origin: 'https://hostile.test' }, body: '{}' })).status, 403);
  assert.equal((await fetch(root + '/businesses/allco/profile', { method: 'PUT', headers, body: JSON.stringify({ profile: { approved: true }, revision: 0 }) })).status, 400);
  assert.equal((await fetch(root + '/businesses/unknown', { headers })).status, 404);
  assert.equal((await fetch(root + '/businesses/allco', { headers })).status, 200);
});
