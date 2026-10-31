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
import { researchCatalog, competitors } from '../server/catalog.js';
import { extractSignals } from '../server/signal-extraction.js';
import { buyingLinkStatus, calendarDay } from '../src/buying-evidence.js';
import { graphContextKey } from '../src/graph-context.js';

const day = 86400000, today = Math.floor(Date.now() / day) * day;
const date = offset => new Date(today + offset * day).toISOString().slice(0, 10);
const publication = date(-2), opens = date(-1), closes = date(2);
const jobsUrl = 'https://elliottequip.com/jobs', buyerUrl = 'https://elliottequip.com/procurement', competitorUrl = 'https://rival.example/about';
const jobQuote = 'Job requisition: Supplier Quality Engineer for hydraulic supplier qualification.';
const evaluationQuote = `RFQ for custom hydraulic cylinders opens ${opens} and closes ${closes}.`;
const renewalQuote = `Supplier contract with Rival Cylinders has a renewal evaluation window from ${opens} to ${closes}.`;
const churnQuote = `Terminated supplier contract with Rival Cylinders has a replacement review window from ${opens} to ${closes}.`;
const identity = 'Rival Cylinders manufactures custom hydraulic cylinders for equipment makers.';
const memoryGraph = { sync: async () => {}, snapshot: async id => ({ businessId: id, nodes: [], edges: [] }), paths: async () => [] };
async function setup(t, native = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gtm-buying-test-'));
  const store = createStore(directory), graph = native ? await createGraph(directory) : { ...memoryGraph };
  const texts = new Map([[jobsUrl, `${publication}. ${jobQuote}`], [buyerUrl, `${publication}. ${evaluationQuote} ${renewalQuote} ${churnQuote}`], [competitorUrl, identity]]);
  const h = { directory, store, graph, texts };
  const service = createService({ store, graph, readWebsiteSource: async url => ({ url, checkedAt: new Date().toISOString(), fetchStatus: 'reachable', contentHash: 'fixture', text: texts.get(url), title: 'Fixture publication' }) }); h.service = service;
  service.approveProfile('allco', true, store.read('allco').revision);
  store.mutate('allco', s => { s.leads = [{ ...structuredClone(researchCatalog.find(item => item.id === 'elliott')), selected: true, stage: 'Matched', fit: { score: 80, tier: 'A' }, contact: { email: null, mailboxStatus: 'unverified' }, events: [] }]; });
  h.lead = () => store.read('allco').leads[0];
  service.configureSignalMonitor('allco', 'elliott', { revision: store.read('allco').revision, urls: [jobsUrl, buyerUrl], enabled: false, frequency: 'daily', acknowledgedSchedule: false });
  h.refresh = async () => { const run = service.startSignalCheck('allco', 'elliott', { requestId: randomUUID(), revision: store.read('allco').revision }); await run.completion; };
  h.accept = async (signal, decision = 'accept') => service.reviewMarketSignal('allco', 'elliott', signal.id, { revision: store.read('allco').revision, decision, eventDate: publication, dateQuote: publication, note: 'Synthetic source reviewed for test.', acknowledged: true });
  await h.refresh();
  for (const signal of h.lead().marketSignals.filter(item => ['job_requisition', 'evaluation', 'renewal', 'churn'].includes(item.kind))) await h.accept(signal);
  h.signal = kind => h.lead().marketSignals.find(item => item.kind === kind);
  h.input = overrides => ({ requestId: randomUUID(), revision: store.read('allco').revision, acknowledged: true, kind: 'evaluation', signalId: h.signal('evaluation').id, jobSignalId: h.signal('job_requisition').id, competitorId: null, startDate: opens, endDate: closes, windowQuote: evaluationQuote, jobTitle: 'Supplier Quality Engineer', jobQuote, ...overrides });
  h.review = input => service.reviewBuyingLink('allco', 'elliott', input || h.input());
  h.competitor = async () => {
    const run = service.startCompetitorResearch('allco', { requestId: randomUUID(), revision: store.read('allco').revision, referenceId: null, name: 'Rival Cylinders', category: 'Direct', sourceUrl: competitorUrl, detailUrl: null, acknowledged: true }); await run.completion;
    await service.reviewCompetitor('allco', run.id, { requestId: randomUUID(), revision: store.read('allco').revision, acknowledged: true, identityQuote: identity, positioningQuote: identity, pricingMode: 'not_established', pricingQuote: '', packagingQuote: '', differentiatorQuote: '', comparisonNote: 'Private competitor hypothesis' });
    return store.read('allco').competitorReviews[0];
  };
  t.after(async () => { await graph.close?.(); store.close(); await rm(directory, { recursive: true, force: true }); }); return h;
}
test('specialized extraction proposes explicit requisitions/evaluations/renewals/churn without converting ordinary hiring into a buyer cycle', () => {
  const page = text => ({ url: buyerUrl, checkedAt: new Date().toISOString(), text });
  assert.equal(extractSignals(page(`${publication}. We are hiring software engineers and evaluating job applicants.`)).filter(item => item.kind === 'evaluation').length, 0);
  assert.ok(extractSignals(page(`${publication}. ${jobQuote}`)).some(item => item.kind === 'job_requisition'));
  for (const [kind, text] of [['evaluation', evaluationQuote], ['renewal', renewalQuote], ['churn', churnQuote]]) assert.ok(extractSignals(page(`${publication}. ${text}`)).some(item => item.kind === kind));
});
test('link decisions require acknowledgement, exact window/job passages, valid dates and the right accepted signal types', async t => {
  const h = await setup(t);
  for (const [patch, code] of [[{ acknowledged: false }, 'buying_review_required'], [{ windowQuote: 'An invented RFQ is open for these dates.' }, 'buying_quote_required'], [{ startDate: date(-30) }, 'buying_window_evidence_required'], [{ endDate: date(-3) }, 'invalid_buying_window'], [{ startDate: '2026-02-30' }, 'invalid_buying_window'], [{ jobTitle: 'Invented Purchasing Director' }, 'buying_job_evidence_required'], [{ jobQuote: 'An invented requisition for Supplier Quality Engineer.' }, 'buying_quote_required'], [{ signalId: h.signal('job_requisition').id }, 'buying_signal_kind']]) await assert.rejects(h.review(h.input(patch)), { code });
  assert.equal(h.store.read('allco').buyingLinks.length, 0);
  const before = h.store.read('allco').wallet.credits; await h.review(); assert.equal(h.store.read('allco').wallet.credits, before);
  assert.equal(buyingLinkStatus(h.store.read('allco').buyingLinks[0], h.store.read('allco'), h.lead()), 'active');
});
test('unreviewed signals, stale source snapshots, account holds and foreign signal IDs never create a buying path', async t => {
  const h = await setup(t); const input = h.input();
  h.store.mutate('allco', s => { s.leads[0].marketSignals.find(item => item.id === input.signalId).status = 'proposed'; });
  await assert.rejects(h.review(h.input()), { code: 'buying_signal_required' }); await h.accept(h.signal('evaluation'));
  h.store.mutate('allco', s => { s.leads[0].signalMonitor.pages.forEach(page => page.checkedAt = new Date(Date.now() - 25 * 3600000).toISOString()); });
  await assert.rejects(h.review(h.input()), { code: 'buying_source_required' }); await h.refresh();
  await assert.rejects(h.review(h.input({ signalId: randomUUID() })), { code: 'buying_signal_required' });
  h.store.mutate('allco', s => { s.leads[0].evidenceNeedsReview = true; }); await assert.rejects(h.review(h.input()), { code: 'buying_account_hold' });
});
test('native traversal links reviewed jobs to active published evaluations, with cited public evidence and no private keys or notes', async t => {
  const h = await setup(t, true); await h.review(); const result = await h.service.graphView('allco');
  assert.equal(result.buyingPaths.evaluations.length, 1); const path = result.buyingPaths.evaluations[0];
  assert.equal(path.jobTitle, 'Supplier Quality Engineer'); assert.equal(path.windowQuote, evaluationQuote); assert.equal(path.source, buyerUrl); assert.equal(path.jobSource, jobsUrl);
  assert.equal(path.leadId, 'elliott'); assert.ok(result.edges.some(edge => edge.type === 'supports_evaluation' && edge.buyingEvidence.id === path.id));
  assert.equal((await h.service.graphView('huasheng')).buyingPaths.evaluations.length, 0);
  assert.equal((await h.graph.buyingPaths('allco', today + 4 * day)).evaluations.length, 0);
  assert.equal(buyingLinkStatus(h.store.read('allco').buyingLinks[0], h.store.read('allco'), h.lead(), today + 4 * day), 'expired');
  assert.doesNotMatch(JSON.stringify(path), /profileKey|accountKey|signalKey|reviewNote/);
});
test('supplier-change paths require fresh reviewed competitor identity named in the quoted window', async t => {
  const h = await setup(t, true);
  await assert.rejects(h.review(h.input({ kind: 'displacement', signalId: h.signal('renewal').id, jobSignalId: null, jobTitle: '', jobQuote: '', competitorId: 'parker', windowQuote: renewalQuote })), { code: 'buying_competitor_evidence_required' });
  const competitor = await h.competitor();
  for (const kind of ['renewal', 'churn']) await h.review(h.input({ kind: 'displacement', signalId: h.signal(kind).id, jobSignalId: null, jobTitle: '', jobQuote: '', competitorId: competitor.referenceId, windowQuote: kind === 'renewal' ? renewalQuote : churnQuote }));
  const result = await h.service.graphView('allco'); assert.equal(result.buyingPaths.displacements.length, 2);
  assert.ok(result.buyingPaths.displacements.every(path => path.competitor === 'Rival Cylinders' && path.competitorSource === competitorUrl));
  assert.doesNotMatch(JSON.stringify(result.buyingPaths), /Private competitor hypothesis/);
  await h.service.withdrawCompetitor('allco', { requestId: randomUUID(), revision: h.store.read('allco').revision, acknowledged: true, reviewId: competitor.id });
  assert.equal((await h.service.graphView('allco')).buyingPaths.displacements.length, 0);
});
test('source withdrawal/reacceptance cannot resurrect an old binding, while unchanged refresh preserves it', async t => {
  const h = await setup(t, true); await h.review(); const link = h.store.read('allco').buyingLinks[0]; await h.refresh();
  assert.equal(buyingLinkStatus(link, h.store.read('allco'), h.lead()), 'active');
  const signal = h.signal('evaluation'), version = signal.acceptedVersion; await h.accept(signal, 'withdraw');
  assert.equal((await h.service.graphView('allco')).buyingPaths.evaluations.length, 0); await h.accept(signal);
  assert.notEqual(h.signal('evaluation').acceptedVersion, version); assert.equal((await h.service.graphView('allco')).buyingPaths.evaluations.length, 0);
  await h.review(); assert.equal((await h.service.graphView('allco')).buyingPaths.evaluations.length, 1); assert.equal(h.store.read('allco').buyingLinks[1].status, 'superseded');
});
test('profile edits permanently require fresh link review, and request retries repair projection without duplicating or reviving a withdrawal', async t => {
  const h = await setup(t); const input = h.input(); let broken = true;
  h.graph.sync = async () => { if (broken) throw Error('projection unavailable'); }; await h.review(input); await h.review(input);
  assert.equal(h.store.read('allco').buyingLinks.length, 1); assert.equal(h.store.read('allco').buyingOperations[0].graphStatus, 'pending');
  await assert.rejects(h.review({ ...input, jobTitle: 'Other title' }), { code: 'buying_request_conflict' });
  broken = false; await h.review(input); assert.equal(h.store.read('allco').buyingOperations[0].graphStatus, 'synced');
  const withdrawal = { requestId: randomUUID(), revision: h.store.read('allco').revision, acknowledged: true, linkId: input.requestId };
  await h.service.withdrawBuyingLink('allco', 'elliott', withdrawal); await h.service.withdrawBuyingLink('allco', 'elliott', withdrawal); await h.review(input);
  assert.equal(h.store.read('allco').buyingLinks[0].status, 'withdrawn'); await h.review();
  h.service.saveProfile('allco', { icp: { ...h.store.read('allco').icp, triggers: 'New targeting context' } }, h.store.read('allco').revision);
  h.service.approveProfile('allco', true, h.store.read('allco').revision); assert.equal(h.store.read('allco').buyingLinks[0].status, 'needs_review');
});
test('upcoming windows are retained for review but excluded from native active paths; graph context changes on boundaries and account changes', async t => {
  const h = await setup(t, true); const nextQuote = `RFQ for custom hydraulic cylinders opens ${date(1)} and closes ${date(3)}.`;
  h.texts.set(buyerUrl, `${publication}. ${nextQuote}`); await h.refresh(); await h.accept(h.signal('evaluation'));
  await h.review(h.input({ startDate: date(1), endDate: date(3), windowQuote: nextQuote })); const state = h.store.read('allco');
  assert.equal(buyingLinkStatus(state.buyingLinks[0], state, h.lead()), 'upcoming'); assert.equal((await h.service.graphView('allco')).buyingPaths.evaluations.length, 0);
  assert.equal(buyingLinkStatus(state.buyingLinks[0], state, h.lead(), today + 2 * day), 'active');
  const before = graphContextKey(state, competitors.allco); h.store.mutate('allco', s => { s.leads[0].application += ' changed'; });
  assert.notEqual(graphContextKey(h.store.read('allco'), competitors.allco), before); assert.equal(buyingLinkStatus(state.buyingLinks[0], h.store.read('allco'), h.lead()), 'needs_review');
});
test('buying decisions persist across SQLite reopen and HTTP routes retain CSRF/schema/business isolation', async t => {
  const h = await setup(t); await h.review(); const reopened = createStore(h.directory); assert.equal(reopened.read('allco').buyingLinks.length, 1); reopened.close();
  const server = createApp({ service: h.service, store: h.store, serveStatic: false }).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;
  assert.equal((await fetch(base + '/businesses/allco/leads/elliott/buying-links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  const session = await fetch(base + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); const csrf = (await session.json()).csrf;
  const headers = { 'content-type': 'application/json', cookie: session.headers.get('set-cookie').split(';')[0], 'x-csrf-token': csrf };
  const post = (url, body, extra = {}) => fetch(base + url, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  assert.equal((await post('/businesses/allco/leads/elliott/buying-links', h.input(), { 'x-csrf-token': 'bad' })).status, 403);
  assert.equal((await post('/businesses/allco/leads/elliott/buying-links', { ...h.input(), intentConfirmed: true })).status, 400);
  assert.equal((await post('/businesses/huasheng/leads/elliott/buying-links', h.input({ revision: h.store.read('huasheng').revision }))).status, 404);
});
test('calendar boundaries reject rolled dates and source expiry removes a link without changing outreach history', async t => {
  assert.ok(Number.isNaN(calendarDay('2026-02-30'))); const h = await setup(t); await h.review();
  const state = h.store.read('allco'); assert.equal(buyingLinkStatus(state.buyingLinks[0], state, h.lead(), Date.now() + 8 * day), 'needs_review');
  assert.equal(state.drafts.length, 0); assert.equal(state.leads[0].stage, 'Matched'); assert.equal(state.leads[0].selected, true);
});
test('a buying association cannot approve a draft or authorize outreach', async t => {
  const h = await setup(t); const id = h.service.draft('allco', 'elliott'); await h.review();
  const draft = h.store.read('allco').drafts.find(item => item.id === id);
  assert.equal(draft.status, 'draft'); assert.equal(draft.approvedHash, null);
  await assert.rejects(h.service.simulateSend('allco', id), { code: 'approval_required' });
});
test('job-source loss and accepted negative evidence suspend native paths without deleting link history', async t => {
  const h = await setup(t, true); await h.review(); h.texts.delete(jobsUrl); await h.refresh();
  assert.equal(h.signal('job_requisition').status, 'needs_review'); assert.equal((await h.service.graphView('allco')).buyingPaths.evaluations.length, 0);
  h.texts.set(jobsUrl, `${publication}. ${jobQuote}`); await h.refresh(); await h.accept(h.signal('job_requisition'));
  assert.equal((await h.service.graphView('allco')).buyingPaths.evaluations.length, 0); await h.review();
  h.texts.set(buyerUrl, `${publication}. ${evaluationQuote} The company announced a hiring freeze and plant closure.`); await h.refresh(); await h.accept(h.signal('negative'));
  assert.equal((await h.service.graphView('allco')).buyingPaths.evaluations.length, 0); await assert.rejects(h.review(), { code: 'buying_account_hold' });
  assert.equal(h.store.read('allco').buyingLinks.length, 2);
});
