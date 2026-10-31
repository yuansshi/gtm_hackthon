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
import { researchCatalog, competitors } from '../server/catalog.js';
import { educationReviewCurrent } from '../src/education-evidence.js';
import { initialBusinessState } from '../src/businesses.js';
import { graphContextKey } from '../src/graph-context.js';

const school = 'Fixture University', identityUrl = 'https://school.test/about', identityQuote = 'Fixture University is a public university with engineering education programs.';
const names = { a: 'Alex Adams', b: 'Blair Brown' };
const roleQuote = id => `${names[id]} is Engineering Director at Fixture Equipment ${id}.`;
const educationQuote = id => `${names[id]} graduated from Fixture University with a degree in mechanical engineering.`;
const memoryGraph = { sync: async () => {}, snapshot: async id => ({ businessId: id, nodes: [], edges: [] }), paths: async () => [] };
async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gtm-education-')), store = createStore(directory), graph = options.native ? await createGraph(directory) : options.graph || memoryGraph;
  const texts = new Map([[identityUrl, identityQuote], ['https://buyer-a.test/team', roleQuote('a') + ' ' + educationQuote('a')], ['https://buyer-b.test/team', roleQuote('b') + ' ' + educationQuote('b')]]), calls = [];
  const service = createService({ store, graph, ...(options.model ? { model: options.model } : {}), readWebsiteSource: async url => { calls.push(url); if (options.read) return options.read(url, texts); const text = texts.get(url); if (text instanceof Error) throw text; return { url, text, checkedAt: new Date().toISOString(), fetchStatus: 'reachable', title: 'Synthetic education source' }; } });
  service.approveProfile('allco', true, store.read('allco').revision);
  store.mutate('allco', state => { state.educationFixture = true; state.leads = ['a', 'b'].map(id => ({ ...structuredClone(researchCatalog[0]), id, name: `Fixture Equipment ${id}`, domain: `buyer-${id}.test`, source: `https://buyer-${id}.test/`, contactSource: `https://buyer-${id}.test/contact`, contact: { email: `office@buyer-${id}.test` }, people: [], events: [], fit: { score: 80, tier: 'A' }, stage: 'Matched', selected: false })); });
  const decision = extra => ({ requestId: randomUUID(), revision: store.read('allco').revision, acknowledged: true, ...extra });
  const person = id => store.read('allco').personReviews.find(item => item.leadId === id && item.status === 'reviewed');
  const reviewPerson = async id => { const run = service.startPeopleResearch('allco', id, decision({ sourceUrl: `https://buyer-${id}.test/team`, employerUrl: null })); await run.completion; await service.reviewPerson('allco', id, run.id, decision({ name: names[id], role: 'Engineering Director', roleQuote: roleQuote(id), formerEmployer: null })); return person(id); };
  const start = (id = 'a', extra = {}) => service.startEducationResearch('allco', id, decision({ personReviewId: person(id)?.id, identityUrl, ...extra }));
  const input = (id = 'a', extra = {}) => decision({ institutionName: school, kind: 'degree', educationQuote: educationQuote(id), identityQuote, ...extra });
  const review = async (id = 'a', extra = {}) => { const run = start(id); await run.completion; const values = input(id, extra); await service.reviewEducation('allco', id, run.id, values); return { run, input: values, record: store.read('allco').educationReviews.find(item => item.id === values.requestId) }; };
  const attest = () => service.attestConnection('allco', 'a', decision({ reviewId: person('a').id, relationship: 'know_personally', note: 'PRIVATE_EDUCATION_CONNECTION_NOTE' }));
  t.after(async () => { await graph.close?.(); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, store, graph, service, texts, calls, decision, person, reviewPerson, start, input, review, attest };
}
test('education fetch requires exact current person/account scope, separate identity source, profile/revision and available credits before network', async t => {
  const x = await setup(t); assert.throws(() => x.start(), { code: 'person_review_not_found' }); await x.reviewPerson('a'); const calls = x.calls.length;
  for (const [patch, code] of [[{ identityUrl: 'https://buyer-a.test/about' }, 'institution_identity_required'], [{ identityUrl: 'http://127.0.0.1/' }, 'source_not_allowed'], [{ revision: 0 }, 'revision_conflict'], [{ requestId: 'invalid' }, 'invalid_education_request']]) assert.throws(() => x.start('a', patch), { code });
  assert.throws(() => x.service.startEducationResearch('huasheng', 'a', x.decision({ personReviewId: x.person('a').id, identityUrl })), { code: 'lead_not_found' });
  x.store.mutate('allco', state => { state.wallet.credits = 1; }); assert.throws(() => x.start(), { code: 'insufficient_credits' });
  x.store.mutate('allco', state => { state.wallet.credits = 100; state.approved = false; }); assert.throws(() => x.start(), { code: 'education_person_review_required' }); assert.equal(x.calls.length, calls);
});
test('fetch is bounded to two sources, billed once, deduplicated, and never admits education automatically', async t => {
  const x = await setup(t); await x.reviewPerson('a'); const credits = x.store.read('allco').wallet.credits;
  const request = x.decision({ personReviewId: x.person('a').id, identityUrl }), run = x.service.startEducationResearch('allco', 'a', request);
  assert.equal(x.service.startEducationResearch('allco', 'a', request).id, run.id);
  assert.throws(() => x.service.startEducationResearch('allco', 'a', { ...request, identityUrl: 'https://other.test/about' }), { code: 'education_request_conflict' }); await run.completion;
  const state = x.store.read('allco'); assert.equal(state.wallet.credits, credits - 2); assert.equal(state.educationResearch[0].pages.length, 2); assert.equal(state.educationReviews.length, 0); assert.equal(state.wallet.ledger[0].kind, 'people_research'); assert.equal(state.wallet.ledger[0].researchType, 'education'); assert.equal(state.leads[0].contact.email, 'office@buyer-a.test');
});
test('review requires acknowledgement, literal name/identity/education quotes and explicit education wording', async t => {
  const x = await setup(t); await x.reviewPerson('a'); const run = x.start(); await run.completion;
  for (const patch of [{ acknowledged: false }, { institutionName: 'Invented University' }, { educationQuote: 'Alex Adams attended an invented school not in the page.' }, { identityQuote: 'Fixture University has an invented identity description.' }, { kind: 'invented' }]) await assert.rejects(x.service.reviewEducation('allco', 'a', run.id, x.input('a', patch)));
  x.texts.set('https://buyer-a.test/team', roleQuote('a') + ' Alex Adams partnered with Fixture University on a procurement project.'); const next = x.start(); await next.completion;
  await assert.rejects(x.service.reviewEducation('allco', 'a', next.id, x.input('a', { kind: 'attended', educationQuote: 'Alex Adams partnered with Fixture University on a procurement project.' })), { code: 'education_claim_required' }); assert.equal(x.store.read('allco').educationReviews.length, 0);
});
test('expired/future snapshots and changed profile contexts cannot be accepted', async t => {
  const x = await setup(t); await x.reviewPerson('a'); const run = x.start(); await run.completion;
  for (const offset of [-2, 1]) { x.store.mutate('allco', state => { state.educationResearch[0].pages[0].checkedAt = new Date(Date.now() + offset * 86400000).toISOString(); }); await assert.rejects(x.service.reviewEducation('allco', 'a', run.id, x.input()), { code: 'education_source_expired' }); }
  x.store.mutate('allco', state => { state.educationResearch[0].pages[0].checkedAt = new Date().toISOString(); state.icp.triggers = 'Changed campaign'; }); await assert.rejects(x.service.reviewEducation('allco', 'a', run.id, x.input()), { code: 'stale_education_context' });
});
test('decision replay, withdrawal, supersession and graph repair never revive old evidence or repeat charges', async t => {
  let broken = false; const graph = { ...memoryGraph, sync: async () => { if (broken) throw Error('Fixture projection failure'); } }; const x = await setup(t, { graph }); await x.reviewPerson('a'); broken = true;
  const first = await x.review(), credits = x.store.read('allco').wallet.credits; assert.equal(x.store.read('allco').educationOperations[0].graphStatus, 'pending');
  broken = false; await x.service.reviewEducation('allco', 'a', first.run.id, first.input); assert.equal(x.store.read('allco').educationOperations[0].graphStatus, 'synced'); assert.equal(x.store.read('allco').wallet.credits, credits);
  const second = await x.review(); assert.equal(x.store.read('allco').educationReviews.find(item => item.id === first.record.id).status, 'superseded');
  const withdrawal = x.decision({ reviewId: second.record.id }); await x.service.withdrawEducation('allco', 'a', withdrawal); await x.service.reviewEducation('allco', 'a', second.run.id, second.input); await x.service.withdrawEducation('allco', 'a', withdrawal);
  assert.equal(x.store.read('allco').educationReviews[0].status, 'withdrawn');
  await assert.rejects(x.service.reviewEducation('allco', 'a', first.run.id, { ...first.input, kind: 'attended' }), { code: 'education_request_conflict' });
});
test('native Kuzu exposes an education-only warm path with both passages and no private relationship note', async t => {
  const x = await setup(t, { native: true }); for (const id of ['a', 'b']) { await x.reviewPerson(id); await x.review(id); }
  assert.equal((await x.graph.educationPaths('allco')).length, 0); await x.attest();
  const paths = await x.graph.educationPaths('allco'); assert.equal(paths.length, 1); assert.equal(paths[0].institution, school); assert.equal(paths[0].leadId, 'b'); assert.match(paths[0].relation, /studied_at/); assert.equal(paths[0].targetEvidence.quote, educationQuote('b')); assert.equal(paths[0].anchorEvidence.institution.identityQuote, identityQuote); assert.equal((await x.graph.warmPaths('allco')).length, 0); assert.equal((await x.graph.educationPaths('huasheng')).length, 0);
  const snapshot = await x.graph.snapshot('allco'); assert.equal(snapshot.nodes.filter(item => item.type === 'Institution').length, 1); assert.equal(snapshot.edges.filter(item => item.type === 'studied_at').length, 2); assert.ok(snapshot.edges.some(item => item.educationEvidence?.quote === educationQuote('a'))); assert.doesNotMatch(JSON.stringify([paths, snapshot]), /PRIVATE_EDUCATION_CONNECTION_NOTE/);
  assert.equal((await x.graph.educationPaths('allco', Date.now() + 31 * 86400000)).length, 0);
  const view = await x.service.graphView('allco'); assert.equal(view.educationPaths[0].leadId, 'b'); assert.equal(view.contextKey, graphContextKey(x.store.read('allco'), competitors.allco));
  x.store.mutate('allco', state => { state.leads[1].excludedReason = 'Outside revised campaign'; }); await x.graph.sync(x.store.read('allco'), competitors.allco); assert.equal((await x.graph.educationPaths('allco')).length, 0);
});
test('native education traversal caps results at 100 without a cross-business path', async t => {
  const x = await setup(t, { native: true }); for (const id of ['a', 'b']) { await x.reviewPerson(id); await x.review(id); } await x.attest();
  x.store.mutate('allco', state => {
    const person = state.personReviews.find(item => item.leadId === 'b'), education = state.educationReviews.find(item => item.leadId === 'b');
    for (let index = 0; index < 100; index++) {
      const id = randomUUID(), personKey = person.personKey + '-' + index, name = `Synthetic Graduate ${index}`;
      state.personReviews.push({ ...structuredClone(person), id, personKey, name, roleQuote: `${name} is Engineering Director at Fixture Equipment b.` });
      state.educationReviews.push({ ...structuredClone(education), id: randomUUID(), personReviewId: id, personKey, quote: `${name} graduated from Fixture University with a degree in mechanical engineering.` });
    }
  });
  await x.graph.sync(x.store.read('allco'), competitors.allco); const paths = await x.graph.educationPaths('allco'); assert.equal(paths.length, 100); assert.equal(new Set(paths.map(item => item.id)).size, 100); assert.ok(paths.every(item => item.leadId === 'b')); assert.equal((await x.graph.educationPaths('huasheng')).length, 0);
});
test('institution names alone and shared domains with different full names never produce an education path', async t => {
  const x = await setup(t, { native: true }); for (const id of ['a', 'b']) await x.reviewPerson(id); await x.review('a'); await x.attest();
  const otherIdentity = 'https://other-school.test/about'; x.texts.set(otherIdentity, identityQuote); let run = x.start('b', { identityUrl: otherIdentity }); await run.completion; await x.service.reviewEducation('allco', 'b', run.id, x.input('b'));
  assert.equal((await x.graph.educationPaths('allco')).length, 0);
  x.texts.set(identityUrl, identityQuote + ' Fixture College is a separate school on the same website.'); x.texts.set('https://buyer-b.test/team', roleQuote('b') + ' Blair Brown attended Fixture College for mechanical engineering study.');
  run = x.start('b'); await run.completion; await x.service.reviewEducation('allco', 'b', run.id, x.input('b', { institutionName: 'Fixture College', kind: 'attended', educationQuote: 'Blair Brown attended Fixture College for mechanical engineering study.', identityQuote: 'Fixture College is a separate school on the same website.' })); assert.equal((await x.graph.educationPaths('allco')).length, 0);
});
test('withdrawn education, revoked connections and replaced person reviews remove native path support', async t => {
  const x = await setup(t, { native: true }); for (const id of ['a', 'b']) { await x.reviewPerson(id); await x.review(id); } await x.attest();
  let state = x.store.read('allco'); const connection = state.knownConnections[0]; await x.service.revokeConnection('allco', 'a', x.decision({ connectionId: connection.id })); assert.equal((await x.graph.educationPaths('allco')).length, 0);
  await x.attest(); const review = x.store.read('allco').educationReviews.find(item => item.leadId === 'b'); await x.service.withdrawEducation('allco', 'b', x.decision({ reviewId: review.id })); assert.equal((await x.graph.educationPaths('allco')).length, 0);
  await x.review('b'); assert.equal((await x.graph.educationPaths('allco')).length, 1); await x.reviewPerson('a'); assert.equal((await x.graph.educationPaths('allco')).length, 0); state = x.store.read('allco'); assert.equal(educationReviewCurrent(state.educationReviews.find(item => item.leadId === 'a'), state, state.leads[0]), false);
});
test('source refreshes fail closed after lost biography or identity passages, including refresh from the people workflow', async t => {
  const x = await setup(t, { native: true }); for (const id of ['a', 'b']) { await x.reviewPerson(id); await x.review(id); } await x.attest();
  x.texts.set('https://buyer-a.test/team', roleQuote('a') + ' This biography no longer publishes education evidence.'); const personRun = x.service.startPeopleResearch('allco', 'a', x.decision({ sourceUrl: 'https://buyer-a.test/team', employerUrl: null })); await personRun.completion;
  assert.equal(x.store.read('allco').educationReviews.find(item => item.leadId === 'a').status, 'needs_review'); assert.equal((await x.graph.educationPaths('allco')).length, 0);
  x.texts.set('https://buyer-a.test/team', roleQuote('a') + ' ' + educationQuote('a')); await x.review('a'); assert.equal((await x.graph.educationPaths('allco')).length, 1);
  x.texts.set(identityUrl, new Error('Private origin failure')); const before = x.store.read('allco').wallet.credits, run = x.start(); await run.completion;
  assert.equal(x.store.read('allco').wallet.credits, before); assert.equal((await x.graph.educationPaths('allco')).length, 0); assert.ok(x.store.read('allco').educationReviews.filter(item => item.status === 'needs_review').length >= 2); assert.doesNotMatch(x.store.read('allco').educationResearch[0].error, /Private origin/);
});
test('in-flight profile, account/person or do-not-contact changes discard results and refund once', async t => {
  for (const kind of ['profile', 'account', 'person', 'hold_release']) {
    let resolve; const gate = new Promise(done => { resolve = done; }); let block = false;
    const x = await setup(t, { read: async (url, texts) => { if (block) await gate; return { url, text: texts.get(url), checkedAt: new Date().toISOString(), fetchStatus: 'reachable' }; } }); await x.reviewPerson('a'); block = true;
    const credits = x.store.read('allco').wallet.credits, run = x.start();
    if (kind === 'hold_release') { x.service.holdCommunication('allco', x.decision({ kind: 'account', target: 'buyer-a.test', reason: 'opt_out', reportedAt: new Date().toISOString(), note: 'Fixture hold' })); const hold = x.store.read('allco').communicationRestrictions[0]; x.service.releaseCommunication('allco', x.decision({ restrictionId: hold.id, expectedVersion: hold.version, reason: 'recorded_in_error', note: 'Fixture release' })); }
    else x.store.mutate('allco', state => { if (kind === 'profile') state.icp.triggers = 'Changed'; if (kind === 'account') state.leads[0].sourceIntakeId = 'new-intake'; if (kind === 'person') state.personReviews[0].status = 'withdrawn'; });
    resolve(); await run.completion; assert.equal(x.store.read('allco').educationResearch[0].status, 'failed'); assert.equal(x.store.read('allco').wallet.credits, credits); assert.equal(x.store.read('allco').educationReviews.length, 0);
  }
});
test('education expiry invalidates graph context while private connection note edits do not', async t => {
  const x = await setup(t); await x.reviewPerson('a'); await x.review(); await x.attest(); const state = x.store.read('allco'), clock = Date.now(), key = graphContextKey(state, competitors.allco, clock); state.knownConnections[0].note = 'New private note'; assert.equal(graphContextKey(state, competitors.allco, clock), key); assert.notEqual(graphContextKey(state, competitors.allco, clock + 31 * 86400000), key);
  const future = new Date(Date.now() - 31 * 86400000).toISOString(); state.educationReviews[0].checkedAt = future; assert.equal(educationReviewCurrent(state.educationReviews[0], state, state.leads[0]), false); assert.notEqual(graphContextKey(state), key);
});
test('education is absent from model drafting context and never changes exact-message approval', async t => {
  let payload; const model = { status: () => ({ configured: true }), requireConfigured: () => {}, draft: async input => { payload = input; return { value: { subject: 'Fixture introduction', body: 'Synthetic message', claims: [] }, metadata: { model: 'fixture', usage: null } }; } };
  const x = await setup(t, { model }); await x.reviewPerson('a'); x.service.selectLead('allco', 'a', true); const draft = x.service.draft('allco', 'a'); x.service.approveDraft('allco', draft, true, 1); const before = x.store.read('allco').drafts[0]; await x.review();
  assert.deepEqual(x.store.read('allco').drafts[0], before); await x.service.draftWithModel('allco', 'a', x.decision({ acknowledgedExternalProcessing: true })); assert.doesNotMatch(JSON.stringify(payload), /Fixture University|educationReviews|PRIVATE_EDUCATION_CONNECTION_NOTE/);
});
test('interrupted education requests refund without replay; SQLite keeps reviewed evidence', async t => {
  const x = await setup(t); await x.reviewPerson('a'); const reviewed = await x.review(); const reservation = x.store.reserve('allco', 'people_research', 2, 'a');
  x.store.mutate('allco', state => { state.educationResearch.unshift({ id: randomUUID(), status: 'running', reservation }); }); recoverInterruptedWork(x.store); recoverInterruptedWork(x.store);
  assert.equal(x.store.read('allco').educationResearch[0].errorCode, 'interrupted_request'); assert.equal(x.store.read('allco').wallet.ledger[0].status, 'refunded');
  const reopened = createStore(x.directory); try { assert.equal(reopened.read('allco').educationReviews[0].id, reviewed.record.id); assert.equal(reopened.read('huasheng').educationReviews.length, 0); } finally { reopened.close(); }
});
test('education HTTP routes require session, CSRF, strict inputs and exact business scope', async t => {
  const x = await setup(t); await x.reviewPerson('a'); const server = createApp({ store: x.store, service: x.service, serveStatic: false }).listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}/api`, route = root + '/businesses/allco/leads/a/education-research', body = { requestId: randomUUID(), revision: x.store.read('allco').revision, personReviewId: x.person('a').id, identityUrl };
  assert.equal((await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status, 401);
  const session = await fetch(root + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), { csrf } = await session.json(); const headers = { 'content-type': 'application/json', cookie: session.headers.get('set-cookie').split(';')[0] };
  assert.equal((await fetch(route, { method: 'POST', headers, body: JSON.stringify(body) })).status, 403); headers['x-csrf-token'] = csrf;
  assert.equal((await fetch(route, { method: 'POST', headers, body: JSON.stringify({ ...body, sourceUrl: 'https://other.test/' }) })).status, 400);
  assert.equal((await fetch(route.replace('/allco/', '/huasheng/'), { method: 'POST', headers, body: JSON.stringify(body) })).status, 404);
  const response = await fetch(route, { method: 'POST', headers, body: JSON.stringify(body) }); assert.equal(response.status, 202); const data = await response.json(); assert.ok(data.activeEducationResearchId); assert.equal(data.educationReviews.length, 0);
});

test('graph context accepts a profile-only workspace while direct navigation or business switching loads server state', () => {
  for (const id of ['allco', 'huasheng']) {
    const state = initialBusinessState(id);
    assert.doesNotThrow(() => graphContextKey(state));
    const context = JSON.parse(graphContextKey(state));
    assert.deepEqual(context.leads, []); assert.deepEqual(context.sent, []); assert.deepEqual(context.education, []);
  }
});
