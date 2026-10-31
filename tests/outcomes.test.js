import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createService } from '../server/service.js';
import { createGraph } from '../server/graph.js';
import { createApp } from '../server/app.js';
import { competitors, researchCatalog } from '../server/catalog.js';
import { scoreAccount } from '../server/evidence.js';
import { analyzePipeline } from '../src/pipeline-metrics.js';

const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const memoryGraph = () => ({ sync: async () => {}, snapshot: async id => ({ businessId: id, nodes: [], edges: [] }), paths: async () => [] });
async function setup(t, graph = memoryGraph()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gtm-outcome-'));
  const store = createStore(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  store.mutate('allco', state => {
    state.leads = [researchCatalog[0], researchCatalog[1]].map((candidate, index) => ({ ...candidate, businessId: 'allco', fit: scoreAccount(candidate, state), contact: { email: 'fixture@example.test', linkedIn: null, mailboxStatus: 'unverified' }, stage: 'Contacted', events: [{ stage: 'Matched', at: ago(180), mode: 'research', actor: 'Research agent' }, { stage: 'Contacted', at: ago(120), mode: index ? 'dry_run' : 'live', actor: index ? 'Outreach agent' : 'Provider fixture' }] }));
    state.drafts = [
      { id: 'accepted-a', businessId: 'allco', leadId: state.leads[0].id, status: 'accepted', channel: 'email', variant: 'A', sequenceStep: 0, sentAt: ago(120) },
      { id: 'dry-a', businessId: 'allco', leadId: state.leads[0].id, status: 'simulated', channel: 'email', variant: 'B', sequenceStep: 1, sentAt: ago(100) },
      { id: 'draft-a', businessId: 'allco', leadId: state.leads[0].id, status: 'draft', channel: 'email', variant: 'A', sequenceStep: 2 },
      { id: 'accepted-b', businessId: 'allco', leadId: state.leads[1].id, status: 'accepted', channel: 'email', variant: 'A', sequenceStep: 0, sentAt: ago(120) },
    ];
  });
  const service = createService({ store, graph });
  const leadId = store.read('allco').leads[0].id;
  const input = overrides => ({ requestId: randomUUID(), revision: store.read('allco').revision, kind: 'user_reported', stage: 'Replied', occurredAt: ago(10), note: 'Fixture: customer reports a supplier qualification response.', evidenceUrl: '', draftId: null, respondent: null, updateStage: true, acknowledged: true, ...overrides });
  return { directory, store, service, input, leadId, graph };
}

test('reports are scoped, confirmed, durable, free, and retry-safe even with an old revision', async t => {
  const { store, service, input, leadId } = await setup(t);
  const request = input();
  await assert.rejects(service.recordOutcome('allco', leadId, { ...request, acknowledged: false }), { code: 'outcome_review_required' });
  const [first, second] = await Promise.all([service.recordOutcome('allco', leadId, request), service.recordOutcome('allco', leadId, request)]);
  assert.equal(first.recordedOutcomeId, second.recordedOutcomeId);
  assert.equal(first.outcomeProjection, 'synced');
  const current = store.read('allco'); const outcome = current.leads[0].events.find(event => event.recordType === 'outcome');
  assert.equal(current.leads[0].events.filter(event => event.recordType === 'outcome').length, 1);
  assert.equal(current.activity.filter(event => event.title === 'User-reported outcome recorded').length, 1);
  assert.equal(current.leads[0].stage, 'Replied');
  assert.equal(outcome.mode, 'user_reported'); assert.equal(outcome.provenance, 'user_reported'); assert.equal(outcome.providerVerified, false); assert.equal(outcome.actor, 'You');
  assert.equal(current.wallet.credits, 100); assert.equal(current.wallet.ledger.length, 0);
  const revision = current.revision;
  assert.equal((await service.recordOutcome('allco', leadId, request)).outcomeReplay, true);
  assert.equal(store.read('allco').revision, revision);
  await assert.rejects(service.recordOutcome('allco', leadId, { ...request, note: 'Changed payload for an existing request.' }), { code: 'outcome_request_conflict' });
  await assert.rejects(service.recordOutcome('huasheng', leadId, request), { code: 'lead_not_found' });
  assert.equal(store.read('huasheng').leads.length, 0);
});

test('timestamp and revision guards preserve later stages while permitting explicit historical reports', async t => {
  const { store, service, input, leadId } = await setup(t);
  await assert.rejects(service.recordOutcome('allco', leadId, input({ occurredAt: new Date(Date.now() + 60000).toISOString() })), { code: 'invalid_outcome' });
  await assert.rejects(service.recordOutcome('allco', leadId, input({ occurredAt: '2026-02-30T12:00:00.000Z' })), { code: 'invalid_outcome' });
  await assert.rejects(service.recordOutcome('allco', leadId, input({ revision: 0 })), { code: 'revision_conflict' });
  await assert.rejects(service.recordOutcome('allco', leadId, input({ occurredAt: ago(150) })), { code: 'outcome_before_latest' });
  const result = await service.recordOutcome('allco', leadId, input({ occurredAt: ago(150), updateStage: false }));
  assert.equal(result.leads[0].stage, 'Contacted');
  assert.equal(result.leads[0].events.at(-1).stage, 'Replied');
  assert.equal(result.leads[0].events.at(-1).updateStage, false);
  assert.equal(result.metrics.replyRate, 0); // Historical reply preceded contact; it is not a conversion.
  assert.equal(result.metrics.replied, 1);
});

test('outbound attribution enforces account, business, immutable status, time, and actual/demo type', async t => {
  const { service, input, leadId } = await setup(t);
  for (const draftId of ['accepted-b', 'missing', 'draft-a']) await assert.rejects(service.recordOutcome('allco', leadId, input({ draftId })), { code: 'invalid_outcome_attribution' });
  await assert.rejects(service.recordOutcome('allco', leadId, input({ draftId: 'dry-a' })), { code: 'outcome_mode_mismatch' });
  await assert.rejects(service.recordOutcome('allco', leadId, input({ kind: 'demo', draftId: 'accepted-a' })), { code: 'outcome_mode_mismatch' });
  await assert.rejects(service.recordOutcome('allco', leadId, input({ draftId: 'accepted-a', occurredAt: ago(130), updateStage: false })), { code: 'outcome_before_message' });
  const result = await service.recordOutcome('allco', leadId, input({ draftId: 'accepted-a' }));
  assert.equal(result.leads[0].events.at(-1).draftId, 'accepted-a');
  const analytics = analyzePipeline(result);
  assert.equal(analytics.experiments.find(row => row.variant === 'A' && row.mode === 'live').replies, 1);
  assert.equal(analytics.experiments.find(row => row.variant === 'B').replies, 0);
});

test('demo feedback stays simulated, and published-person selection cannot manufacture a respondent', async t => {
  const { store, service, input, leadId } = await setup(t);
  const person = store.read('allco').leads[0].people[0];
  await assert.rejects(service.recordOutcome('allco', leadId, input({ respondent: { name: 'Fabricated buyer', source: person.source } })), { code: 'invalid_outcome_respondent' });
  await assert.rejects(service.recordOutcome('allco', leadId, input({ respondent: { name: person.name, source: 'https://wrong.example.test/' } })), { code: 'invalid_outcome_respondent' });
  await assert.rejects(service.recordOutcome('allco', leadId, input({ evidenceUrl: 'javascript:alert(1)' })), { code: 'invalid_outcome' });
  await assert.rejects(service.recordOutcome('allco', leadId, input({ evidenceUrl: 'https://user:secret@example.test/' })), { code: 'invalid_outcome' });
  const result = await service.recordOutcome('allco', leadId, input({ kind: 'demo', draftId: 'dry-a', respondent: { name: person.name, source: person.source }, note: 'Demo fixture only: a simulated qualification response.' }));
  const event = result.leads[0].events.at(-1);
  assert.equal(event.mode, 'dry_run'); assert.equal(event.providerVerified, false); assert.equal(event.respondent.role, person.role);
  assert.equal(analyzePipeline(result, { mode: 'live' }).reach.find(row => row.stage === 'Replied').count, 0);
  assert.equal(analyzePipeline(result).experiments.find(row => row.variant === 'B').replies, 1);
  const unlinkedDemo = await service.recordOutcome('allco', leadId, input({ kind: 'demo', stage: 'Meeting booked', occurredAt: ago(1) }));
  const noOutbound = { ...unlinkedDemo, drafts: [] };
  assert.equal(analyzePipeline(noOutbound).simulated, 0);
  assert.ok(analyzePipeline(noOutbound).demoEventAccounts > 0);
});

test('graph failure never loses a saved outcome, and retry repairs projection without replay or charge', async t => {
  const graph = memoryGraph(); let fail = true; graph.sync = async () => { if (fail) throw new Error('Fixture projection unavailable'); };
  const { store, service, input, leadId } = await setup(t, graph);
  const request = input();
  const saved = await service.recordOutcome('allco', leadId, request);
  assert.equal(saved.outcomeProjection, 'pending'); assert.equal(saved.leads[0].stage, 'Replied');
  assert.equal(saved.wallet.credits, 100);
  fail = false;
  const retried = await service.recordOutcome('allco', leadId, request);
  assert.equal(retried.recordedOutcomeId, saved.recordedOutcomeId); assert.equal(retried.outcomeProjection, 'synced');
  assert.equal(store.read('allco').leads[0].events.filter(event => event.recordType === 'outcome').length, 1);
  assert.equal(store.read('allco').wallet.credits, 100);
  fail = true;
  const another = await service.recordOutcome('allco', leadId, input({ stage: 'Meeting booked', occurredAt: ago(1) }));
  assert.equal(another.outcomeProjection, 'pending');
  fail = false;
  await service.graphView('allco');
  assert.ok(store.read('allco').leads[0].events.filter(event => event.recordType === 'outcome').every(event => event.graphStatus === 'synced'));
  assert.equal(store.read('allco').wallet.credits, 99); // Only the explicit graph query costs a credit.
});

test('new outcome context revokes only this account’s unsent approvals and invalidates stale acknowledgements', async t => {
  const { store, service, input, leadId } = await setup(t);
  service.approveProfile('allco', true, store.read('allco').revision);
  store.mutate('allco', state => state.leads.forEach(lead => { lead.selected = true; }));
  const approvedId = service.draft('allco', leadId, 'email', 'A', 0);
  const pendingId = service.draft('allco', leadId, 'email', 'A', 1);
  const otherId = service.draft('allco', store.read('allco').leads[1].id, 'email', 'B', 1);
  service.approveDraft('allco', approvedId, true, 1); service.approveDraft('allco', otherId, true, 1);
  const request = input();
  const result = await service.recordOutcome('allco', leadId, request);
  for (const id of [approvedId, pendingId]) {
    const draft = result.drafts.find(draft => draft.id === id);
    assert.equal(draft.status, 'draft'); assert.equal(draft.version, 2); assert.equal(draft.approvedHash, null);
    assert.equal(draft.contextOutcomeId, result.recordedOutcomeId);
    assert.throws(() => service.approveDraft('allco', id, true, 1), { code: 'stale_draft' });
  }
  assert.equal(result.drafts.find(draft => draft.id === otherId).status, 'approved');
  assert.equal(result.drafts.find(draft => draft.id === 'accepted-a').status, 'accepted');
  assert.equal(result.drafts.find(draft => draft.id === 'dry-a').status, 'simulated');
  service.approveDraft('allco', approvedId, true, 2);
  await service.recordOutcome('allco', leadId, request);
  assert.equal(store.read('allco').drafts.find(draft => draft.id === approvedId).status, 'approved');
  assert.equal(store.read('allco').drafts.find(draft => draft.id === approvedId).version, 2);
});

test('native graph projects labeled outcome signals and explicit published-person reply edges without crossing businesses', async t => {
  const { directory, store, input, leadId } = await setup(t);
  const graph = await createGraph(directory); t.after(() => graph.close());
  const service = createService({ store, graph });
  const person = store.read('allco').leads[0].people[0];
  const recorded = await service.recordOutcome('allco', leadId, input({ draftId: 'accepted-a', respondent: { name: person.name, source: person.source } }));
  const projected = await graph.snapshot('allco');
  const outcome = projected.nodes.find(node => node.id === `allco:outcome:${recorded.recordedOutcomeId}`);
  assert.equal(outcome.type, 'Signal'); assert.equal(outcome.data.providerVerified, false); assert.equal(outcome.data.provenance, 'user_reported');
  assert.ok(projected.edges.some(edge => edge.type === 'replied_to' && edge.target === 'allco:outreach:accepted-a' && edge.evidence.includes('not provider-verified')));
  await graph.sync(store.read('huasheng'), competitors.huasheng);
  assert.equal((await graph.snapshot('huasheng')).edges.filter(edge => edge.type === 'replied_to').length, 0);
  const countPeople = projected.nodes.filter(node => node.type === 'Person').length;
  await service.recordOutcome('allco', leadId, input({ stage: 'Meeting booked', occurredAt: ago(1), respondent: null }));
  assert.equal((await graph.snapshot('allco')).nodes.filter(node => node.type === 'Person').length, countPeople);
  const state = store.read('allco'); state.leads[0].people = [];
  await graph.sync(state, competitors.allco);
  const withoutPerson = await graph.snapshot('allco');
  assert.equal(withoutPerson.edges.filter(edge => edge.type === 'replied_to').length, 0);
  assert.ok(withoutPerson.nodes.some(node => node.id === outcome.id));
});

test('outcome notes and request deduplication survive a database restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gtm-outcome-persist-')); let store = createStore(directory);
  try {
    store.mutate('allco', state => { state.leads = [{ ...researchCatalog[0], businessId: 'allco', fit: scoreAccount(researchCatalog[0], state), stage: 'Matched', events: [] }]; });
    let service = createService({ store, graph: memoryGraph() });
    const request = { requestId: randomUUID(), revision: store.read('allco').revision, kind: 'user_reported', stage: 'Replied', occurredAt: ago(1), note: 'Offline reply fixture with no outbound attribution.', updateStage: true, acknowledged: true };
    const first = await service.recordOutcome('allco', researchCatalog[0].id, request);
    store.close(); store = createStore(directory); service = createService({ store, graph: memoryGraph() });
    const replay = await service.recordOutcome('allco', researchCatalog[0].id, request);
    assert.equal(replay.recordedOutcomeId, first.recordedOutcomeId); assert.equal(replay.outcomeReplay, true);
    assert.equal(replay.leads[0].events.length, 1); assert.equal(replay.leads[0].events[0].note, request.note);
    assert.equal(replay.metrics.replyRate, null); assert.equal(replay.wallet.credits, 100);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('outcome HTTP boundary requires session/CSRF and rejects forged attribution, actor, provider verification, and partial reports', async t => {
  const { store, service, input, leadId } = await setup(t);
  const server = createApp({ store, service, serveStatic: false }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}/api`;
  const url = `${root}/businesses/allco/leads/${leadId}/outcomes`;
  const post = (data, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) });
  assert.equal((await post(input())).status, 401);
  const session = await fetch(root + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const cookie = session.headers.get('set-cookie').split(';')[0]; const { csrf } = await session.json(); const headers = { cookie, 'x-csrf-token': csrf };
  assert.equal((await post(input(), { cookie })).status, 403);
  for (const fields of [{ actor: 'Provider' }, { mode: 'live' }, { providerVerified: true }, { graphStatus: 'synced' }, { businessId: 'huasheng' }]) assert.equal((await post({ ...input(), ...fields }, headers)).status, 400);
  assert.equal((await post({ stage: 'Replied' }, headers)).status, 400);
  const request = input(); const accepted = await post(request, headers); assert.equal(accepted.status, 200);
  const result = await accepted.json(); assert.equal(result.leads[0].events.at(-1).actor, 'You'); assert.equal(result.outcomeProjection, 'synced');
  const replay = await post(request, headers); assert.equal(replay.status, 200); assert.equal((await replay.json()).outcomeReplay, true);
});
