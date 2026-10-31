import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore, recoverInterruptedWork, AppError } from '../server/store.js';
import { createService } from '../server/service.js';
import { createGraph } from '../server/graph.js';
import { createApp } from '../server/app.js';
import { competitors, researchCatalog } from '../server/catalog.js';
import { competitiveReferences, competitorReviewCurrent, competitorContext, proposeCompetitivePassages } from '../src/competitor-evidence.js';
import { graphContextKey } from '../src/graph-context.js';

const identityUrl = 'https://rival.example/about', detailUrl = 'https://rival.example/products';
const identity = 'Rival Cylinders manufactures custom hydraulic cylinders for industrial equipment.';
const positioning = 'Rival Cylinders supplies custom hydraulic cylinders for mobile equipment.';
const pricing = 'Request a quote for a custom configuration.';
const packaging = 'The RX series uses modular mounting kits.';
const differentiator = 'Certified quality controls and pressure testing are available.';
const text = [positioning, pricing, packaging, differentiator, 'The RX kit costs USD 250 per kit.'].join(' ');
const memoryGraph = { sync: async () => {}, snapshot: async id => ({ businessId: id, nodes: [], edges: [] }), paths: async () => [] };
async function setup(t, native = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gtm-competitor-test-'));
  const h = { directory, store: createStore(directory), graph: native ? await createGraph(directory) : { ...memoryGraph }, calls: [], reader: null };
  h.reader = async url => ({ url, finalUrl: url, checkedAt: new Date().toISOString(), fetchStatus: 'reachable', title: 'Rival source', text: url === identityUrl ? identity : text });
  h.makeService = () => createService({ store: h.store, graph: h.graph, readWebsiteSource: async url => { h.calls.push(url); return h.reader(url); } });
  h.service = h.makeService(); h.service.approveProfile('allco', true, h.store.read('allco').revision);
  h.input = overrides => ({ requestId: randomUUID(), revision: h.store.read('allco').revision, referenceId: null, name: 'Rival Cylinders', category: 'Indirect', sourceUrl: identityUrl, detailUrl, acknowledged: true, ...overrides });
  h.start = async (input = h.input()) => { const run = h.service.startCompetitorResearch('allco', input); await run.completion; return h.store.read('allco').competitorResearch.find(item => item.id === run.id); };
  h.decision = overrides => ({ requestId: randomUUID(), revision: h.store.read('allco').revision, acknowledged: true, identityQuote: identity, positioningQuote: positioning, pricingMode: 'quote_required', pricingQuote: pricing, packagingQuote: packaging, differentiatorQuote: differentiator, comparisonNote: 'Owner interpretation: compare drawings and qualification effort.', ...overrides });
  h.review = (run, input = h.decision()) => h.service.reviewCompetitor('allco', run.id, input);
  t.after(async () => { await h.graph.close?.(); h.store.close(); await rm(directory, { recursive: true, force: true }); });
  return h;
}
test('competitor retrieval requires current scope, consent, a valid request and credits before any network read', async t => {
  const h = await setup(t);
  for (const [patch, code] of [[{ acknowledged: false }, 'competitor_ack_required'], [{ requestId: 'bad' }, 'invalid_competitor_request'], [{ revision: 0 }, 'revision_conflict'], [{ sourceUrl: 'http://rival.example/' }, 'source_not_allowed'], [{ detailUrl: 'https://unrelated.example/' }, 'source_site_mismatch'], [{ referenceId: 'metso' }, 'competitor_not_found']]) assert.throws(() => h.service.startCompetitorResearch('allco', h.input(patch)), { code });
  h.store.mutate('allco', s => { s.approved = false; });
  assert.throws(() => h.service.startCompetitorResearch('allco', h.input()), { code: 'profile_approval_required' });
  h.store.mutate('allco', s => { s.approved = true; s.wallet.credits = 1; });
  assert.throws(() => h.service.startCompetitorResearch('allco', h.input()), { code: 'insufficient_credits' });
  assert.equal(h.calls.length, 0); assert.equal(h.store.read('allco').competitorResearch.length, 0);
});
test('retrieval extracts literal proposals without applying facts; request retries and separate businesses do not duplicate work', async t => {
  const h = await setup(t); const input = h.input(), run = await h.start(input);
  assert.equal(run.status, 'ready'); assert.equal(run.pages.length, 2); assert.equal(h.store.read('allco').wallet.credits, 98);
  assert.equal(h.store.read('allco').competitorReviews.length, 0); assert.equal(h.store.read('huasheng').competitorResearch.length, 0);
  assert.ok(identity.includes(run.suggestions.identityQuote));
  for (const key of ['positioningQuote', 'pricingQuote', 'packagingQuote', 'differentiatorQuote']) assert.ok(text.includes(run.suggestions[key]));
  assert.equal(h.service.startCompetitorResearch('allco', input).id, run.id); assert.equal(h.calls.length, 2);
  assert.throws(() => h.service.startCompetitorResearch('allco', { ...input, name: 'Different' }), { code: 'competitor_request_conflict' });
  assert.equal(h.store.read('allco').wallet.ledger.length, 1);
});
test('existing references keep source domains pinned and pending work serializes retrieval', async t => {
  const h = await setup(t);
  assert.throws(() => h.service.startCompetitorResearch('allco', h.input({ referenceId: 'parker' })), { code: 'source_site_mismatch' });
  let release; h.reader = url => new Promise(resolve => { release = () => resolve({ url, checkedAt: new Date().toISOString(), fetchStatus: 'reachable', text: identity }); });
  const first = h.service.startCompetitorResearch('allco', h.input({ detailUrl: null }));
  assert.throws(() => h.service.startCompetitorResearch('allco', h.input()), { code: 'job_running' }); release(); await first.completion;
});
test('review rejects invented passages, unknown pricing states, unquoted prices and unacknowledged decisions', async t => {
  const h = await setup(t), run = await h.start();
  for (const [patch, code] of [[{ acknowledged: false }, 'competitor_ack_required'], [{ identityQuote: 'An unrelated company manufactures cylinders.' }, 'ungrounded_competitor_quote'], [{ positioningQuote: 'Rival products are cheaper than all suppliers.' }, 'ungrounded_competitor_quote'], [{ pricingMode: 'free' }, 'invalid_competitor_pricing'], [{ pricingMode: 'published', pricingQuote: pricing }, 'invalid_competitor_pricing'], [{ pricingMode: 'quote_required', pricingQuote: packaging }, 'invalid_competitor_pricing'], [{ pricingMode: 'not_established' }, 'invalid_competitor_pricing']]) await assert.rejects(h.review(run, h.decision(patch)), { code });
  assert.equal(h.store.read('allco').competitorReviews.length, 0); assert.equal(h.store.read('allco').wallet.credits, 98);
  await h.review(run, h.decision({ pricingMode: 'published', pricingQuote: 'The RX kit costs USD 250 per kit.' }));
  assert.equal(h.store.read('allco').competitorReviews[0].pricingMode, 'published');
});
test('not-established pricing remains unknown; missing optional fields and unrelated sender history stay unchanged', async t => {
  const h = await setup(t), run = await h.start();
  h.store.mutate('allco', s => { s.drafts = [{ id: 'history', status: 'simulated', body: 'Historic message', version: 1 }]; });
  await h.review(run, h.decision({ pricingMode: 'not_established', pricingQuote: '', packagingQuote: '', differentiatorQuote: '' }));
  const state = h.store.read('allco'), saved = state.competitorReviews[0];
  assert.equal(saved.evidence.pricing, null); assert.equal(saved.evidence.packaging, null); assert.equal(saved.evidence.differentiator, null);
  assert.equal(state.competitorResearch[0].status, 'reviewed'); assert.equal(state.drafts[0].body, 'Historic message'); assert.equal(state.drafts[0].status, 'simulated');
  assert.equal(competitiveReferences({ ...state, competitors: competitors.allco }).find(item => item.id === saved.referenceId).current, true);
});
test('business context races discard retrieved pages and refund; source snapshots require recent complete responses', async t => {
  const h = await setup(t); let first = true;
  h.reader = async url => { if (first) { first = false; h.store.mutate('allco', s => { s.company.description += ' changed'; }); } return { url, checkedAt: new Date().toISOString(), fetchStatus: 'reachable', text: identity }; };
  const raced = await h.start(); assert.equal(raced.status, 'failed'); assert.equal(raced.errorCode, 'stale_competitor_context'); assert.equal(h.store.read('allco').wallet.credits, 100);
  for (const patch of [{ checkedAt: 'bad' }, { checkedAt: new Date(Date.now() - 25 * 3600000).toISOString() }, { finalUrl: 'https://other.example/' }, { text: 'short' }, { text: 'a'.repeat(48001) }, { fetchStatus: 'unreachable' }]) {
    h.reader = async url => ({ url, checkedAt: new Date().toISOString(), fetchStatus: 'reachable', text: identity, ...patch });
    assert.equal((await h.start()).status, 'failed'); assert.equal(h.store.read('allco').wallet.credits, 100);
  }
});
test('expired snapshots and changed profiles cannot approve competitor facts', async t => {
  const h = await setup(t), run = await h.start();
  h.store.mutate('allco', s => { s.competitorResearch[0].pages[0].checkedAt = new Date(Date.now() - 25 * 3600000).toISOString(); });
  await assert.rejects(h.review(run), { code: 'competitor_source_expired' });
  h.store.mutate('allco', s => { s.competitorResearch[0].pages[0].checkedAt = new Date().toISOString(); s.company.description += 'new context'; });
  await assert.rejects(h.review(run), { code: 'stale_competitor_context' }); assert.equal(h.store.read('allco').competitorReviews.length, 0);
});
test('review and withdrawal retries survive projection failure without duplicating decisions or resurrecting evidence', async t => {
  const h = await setup(t), run = await h.start(), decision = h.decision();
  h.graph.sync = async () => { throw Error('projection unavailable'); };
  await h.review(run, decision); await h.review(run, decision);
  assert.equal(h.store.read('allco').competitorReviews.length, 1); assert.equal(h.store.read('allco').competitorOperations[0].graphStatus, 'pending');
  await assert.rejects(h.review(run, { ...decision, pricingMode: 'not_established', pricingQuote: '' }), { code: 'competitor_request_conflict' });
  h.graph.sync = async () => {}; await h.review(run, decision); assert.equal(h.store.read('allco').competitorOperations[0].graphStatus, 'synced');
  const withdrawal = { requestId: randomUUID(), reviewId: decision.requestId, revision: h.store.read('allco').revision, acknowledged: true };
  await h.service.withdrawCompetitor('allco', withdrawal); await h.service.withdrawCompetitor('allco', withdrawal); await h.review(run, decision);
  assert.equal(h.store.read('allco').competitorReviews[0].status, 'withdrawn'); assert.equal(h.store.read('allco').competitorOperations.length, 2);
});
test('source loss or missing exact support suspends current competitive evidence and refunds failed retrieval', async t => {
  const h = await setup(t), run = await h.start(); await h.review(run); const saved = h.store.read('allco').competitorReviews[0];
  h.reader = async () => { throw Error('sensitive transport diagnostic must not leak'); };
  const failed = await h.start(h.input({ referenceId: saved.referenceId }));
  assert.equal(failed.status, 'failed'); assert.doesNotMatch(failed.error, /sensitive/); assert.equal(h.store.read('allco').wallet.credits, 98); assert.equal(h.store.read('allco').competitorReviews[0].status, 'needs_review');
  h.reader = async url => ({ url, checkedAt: new Date().toISOString(), fetchStatus: 'reachable', text: url === identityUrl ? identity : text });
  const fresh = await h.start(h.input({ referenceId: saved.referenceId })); await h.review(fresh);
  assert.equal(h.store.read('allco').competitorReviews[0].status, 'reviewed'); assert.equal(h.store.read('allco').competitorReviews[1].status, 'superseded');
  h.reader = async url => ({ url, checkedAt: new Date().toISOString(), fetchStatus: 'reachable', text: url === identityUrl ? identity : 'Rival Cylinders now provides a different, undocumented product configuration.' });
  await h.start(h.input({ referenceId: saved.referenceId })); assert.equal(h.store.read('allco').competitorReviews[0].status, 'needs_review');
});
test('native competitor graph contains source facts but excludes comparison notes and scopes reviewed competitive edges to a business', async t => {
  const h = await setup(t, true), run = await h.start(); await h.review(run); const state = h.store.read('allco'), review = state.competitorReviews[0];
  const graph = await h.service.graphView('allco'); const node = graph.nodes.find(item => item.id === `allco:competitor:${review.referenceId}`);
  h.store.mutate('allco', s => { s.competitorReviews[0].comparisonNote = 'Revised private interpretation'; });
  assert.equal(graphContextKey(h.store.read('allco'), competitors.allco), graph.contextKey);
  assert.equal(node.data.competitiveReview.category, 'Indirect'); assert.equal(node.data.competitiveReview.evidence.pricing.quote, pricing);
  assert.doesNotMatch(JSON.stringify(graph), /Owner interpretation: compare drawings/); assert.ok(graph.edges.some(edge => edge.target === node.id && edge.type === 'competes_with'));
  const other = await h.service.graphView('huasheng'); assert.ok(other.nodes.every(item => item.name !== 'Rival Cylinders'));
  h.store.mutate('allco', s => { s.competitorReviews[0].pages[0].checkedAt = new Date(Date.now() - 31 * 86400000).toISOString(); });
  assert.notEqual(graphContextKey(h.store.read('allco'), competitors.allco), graph.contextKey);
  const expired = await h.service.graphView('allco'); const stale = expired.nodes.find(item => item.id === node.id);
  assert.equal(stale.data.competitiveReview, null); assert.ok(!expired.edges.some(edge => edge.target === node.id));
});
test('review decisions persist and restart refunds interrupted research without another source request', async t => {
  const h = await setup(t), run = await h.start(); await h.review(run);
  const reservation = h.store.reserve('allco', 'competitor_research', 2);
  h.store.mutate('allco', s => { s.competitorResearch.unshift({ id: randomUUID(), status: 'running', reservation }); s.jobs.unshift({ id: 'interrupted', kind: 'competitor_research', status: 'running', reservation }); });
  h.store.close(); h.store = createStore(h.directory); recoverInterruptedWork(h.store); recoverInterruptedWork(h.store);
  assert.equal(h.store.read('allco').competitorResearch[0].status, 'failed'); assert.equal(h.store.read('allco').wallet.credits, 98); assert.equal(h.store.read('allco').competitorReviews.length, 1); assert.equal(h.calls.length, 2);
});
test('HTTP competitor routes enforce session, CSRF, schemas, external metering preflight and business ownership', async t => {
  const h = await setup(t); let gate = true, preflight = 0; const original = h.service.prepareBilling;
  h.service.prepareBilling = async (id, options) => { if (options.path === '/competitor-research') { preflight++; if (gate) throw new AppError(402, 'Project wallet empty.', 'flexprice_insufficient_credits'); } return original(id, options); };
  const server = createApp({ service: h.service, store: h.store, serveStatic: false }).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;
  assert.equal((await fetch(base + '/businesses/allco/competitor-research', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(h.input()) })).status, 401);
  const session = await fetch(base + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), data = await session.json();
  const headers = { 'content-type': 'application/json', cookie: session.headers.get('set-cookie').split(';')[0], 'x-csrf-token': data.csrf };
  const post = (url, body, head = headers) => fetch(base + url, { method: 'POST', headers: head, body: JSON.stringify(body) });
  assert.equal((await post('/businesses/allco/competitor-research', h.input(), { ...headers, 'x-csrf-token': 'bad' })).status, 403);
  const blocked = await post('/businesses/allco/competitor-research', h.input()); assert.equal(blocked.status, 402); assert.equal(h.calls.length, 0); assert.equal(preflight, 1); gate = false;
  assert.equal((await post('/businesses/allco/competitor-research', { ...h.input(), forged: true })).status, 400);
  const run = await h.start(); const foreign = await post(`/businesses/huasheng/competitor-research/${run.id}/review`, h.decision({ revision: h.store.read('huasheng').revision })); assert.equal(foreign.status, 404);
  const response = await post('/businesses/allco/competitor-research', h.input()); assert.equal(response.status, 202); assert.ok((await response.json()).activeCompetitorResearchId);
});
test('literal extraction and freshness never infer public pricing from an absent quote or weak source context', () => {
  const proposed = proposeCompetitivePassages('Unknown company', identity, packaging); assert.equal(proposed.identityQuote, ''); assert.equal(proposed.pricingMode, 'not_established'); assert.equal(proposed.pricingQuote, '');
  assert.ok(packaging.includes(proposed.packagingQuote));
  const state = { approved: true, company: {}, productFamilies: [], capabilities: {}, commercial: {}, icp: {} };
  const review = { status: 'reviewed', contextKey: competitorContext(state), pages: [{ checkedAt: new Date().toISOString() }] };
  assert.equal(competitorReviewCurrent(review, state), true); assert.equal(competitorReviewCurrent(review, { ...state, approved: false }), false);
});
test('model drafting excludes comparison notes and does not turn a competitive review into outreach approval', async t => {
  const h = await setup(t), run = await h.start(); await h.review(run); let captured;
  const lead = structuredClone(researchCatalog.find(item => item.id === 'elliott'));
  h.store.mutate('allco', s => { s.leads.push({ ...lead, selected: true, stage: 'Matched', fit: {score: 75, tier: 'B'}, events: [], contact: { email: null, mailboxStatus: 'unverified' } }); });
  const model = { status: () => ({ configured: true }), requireConfigured: () => {}, draft: async payload => { captured = payload; return { value: { subject: 'Fixture inquiry', body: `Technical qualification question. ${lead.source} https://www.allcohydraulic.com/`, claims: [{ text: 'Public product context', sourceUrl: lead.source }], qualificationQuestions: ['Which drawings apply?'] }, metadata: { model: 'fixture', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } }; } };
  const service = createService({ store: h.store, graph: h.graph, model });
  await service.draftWithModel('allco', lead.id, { requestId: randomUUID(), revision: h.store.read('allco').revision, acknowledgedExternalProcessing: true });
  assert.doesNotMatch(JSON.stringify(captured), /Owner interpretation|Rival Cylinders/);
  const draft = h.store.read('allco').drafts[0]; assert.equal(draft.status, 'draft'); assert.equal(draft.approvedHash, null);
  await assert.rejects(service.simulateSend('allco', draft.id), { code: 'approval_required' });
});
