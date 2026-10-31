import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore, recoverInterruptedWork } from '../server/store.js';
import { createService } from '../server/service.js';
import { createGraph } from '../server/graph.js';
import { createApp } from '../server/app.js';
import { researchCatalog } from '../server/catalog.js';
import { scoreAccount } from '../server/evidence.js';
import { personReviewCurrent, projectedPeople } from '../src/people-evidence.js';

const former = 'Former Machinery';
const identityUrl = 'https://former.test/about';
const identityQuote = 'Former Machinery manufactures industrial equipment for OEM customers.';
const roleText = name => `${name} is Vice President of Engineering at Fixture Equipment. Before joining Fixture Equipment, ${name} worked at Former Machinery. Published employment dates are not provided.`;
const page = async url => ({ url, finalUrl: url, title: 'Synthetic company publication', text: url === identityUrl ? identityQuote : roleText(url.includes('buyer-b') ? 'Blair Brown' : 'Alex Adams'), checkedAt: new Date().toISOString(), fetchStatus: 'reachable' });
const memoryGraph = () => ({ sync: async () => {}, snapshot: async () => ({ nodes: [], edges: [] }), paths: async () => [] });
async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gtm-people-'));
  const store = createStore(directory), graph = options.native ? await createGraph(directory) : options.graph || memoryGraph();
  const calls = [];
  const service = createService({ store, graph, ...(options.model ? { model: options.model } : {}), readWebsiteSource: async url => { calls.push(url); return (options.source || page)(url); } });
  service.approveProfile('allco', true, store.read('allco').revision);
  store.mutate('allco', state => {
    state.peopleFixture = true;
    state.leads = ['a', 'b'].map((key, index) => ({ ...structuredClone(researchCatalog[index]), id: key, businessId: 'allco', fit: scoreAccount(researchCatalog[index], state), domain: `buyer-${key}.test`, source: `https://buyer-${key}.test/`, contactSource: `https://buyer-${key}.test/contact`, name: `Fixture Equipment ${key}`, people: [], selected: false, stage: 'Matched', events: [], contact: { email: null } }));
  });
  t.after(async () => { await graph.close?.(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const decision = overrides => ({ requestId: randomUUID(), revision: store.read('allco').revision, acknowledged: true, ...overrides });
  const start = (leadId = 'a', overrides = {}) => service.startPeopleResearch('allco', leadId, { requestId: randomUUID(), revision: store.read('allco').revision, sourceUrl: `https://buyer-${leadId}.test/team`, employerUrl: identityUrl, ...overrides });
  const review = async (leadId = 'a', overrides = {}) => {
    const run = start(leadId); await run.completion;
    const name = leadId === 'a' ? 'Alex Adams' : 'Blair Brown';
    const input = decision({ name, role: 'Vice President of Engineering', roleQuote: `${name} is Vice President of Engineering at Fixture Equipment.`, formerEmployer: { name: former, quote: `Before joining Fixture Equipment, ${name} worked at Former Machinery.`, identityQuote }, ...overrides });
    await service.reviewPerson('allco', leadId, run.id, input);
    return { run, input, record: store.read('allco').personReviews.find(item => item.id === input.requestId) };
  };
  return { directory, store, graph, service, calls, decision, start, review };
}

test('people retrieval reserves two credits, deduplicates and scopes before network', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const x = await setup(t, { source: async url => { await gate; return page(url); } });
  assert.throws(() => x.start('a', { sourceUrl: 'https://other.test/team' }), { code: 'source_site_mismatch' });
  assert.throws(() => x.start('a', { employerUrl: 'http://127.0.0.1/' }), { code: 'source_not_allowed' });
  assert.equal(x.calls.length, 0);
  const requestId = randomUUID(); const run = x.start('a', { requestId });
  assert.equal(x.store.read('allco').wallet.credits, 98);
  assert.equal(x.start('a', { requestId }).id, run.id);
  assert.throws(() => x.start('b', { requestId }), { code: 'person_request_conflict' });
  assert.throws(() => x.start('b'), { code: 'job_running' });
  release(); await run.completion;
  assert.equal(x.calls.length, 2);
  assert.equal(x.store.read('allco').wallet.ledger[0].status, 'consumed');
  assert.equal(x.store.read('huasheng').wallet.credits, 100);
});

test('credit, profile and revision gates perform no source calls', async t => {
  const x = await setup(t);
  assert.throws(() => x.start('a', { revision: 0 }), { code: 'revision_conflict' });
  x.store.mutate('allco', state => { state.wallet.credits = 1; });
  assert.throws(() => x.start(), { code: 'insufficient_credits' });
  x.store.mutate('allco', state => { state.approved = false; });
  assert.throws(() => x.start(), { code: 'profile_approval_required' });
  assert.equal(x.calls.length, 0);
});

test('retrieval failure and mid-flight source identity changes refund without admitting people', async t => {
  const x = await setup(t, { source: async () => { throw Error('private failure detail'); } });
  const run = x.start(); await run.completion;
  const state = x.store.read('allco');
  assert.equal(state.wallet.credits, 100); assert.equal(state.peopleResearch[0].status, 'failed');
  assert.doesNotMatch(state.peopleResearch[0].error, /private failure/); assert.equal(state.personReviews.length, 0);
  let release; const gate = new Promise(resolve => { release = resolve; });
  const y = await setup(t, { source: async url => { await gate; return page(url); } });
  const other = y.start(); y.store.mutate('allco', state => { state.leads[0].sourceIntakeId = 'changed'; });
  release(); await other.completion;
  assert.equal(y.store.read('allco').peopleResearch[0].errorCode, 'stale_person_context');
  assert.equal(y.store.read('allco').wallet.credits, 100);
});

test('role/history reviews require exact name, role, employer and separate identity quotes', async t => {
  const x = await setup(t); const run = x.start(); await run.completion;
  const input = x.decision({ name: 'Alex Adams', role: 'Vice President of Engineering', roleQuote: 'Alex Adams is Vice President of Engineering at Fixture Equipment.', formerEmployer: null });
  for (const patch of [{ acknowledged: false }, { role: 'CEO' }, { name: 'Invented Person' }, { roleQuote: 'Invented source text for this person' }, { formerEmployer: { name: former, quote: 'Alex Adams worked somewhere else.', identityQuote } }, { formerEmployer: { name: former, quote: roleText('Alex Adams'), identityQuote: 'Unrelated organization identity' } }]) {
    await assert.rejects(x.service.reviewPerson('allco', 'a', run.id, { ...input, ...patch }));
  }
  await x.service.reviewPerson('allco', 'a', run.id, input);
  const state = x.store.read('allco');
  assert.equal(state.personReviews[0].formerEmployer, null);
  assert.equal(state.leads[0].people.length, 0); assert.equal(state.leads[0].contact.email, null); assert.equal(state.leads[0].selected, false);
  await assert.rejects(x.service.reviewPerson('huasheng', 'a', run.id, input), { code: 'lead_not_found' });
});

test('expired, future and stale-profile snapshots cannot be accepted', async t => {
  const x = await setup(t); const run = x.start(); await run.completion;
  const input = x.decision({ name: 'Alex Adams', role: 'Vice President of Engineering', roleQuote: roleText('Alex Adams'), formerEmployer: null });
  x.store.mutate('allco', state => { state.peopleResearch[0].pages[0].checkedAt = new Date(Date.now() - 2 * 86400000).toISOString(); });
  await assert.rejects(x.service.reviewPerson('allco', 'a', run.id, { ...input, revision: x.store.read('allco').revision }), { code: 'person_source_expired' });
  x.store.mutate('allco', state => { state.peopleResearch[0].pages[0].checkedAt = new Date(Date.now() + 86400000).toISOString(); });
  await assert.rejects(x.service.reviewPerson('allco', 'a', run.id, { ...input, revision: x.store.read('allco').revision }), { code: 'person_source_expired' });
  x.store.mutate('allco', state => { state.icp.triggers = 'changed'; });
  await assert.rejects(x.service.reviewPerson('allco', 'a', run.id, { ...input, revision: x.store.read('allco').revision }), { code: 'stale_person_context' });
});

test('review, withdrawal and connection operations are durable and replay never restores withdrawn state', async t => {
  const x = await setup(t); const { run, input, record } = await x.review();
  const attest = x.decision({ reviewId: record.id, relationship: 'worked_together', note: 'PRIVATE_OWNER_NOTE' });
  await x.service.attestConnection('allco', 'a', attest);
  const revoke = x.decision({ connectionId: attest.requestId });
  await x.service.revokeConnection('allco', 'a', revoke);
  await x.service.attestConnection('allco', 'a', attest);
  assert.equal(x.store.read('allco').knownConnections[0].status, 'revoked');
  const withdraw = x.decision({ reviewId: record.id }); await x.service.withdrawPerson('allco', 'a', withdraw);
  await x.service.reviewPerson('allco', 'a', run.id, input); await x.service.withdrawPerson('allco', 'a', withdraw);
  assert.equal(x.store.read('allco').personReviews[0].status, 'withdrawn');
  await assert.rejects(x.service.attestConnection('allco', 'a', x.decision({ reviewId: record.id, relationship: 'worked_together', note: '' })), { code: 'stale_person_review' });
  await assert.rejects(x.service.reviewPerson('allco', 'a', run.id, { ...input, role: 'Different role' }), { code: 'person_request_conflict' });
});

test('graph projection repair retains decisions without applying again or charging', async t => {
  let broken = true; const graph = { ...memoryGraph(), sync: async () => { if (broken) throw Error('Projection failed'); } };
  const x = await setup(t, { graph }); const { run, input } = await x.review();
  assert.equal(x.store.read('allco').personOperations[0].graphStatus, 'pending');
  broken = false; await x.service.reviewPerson('allco', 'a', run.id, input);
  assert.equal(x.store.read('allco').personOperations[0].graphStatus, 'synced');
  assert.equal(x.store.read('allco').personReviews.length, 1); assert.equal(x.store.read('allco').wallet.credits, 98);
});

test('new reviews supersede exact identity without transferring local relationship attestations', async t => {
  const x = await setup(t); const first = await x.review();
  await x.service.attestConnection('allco', 'a', x.decision({ reviewId: first.record.id, relationship: 'know_personally', note: '' }));
  const next = await x.review(); const state = x.store.read('allco');
  assert.equal(next.record.personKey, first.record.personKey);
  assert.equal(state.personReviews.find(item => item.id === first.record.id).status, 'superseded');
  assert.equal(projectedPeople(state, state.leads[0])[0].person.knownConnection, null);
  assert.equal(personReviewCurrent(next.record, state.leads[0], Date.now() + 31 * 86400000), false);
});

test('restart recovers people retrieval without replay and preserves completed reviewed people', async t => {
  const x = await setup(t); await x.review();
  x.store.mutate('allco', state => { state.peopleResearch.unshift({ id: randomUUID(), leadId: 'b', status: 'running' }); state.jobs.unshift({ id: randomUUID(), kind: 'people_research', status: 'running' }); });
  x.store.reserve('allco', 'people_research', 2, 'b'); recoverInterruptedWork(x.store);
  const state = x.store.read('allco'); assert.equal(state.wallet.credits, 98);
  assert.equal(state.peopleResearch[0].status, 'failed'); assert.equal(state.personReviews[0].status, 'reviewed');
  assert.equal(x.calls.length, 2);
});

test('native Kuzu finds shared canonical former-employer paths only with reviewed people and active attestation', async t => {
  const x = await setup(t, { native: true }); const a = await x.review('a'); await x.review('b');
  assert.deepEqual(await x.graph.warmPaths('allco'), []);
  const input = x.decision({ reviewId: a.record.id, relationship: 'worked_together', note: 'PRIVATE_OWNER_NOTE' });
  await x.service.attestConnection('allco', 'a', input);
  const paths = await x.graph.warmPaths('allco');
  assert.equal(paths.length, 1); assert.equal(paths[0].person, 'Blair Brown'); assert.equal(paths[0].employer, former);
  assert.match(paths[0].relation, /previously_employed_at/); assert.match(paths[0].interpretation, /overlap.*unconfirmed/);
  assert.equal(paths[0].anchorEvidence.identitySource, identityUrl);
  assert.doesNotMatch(JSON.stringify(await x.graph.snapshot('allco')), /PRIVATE_OWNER_NOTE/);
  assert.deepEqual(await x.graph.warmPaths('huasheng'), []);
  await x.service.revokeConnection('allco', 'a', x.decision({ connectionId: input.requestId }));
  assert.deepEqual(await x.graph.warmPaths('allco'), []);
  assert.equal(x.store.read('allco').leads[0].stage, 'Matched');
});

test('native current-company paths, source changes, legacy name-only history and qualification holds', async t => {
  const x = await setup(t, { native: true }); const a = await x.review('a');
  const run = x.start('a', { sourceUrl: 'https://buyer-a.test/second', employerUrl: null }); await run.completion;
  x.store.mutate('allco', state => { state.peopleResearch.find(item => item.id === run.id).pages[0].text = roleText('Casey Clark'); });
  await x.service.reviewPerson('allco', 'a', run.id, x.decision({ name: 'Casey Clark', role: 'Vice President of Engineering', roleQuote: 'Casey Clark is Vice President of Engineering at Fixture Equipment.', formerEmployer: null }));
  await x.service.attestConnection('allco', 'a', x.decision({ reviewId: a.record.id, relationship: 'can_request_intro', note: '' }));
  let paths = await x.graph.warmPaths('allco'); assert.equal(paths.length, 1); assert.equal(paths[0].anchorEvidence.relationship, 'works_at');
  x.store.mutate('allco', state => { state.leads[0].excludedReason = 'Excluded'; state.leads[1].people = [{ name: 'Legacy Person', role: 'Engineer', source: 'https://buyer-b.test/', previousCompany: former }]; });
  await x.graph.sync(x.store.read('allco'), []); assert.deepEqual(await x.graph.warmPaths('allco'), []);
  x.store.mutate('allco', state => { state.leads[0].excludedReason = null; state.leads[0].evidenceNeedsReview = true; });
  await x.graph.sync(x.store.read('allco'), []); assert.deepEqual(await x.graph.warmPaths('allco'), []);
  const legacy = (await x.graph.snapshot('allco')).nodes.find(node => node.data.unresolvedIdentity); assert.ok(legacy);
});

test('HTTP people routes enforce session, CSRF, strict payloads and source scope', async t => {
  const x = await setup(t); const app = createApp({ store: x.store, service: x.service, serveStatic: false });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = { requestId: randomUUID(), revision: x.store.read('allco').revision, sourceUrl: 'https://buyer-a.test/team', employerUrl: null };
  const send = (route, value, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
  const route = '/api/businesses/allco/leads/a/people-research'; assert.equal((await send(route, body)).status, 401);
  const session = await send('/api/session', {}); const token = await session.json(); const headers = { Cookie: session.headers.get('set-cookie').split(';')[0], 'x-csrf-token': token.csrf };
  assert.equal((await send(route, body, { Cookie: headers.Cookie })).status, 403);
  assert.equal((await send(route, { ...body, name: 'Untrusted inferred name' }, headers)).status, 400);
  assert.equal((await send(route, { ...body, sourceUrl: 'https://other.test/team' }, headers)).status, 400);
  assert.equal((await send(route, body, headers)).status, 202);
  while (x.store.read('allco').jobs.some(job => job.status === 'running')) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(x.store.read('allco').peopleResearch[0].status, 'ready');
});

test('new source checks suspend accepted roles on changed passages or retrieval failure', async t => {
  let mode = 'good';
  const x = await setup(t, { native: true, source: async url => {
    if (mode === 'failed' && url.includes('buyer-a')) throw Error('Unavailable');
    return mode === 'changed' && url.includes('buyer-a') ? { ...await page(url), text: 'Fixture Equipment now publishes a different leadership page without the reviewed person.' } : page(url);
  } });
  let a = await x.review('a'); await x.review('b');
  await x.service.attestConnection('allco', 'a', x.decision({ reviewId: a.record.id, relationship: 'worked_together', note: '' }));
  assert.equal((await x.graph.warmPaths('allco')).length, 1);
  mode = 'changed'; const changed = x.start(); await changed.completion;
  assert.equal(x.store.read('allco').personReviews.find(item => item.id === a.record.id).status, 'needs_review');
  assert.deepEqual(await x.graph.warmPaths('allco'), []);
  mode = 'good'; a = await x.review('a');
  await x.service.attestConnection('allco', 'a', x.decision({ reviewId: a.record.id, relationship: 'worked_together', note: '' }));
  const before = x.store.read('allco').wallet.credits;
  mode = 'failed'; const failed = x.start(); await failed.completion;
  assert.equal(x.store.read('allco').wallet.credits, before);
  assert.equal(x.store.read('allco').personReviews.find(item => item.id === a.record.id).status, 'needs_review');
  assert.deepEqual(await x.graph.warmPaths('allco'), []);
});

test('canonical former-employer domain joins an existing current employer and expiry removes the route', async t => {
  const identity = 'Fixture Equipment b manufactures industrial equipment for OEM customers.';
  const formerQuote = 'Before joining Fixture Equipment, Alex Adams worked at Fixture Equipment b.';
  const x = await setup(t, { native: true, source: async url => {
    if (url === 'https://buyer-b.test/about') return { ...await page(url), text: identity };
    if (url.includes('buyer-a')) return { ...await page(url), text: `Alex Adams is Vice President of Engineering at Fixture Equipment. ${formerQuote}` };
    return page(url);
  } });
  const run = x.start('a', { employerUrl: 'https://buyer-b.test/about' }); await run.completion;
  const input = x.decision({ name: 'Alex Adams', role: 'Vice President of Engineering', roleQuote: 'Alex Adams is Vice President of Engineering at Fixture Equipment.', formerEmployer: { name: 'Fixture Equipment b', quote: formerQuote, identityQuote: identity } });
  await x.service.reviewPerson('allco', 'a', run.id, input); await x.review('b', { formerEmployer: null });
  await x.service.attestConnection('allco', 'a', x.decision({ reviewId: input.requestId, relationship: 'can_request_intro', note: '' }));
  const paths = await x.graph.warmPaths('allco');
  assert.equal(paths.length, 1); assert.equal(paths[0].anchorEvidence.relationship, 'previously_employed_at'); assert.equal(paths[0].targetEvidence.relationship, 'works_at');
  const companies = (await x.graph.snapshot('allco')).nodes.filter(node => node.type === 'Company');
  assert.equal(companies.filter(node => node.data.domain === 'buyer-b.test').length, 1);
  x.store.mutate('allco', state => { state.personReviews.find(item => item.leadId === 'b').checkedAt = new Date(Date.now() - 31 * 86400000).toISOString(); });
  await x.graph.sync(x.store.read('allco'), []); assert.deepEqual(await x.graph.warmPaths('allco'), []);
});

test('review overlay preserves indexed reply attribution and never projects private relationship notes', async t => {
  const x = await setup(t, { native: true });
  const at = new Date().toISOString();
  x.store.mutate('allco', state => {
    const person = { name: 'Alex Adams', role: 'Published original role', source: 'https://buyer-a.test/team' };
    state.leads[0].people = [person];
    state.drafts.push({ id: 'historical', businessId: 'allco', leadId: 'a', status: 'simulated', sentAt: at, channel: 'email', variant: 'A', sequenceStep: 0 });
    state.leads[0].events.push({ id: 'reply', recordType: 'outcome', stage: 'Replied', mode: 'dry_run', at, recordedAt: at, actor: 'You', note: 'Fixture reply', draftId: 'historical', respondent: person });
  });
  const a = await x.review(); const snapshot = await x.graph.snapshot('allco');
  assert.equal(snapshot.nodes.filter(node => node.type === 'Person').length, 1);
  assert.ok(snapshot.edges.some(edge => edge.type === 'replied_to' && edge.source === 'allco:person:a:0'));
  assert.equal(x.store.read('allco').leads[0].people[0].role, 'Published original role');
  await x.service.attestConnection('allco', 'a', x.decision({ reviewId: a.record.id, relationship: 'worked_together', note: 'PRIVATE_RELATIONSHIP' }));
  assert.doesNotMatch(JSON.stringify(await x.graph.snapshot('allco')), /PRIVATE_RELATIONSHIP/);
});

test('private connection notes and graph-only person reviews never enter model drafting', async t => {
  let sent;
  const model = { status: () => ({ configured: true }), requireConfigured: () => {}, draft: async input => {
    sent = input;
    return { value: { subject: 'Fixture qualification', body: 'Fixture introduction for engineering review.', claims: [{ text: 'Company', sourceUrl: 'https://buyer-a.test/' }], qualificationQuestions: [] }, metadata: { model: 'fixture-only', usage: { inputTokens: 1, outputTokens: 1 } } };
  } };
  const x = await setup(t, { model }); const a = await x.review();
  await x.service.attestConnection('allco', 'a', x.decision({ reviewId: a.record.id, relationship: 'worked_together', note: 'PRIVATE_RELATIONSHIP_NOTE' }));
  x.store.mutate('allco', state => { state.leads[0].selected = true; });
  await x.service.draftWithModel('allco', 'a', { requestId: randomUUID(), revision: x.store.read('allco').revision, acknowledgedExternalProcessing: true });
  assert.doesNotMatch(JSON.stringify(sent), /PRIVATE_RELATIONSHIP_NOTE|Alex Adams|worked_together/);
  assert.deepEqual(sent.context.account.people, []);
});
