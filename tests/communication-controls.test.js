import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore, digest } from '../server/store.js';
import { createService } from '../server/service.js';
import { createApp } from '../server/app.js';
import { researchCatalog } from '../server/catalog.js';
import { communicationTarget, recipientTarget } from '../src/communication-targets.js';
import { communicationStatus, communicationContext } from '../server/communication-policy.js';

const email = 'sam@buyer.test', profile = 'https://www.linkedin.com/in/fixture-person';
const graph = { sync: async () => {}, snapshot: async () => ({}), paths: async () => [] };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function setup(t, dependencies = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gtm-communication-'));
  const store = createStore(directory), service = createService({ store, graph, ...dependencies });
  for (const id of ['allco', 'huasheng']) {
    if (id === 'allco') service.approveProfile(id, true, store.read(id).revision);
    store.mutate(id, state => { state.leads = [{ ...structuredClone(researchCatalog[0]), id: 'fixture', businessId: id, name: 'Synthetic Buyer', domain: 'buyer.test', selected: true, fit: { score: 80, tier: 'A' }, contact: { email, linkedIn: profile }, events: [], stage: 'Matched' }]; });
  }
  const input = (patch = {}, id = 'allco') => ({ requestId: randomUUID(), revision: store.read(id).revision, acknowledged: true, kind: 'account', target: 'buyer.test', reason: 'opt_out', reportedAt: new Date().toISOString(), note: 'Private fixture request', ...patch });
  const hold = patch => service.holdCommunication('allco', input(patch));
  const release = (record = store.read('allco').communicationRestrictions[0], patch = {}) => service.releaseCommunication('allco', { requestId: randomUUID(), revision: store.read('allco').revision, acknowledged: true, restrictionId: record.id, expectedVersion: record.version, reason: 'permission_updated', note: 'Synthetic recorded permission update', ...patch });
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, store, service, input, hold, release };
}
test('canonical targets reject lookalike URLs, malformed multi-recipients and encoded profile path escapes', () => {
  assert.equal(communicationTarget('account', 'https://WWW.Buyer.Test./about'), 'buyer.test');
  assert.equal(communicationTarget('email', 'SAM@Buyer.Test'), email);
  assert.equal(recipientTarget('email', 'Sam Fixture <SAM@Buyer.Test>'), email);
  assert.equal(communicationTarget('linkedin', 'https://linkedin.com/in/%66ixture-PERSON/?trk=demo#about'), profile);
  for (const value of ['https://linkedin.com.evil.test/in/person', 'http://linkedin.com/in/person', 'https://linkedin.com/in/person%2Fother', 'https://user@linkedin.com/in/person', 'https://linkedin.com/company/person', 'https://linkedin.com/in/person%0A']) assert.throws(() => communicationTarget('linkedin', value));
  for (const value of ['first@buyer.test, second@buyer.test', 'bad@buyer.test, Sam <sam@buyer.test>', 'sam@buyer.test\r\nBcc: x@other.test', 'sam..x@buyer.test', '.sam@buyer.test']) assert.throws(() => recipientTarget('email', value));
  for (const value of ['https://name:secret@buyer.test', 'ftp://buyer.test', '127.0.0.1', 'buyer.test:8443']) assert.throws(() => communicationTarget('account', value));
});
test('account holds clear unsent recipients/approvals, preserve dispatched history and block work without charges', async t => {
  let calls = 0;
  const h = await setup(t, { mx: async () => { calls++; return {}; } });
  const sent = h.service.draft('allco', 'fixture'); h.service.approveDraft('allco', sent, true, 1); await h.service.simulateSend('allco', sent);
  const unsent = h.service.draft('allco', 'fixture', 'linkedin'); h.service.approveDraft('allco', unsent, true, 1);
  const credits = h.store.read('allco').wallet.credits; h.hold();
  const state = h.store.read('allco'), draft = state.drafts.find(item => item.id === unsent);
  assert.equal(draft.version, 2); assert.equal(draft.recipient, ''); assert.equal(draft.approvedHash, null); assert.equal(state.leads[0].selected, false);
  assert.equal(state.drafts.find(item => item.id === sent).status, 'simulated');
  assert.throws(() => h.service.selectLead('allco', 'fixture', true), { code: 'communication_restricted' });
  assert.throws(() => h.service.approveDraft('allco', unsent, true, 2), { code: 'communication_restricted' });
  await assert.rejects(h.service.enrich('allco', 'fixture'), { code: 'communication_restricted' });
  assert.throws(() => h.service.startPeopleResearch('allco', 'fixture', { requestId: randomUUID(), revision: state.revision, sourceUrl: 'https://buyer.test/team', employerUrl: null }), { code: 'communication_restricted' });
  assert.equal(calls, 0); assert.equal(h.store.read('allco').wallet.credits, credits);
});
test('channel holds span accounts in one business, keep the other channel open and resist recipient edits', async t => {
  const h = await setup(t);
  const a = h.service.draft('allco', 'fixture'), linked = h.service.draft('allco', 'fixture', 'linkedin');
  h.service.approveDraft('allco', a, true, 1); h.service.approveDraft('allco', linked, true, 1);
  h.hold({ kind: 'email', target: email.toUpperCase() });
  const state = h.store.read('allco');
  assert.equal(state.leads[0].selected, true); assert.equal(state.drafts.find(item => item.id === linked).status, 'approved');
  h.service.editDraft('allco', a, { recipient: 'Sam <SAM@BUYER.TEST>' });
  assert.throws(() => h.service.approveDraft('allco', a, true, 3), { code: 'communication_restricted' });
  assert.equal(communicationStatus(state, { domain: 'other.test' }, 'email', email).blocked, true);
  assert.equal(communicationStatus(h.store.read('huasheng'), h.store.read('huasheng').leads[0], 'email', email).blocked, false);
  assert.throws(() => h.service.draft('allco', 'fixture', 'email', 'B'), { code: 'communication_restricted' });
  h.hold({ kind: 'linkedin', target: 'https://linkedin.com/in/%66ixture-Person/?trk=demo' });
  assert.equal(h.store.read('allco').drafts.find(item => item.id === linked).approvedHash, null);
  assert.equal(h.service.snapshot('allco').leads[0].communicationStatus.linkedin.blocked, true);
  await assert.rejects(h.service.simulateSend('allco', linked), { code: 'approval_required' });
  const record = h.store.read('allco').communicationRestrictions.find(item => item.kind === 'email');
  assert.ok(!JSON.stringify(record).includes(email)); assert.ok(record.display.includes('•••')); // Matching hash is not encryption or erasure.
});
test('preemptive domain holds include subdomains and recipient domains but exclude suffix lookalikes', async t => {
  const h = await setup(t); h.hold(); const state = h.store.read('allco');
  for (const domain of ['buyer.test', 'shop.buyer.test']) assert.equal(communicationStatus(state, { domain }, 'linkedin', '').blocked, true);
  for (const domain of ['notbuyer.test', 'buyer.test.evil.test']) assert.equal(communicationStatus(state, { domain }, 'email', '').blocked, false);
  assert.equal(communicationStatus(state, { domain: 'other.test' }, 'email', 'x@eu.buyer.test').blocked, true);
  assert.equal(communicationStatus(state, { domain: 'other.test' }, 'linkedin', profile).blocked, false);
});
test('idempotent decisions, stale release and old replay cannot override a newer hold or restore approvals', async t => {
  const h = await setup(t); const request = h.input(); h.service.holdCommunication('allco', request);
  const old = h.store.read('allco').communicationRestrictions[0], context = communicationContext(h.store.read('allco'));
  h.service.holdCommunication('allco', request); assert.equal(h.store.read('allco').communicationOperations.length, 1);
  assert.throws(() => h.service.holdCommunication('allco', { ...request, reason: 'complaint' }), { code: 'communication_request_conflict' });
  h.hold({ reason: 'complaint' }); assert.throws(() => h.release(old), { code: 'stale_communication_decision' });
  const releaseInput = { requestId: randomUUID(), revision: h.store.read('allco').revision, restrictionId: old.id, expectedVersion: 2, acknowledged: true, reason: 'recorded_in_error', note: 'Synthetic correction' };
  h.service.releaseCommunication('allco', releaseInput); h.service.holdCommunication('allco', request);
  assert.equal(h.store.read('allco').communicationRestrictions[0].status, 'released');
  assert.notEqual(communicationContext(h.store.read('allco')), context); assert.equal(h.store.read('allco').leads[0].selected, false);
  h.hold(); h.service.releaseCommunication('allco', releaseInput);
  assert.equal(h.store.read('allco').communicationRestrictions[0].status, 'active');
});
test('release cannot lift a provider address restriction, and invalid decisions leave state untouched', async t => {
  const h = await setup(t); const revision = h.store.read('allco').revision;
  for (const patch of [{ acknowledged: false }, { reportedAt: '2099-01-01T00:00:00Z' }, { note: 'x'.repeat(501) }, { reason: 'invented' }]) assert.throws(() => h.hold(patch));
  assert.equal(h.store.read('allco').revision, revision);
  h.store.mutate('allco', state => { state.contactSuppressions.push({ addressHash: digest({ businessId: 'allco', email }), reason: 'Provider fixture restriction' }); });
  h.hold({ kind: 'email', target: email }); h.release();
  assert.throws(() => h.service.draft('allco', 'fixture'), { code: 'contact_suppressed' });
  const id = h.service.draft('allco', 'fixture', 'linkedin'); h.service.editDraft('allco', id, { recipient: 'https://linkedin.com/company/fixture' });
  assert.throws(() => h.service.approveDraft('allco', id, true, 2), { code: 'invalid_recipient' });
});
test('opt-out recorded and released during MX work still discards its result and refunds once', async t => {
  const gate = deferred(), h = await setup(t, { mx: async () => { await gate.promise; return { status: 'found', records: [] }; } });
  const pending = h.service.enrich('allco', 'fixture'); h.hold({ kind: 'email', target: email }); h.release(); gate.resolve();
  await assert.rejects(pending, { code: 'stale_communication_context' });
  assert.equal(h.store.read('allco').wallet.credits, 100); assert.equal(h.store.read('allco').wallet.ledger[0].status, 'refunded'); assert.equal(h.store.read('allco').leads[0].contact.mxStatus, undefined);
});
test('in-flight model context is invalidated by a hold/release without sending preference notes to the model', async t => {
  const gate = deferred(); let context;
  const model = { status: () => ({ configured: true }), requireConfigured: () => {}, draft: async input => { context = input; await gate.promise; return { value: { subject: 'Fixture', body: 'Synthetic body', claims: [] }, metadata: { model: 'fixture-only', usage: { inputTokens: 1 } } }; } };
  const h = await setup(t, { model });
  const pending = h.service.draftWithModel('allco', 'fixture', { requestId: randomUUID(), revision: h.store.read('allco').revision, acknowledgedExternalProcessing: true });
  h.hold({ kind: 'email', target: email }); h.release(); gate.resolve();
  await assert.rejects(pending, { code: 'stale_communication_context' }); assert.equal(h.store.read('allco').wallet.credits, 100); assert.equal(h.store.read('allco').drafts.length, 0);
  assert.ok(!JSON.stringify(context).includes('Private fixture request')); assert.ok(!JSON.stringify(context).includes('communicationRestrictions'));
});
test('vendor requests and pending polls cannot cross a changed preference context or charge twice', async t => {
  const gate = deferred(); let calls = 0;
  const provider = { status: () => ({ configured: true }), requireConfigured: () => {}, search: async () => { calls++; await gate.promise; return { candidates: [] }; } };
  const h = await setup(t, { hunter: provider });
  const pending = h.service.searchContacts('allco', 'fixture', { requestId: randomUUID(), revision: h.store.read('allco').revision, acknowledgedExternalProcessing: true });
  h.hold(); h.release(); gate.resolve(); const result = await pending;
  assert.equal(result.enrichmentRuns[0].errorCode, 'stale_communication_context'); assert.equal(result.wallet.credits, 100); assert.equal(calls, 1);
  // A pending verifier is a previously billed external request, not permission to poll after a hold.
  const reservation = h.store.reserve('allco', 'vendor_verify', 5, 'fixture'), runId = randomUUID();
  h.store.mutate('allco', state => { state.enrichmentRuns.unshift({ id: runId, leadId: 'fixture', status: 'pending', kind: 'verify', email, reservation, communicationContext: communicationContext(state) }); });
  h.hold({ kind: 'email', target: email });
  const stopped = await h.service.pollContact('allco', 'fixture', runId, { acknowledgedExternalProcessing: true, revision: h.store.read('allco').revision });
  assert.equal(stopped.enrichmentRuns[0].status, 'failed'); assert.equal(stopped.wallet.credits, 100); assert.equal(calls, 1);
  await h.service.pollContact('allco', 'fixture', runId, { acknowledgedExternalProcessing: true, revision: stopped.revision }); assert.equal(h.store.read('allco').wallet.credits, 100);
});
test('people source retrieval cannot attach results after an account hold and release', async t => {
  const gate = deferred(); const h = await setup(t, { readWebsiteSource: async url => { await gate.promise; return { url, text: 'Synthetic person published role source for fixture.', fetchStatus: 'reachable', checkedAt: new Date().toISOString() }; } });
  const run = h.service.startPeopleResearch('allco', 'fixture', { requestId: randomUUID(), revision: h.store.read('allco').revision, sourceUrl: 'https://buyer.test/team', employerUrl: null });
  h.hold(); h.release(); gate.resolve(); await run.completion;
  assert.equal(h.store.read('allco').peopleResearch[0].errorCode, 'stale_communication_context'); assert.equal(h.store.read('allco').wallet.credits, 100);
});
test('fresh vendor results keep held addresses unusable and do not reattach a held LinkedIn profile', async t => {
  const candidate = { id: 'candidate-fixture', email, name: 'Sam Fixture', role: 'Engineer', linkedIn: profile, sources: [{ url: 'https://buyer.test/team' }] };
  let calls = 0;
  const hunter = { status: () => ({ configured: true }), requireConfigured: () => {}, search: async () => { calls++; return { candidates: [structuredClone(candidate)] }; }, verify: async () => ({ email, status: 'valid', regexp: true, mxFound: true, smtpCheck: true, acceptAll: false, blocked: false, disposable: false, webmail: false, verificationDate: new Date().toISOString().slice(0, 10), checkedAt: new Date().toISOString() }) };
  const h = await setup(t, { hunter }); const request = extra => ({ requestId: randomUUID(), revision: h.store.read('allco').revision, acknowledgedExternalProcessing: true, ...extra });
  h.hold({ kind: 'email', target: email });
  const blocked = await h.service.searchContacts('allco', 'fixture', request()); const blockedRun = blocked.enrichmentRuns[0];
  assert.equal(blockedRun.result.candidates[0].restricted, true);
  await assert.rejects(h.service.verifyContact('allco', 'fixture', request({ searchRunId: blockedRun.id, candidateId: candidate.id })), { code: 'contact_suppressed' });
  assert.equal(calls, 1); h.release(); h.hold({ kind: 'linkedin', target: profile });
  const fresh = await h.service.searchContacts('allco', 'fixture', request()); const searchRun = fresh.enrichmentRuns[0];
  const verified = await h.service.verifyContact('allco', 'fixture', request({ searchRunId: searchRun.id, candidateId: candidate.id })); const verification = verified.enrichmentRuns[0];
  const selected = await h.service.applyContact('allco', 'fixture', { requestId: randomUUID(), revision: h.store.read('allco').revision, acknowledged: true, acknowledgedUncertain: false, searchRunId: searchRun.id, candidateId: candidate.id, verificationRunId: verification.id });
  assert.equal(selected.leads[0].contact.email, email); assert.equal(selected.leads[0].contact.linkedIn, null);
});
test('HTTP controls enforce session, CSRF, schemas and survive reset and SQLite reopen without crossing businesses', async t => {
  const h = await setup(t); const server = createApp({ store: h.store, service: h.service, serveStatic: false }).listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve))); const root = `http://127.0.0.1:${server.address().port}/api`, route = root + '/businesses/allco/communication/holds';
  const body = h.input(); assert.equal((await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status, 401);
  const session = await fetch(root + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); const { csrf } = await session.json();
  const headers = { 'content-type': 'application/json', cookie: session.headers.get('set-cookie').split(';')[0] };
  assert.equal((await fetch(route, { method: 'POST', headers, body: JSON.stringify(body) })).status, 403); headers['x-csrf-token'] = csrf;
  assert.equal((await fetch(route, { method: 'POST', headers, body: JSON.stringify({ ...body, invented: true }) })).status, 400);
  assert.equal((await fetch(route, { method: 'POST', headers, body: JSON.stringify(body) })).status, 200);
  const before = h.store.read('allco').communicationRestrictions[0];
  const reset = await fetch(root + '/businesses/allco/reset', { method: 'POST', headers, body: '{}' }); assert.equal(reset.status, 200);
  const state = await reset.json(); assert.equal(state.leads.length, 0); assert.deepEqual(state.communicationRestrictions[0], before); assert.equal(state.communicationOperations.length, 1); assert.equal(h.store.read('huasheng').communicationRestrictions.length, 0);
  const reopened = createStore(h.directory); try { assert.deepEqual(reopened.read('allco').communicationRestrictions[0], before); assert.equal(reopened.read('allco').communicationOperations.length, 1); } finally { reopened.close(); }
});
