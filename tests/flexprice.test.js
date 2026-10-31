import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore, recoverInterruptedWork } from '../server/store.js';
import { createService } from '../server/service.js';
import { createApp } from '../server/app.js';
import { createFlexpriceProvider, creditMicros } from '../server/flexprice-provider.js';
import { reloadCredits } from '../server/billing.js';
import { researchCatalog } from '../server/catalog.js';
import { scoreAccount } from '../server/evidence.js';
import { graphContextKey } from '../src/graph-context.js';

const key = 'designated-flexprice-fixture-key';
const environment = () => ({ PROJECT_FLEXPRICE_ENABLED: 'true', PROJECT_FLEXPRICE_REGION: 'us', PROJECT_FLEXPRICE_API_KEY: key, PROJECT_FLEXPRICE_METER_ID: 'meter_credits', PROJECT_FLEXPRICE_PRICE_ID: 'price_credits', PROJECT_FLEXPRICE_ALLCO_ENABLED: 'true', PROJECT_FLEXPRICE_ALLCO_CUSTOMER_ID: 'cus_allco', PROJECT_FLEXPRICE_ALLCO_EXTERNAL_CUSTOMER_ID: 'gtm_allco', PROJECT_FLEXPRICE_ALLCO_WALLET_ID: 'wal_allco' });
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function transport() {
  const calls = [], events = new Map();
  const control = { balance: '100.000000', cached: false, eventStatus: 'processed', price: 'price_credits', failIngest: false, wrongReceipt: false, walletOverride: {}, customerOverride: {}, lookupOverride: null };
  const fetcher = async (input, options) => {
    const url = new URL(input); calls.push({ url, options });
    if (url.pathname === '/v1/customers/cus_allco') return response({ id: 'cus_allco', external_id: 'gtm_allco', status: 'published', environment_id: 'env_fixture', email: 'PRIVATE_EMAIL', ...control.customerOverride });
    if (url.pathname === '/v1/wallets/wal_allco/balance/real-time') return response({ id: 'wal_allco', customer_id: 'cus_allco', status: 'published', wallet_status: 'active', wallet_type: 'PRE_PAID', currency: 'usd', conversion_rate: '1', real_time_credit_balance: control.balance, is_cached_fallback: control.cached, environment_id: 'env_fixture', ...control.walletOverride });
    if (url.pathname === '/v1/events') {
      const payload = JSON.parse(options.body); events.set(payload.event_id, payload);
      if (control.failIngest) throw Error('Upstream echoed ' + key);
      return response({ event_id: control.wrongReceipt ? 'wrong_event' : payload.event_id }, 202);
    }
    if (url.pathname === '/v1/events/lookup') {
      const event = events.get(url.searchParams.get('id'));
      if (!event) return response({ error: 'not found ' + key }, 404);
      const result = { status: control.eventStatus, event: { ...event, id: event.event_id, environment_id: 'env_fixture' }, processed_events: [{ customer_id: 'cus_allco', meter_id: 'meter_credits', price_id: control.price, qty_total: event.properties.credits }] };
      return response(control.lookupOverride ? control.lookupOverride(result) : result);
    }
    throw Error('Unexpected fixed endpoint');
  };
  return { fetcher, calls, events, control, posts: () => calls.filter(call => call.options.method === 'POST') };
}
const memoryGraph = () => ({ sync: async () => {}, snapshot: async () => ({ nodes: [], edges: [] }), paths: async () => [] });
async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gtm-flexprice-')); const store = createStore(directory);
  const remote = transport(); const env = { ...environment(), ...options.env };
  const provider = createFlexpriceProvider({ env, fetcher: remote.fetcher });
  const graph = options.graph || memoryGraph(); const service = createService({ store, graph, flexpriceProvider: provider, ...(options.readWebsiteSource ? {readWebsiteSource:options.readWebsiteSource} : {}) });
  const input = extra => ({ revision: store.read('allco').revision, expectedConsentVersion: store.read('allco').flexprice?.consent?.version || 0, bindingHash: provider.binding('allco').hash, acknowledged: true, acknowledgedRates: true, ...extra });
  const connect = () => service.connectBilling('allco', input());
  const consume = async (kind = 'graph_query', credits = 1, leadId) => { await service.prepareBilling('allco'); const id = store.reserve('allco', kind, credits, leadId); store.settle('allco', id, true); return id; };
  const sync = extra => service.syncBilling('allco', { revision: store.read('allco').revision, expectedConsentVersion: store.read('allco').flexprice?.consent?.version || 0, bindingHash: provider.binding('allco').hash, acknowledged: true, acknowledgedRetry: false, retryEventId: null, ...extra });
  t.after(async () => { try { store.close(); } catch { /* A restart test already closed this handle. */ } await rm(directory, { recursive: true, force: true }); });
  return { directory, store, service, provider, remote, input, connect, consume, sync };
}

test('disabled, generic, dummy and incomplete project configurations make no requests', async t => {
  for (const env of [{ PROJECT_FLEXPRICE_ENABLED: 'false' }, { PROJECT_FLEXPRICE_API_KEY: 'dummy-not-connected' }, { PROJECT_FLEXPRICE_API_KEY: '', FLEXPRICE_API_KEY: key }, { PROJECT_FLEXPRICE_REGION: 'https://evil.test' }]) {
    const x = await setup(t, { env }); assert.equal(x.provider.binding('allco').configured, false);
    await assert.rejects(x.provider.wallet('allco')); assert.equal(x.remote.calls.length, 0);
  }
});

test('separate business bindings reject shared customer, external ID or wallet identity', async t => {
  const x = await setup(t, { env: { PROJECT_FLEXPRICE_HUASHENG_ENABLED: 'true', PROJECT_FLEXPRICE_HUASHENG_CUSTOMER_ID: 'cus_allco', PROJECT_FLEXPRICE_HUASHENG_EXTERNAL_CUSTOMER_ID: 'gtm_huasheng', PROJECT_FLEXPRICE_HUASHENG_WALLET_ID: 'wal_huasheng' } });
  assert.equal(x.provider.binding('allco').configured, false); await assert.rejects(x.connect()); assert.equal(x.remote.calls.length, 0);
});

test('wallet authentication uses fixed official hosts and filters unrelated customer fields', async t => {
  const x = await setup(t); const value = await x.provider.wallet('allco');
  assert.equal(value.creditBalance, '100.000000'); assert.equal(value.currency, 'USD'); assert.doesNotMatch(JSON.stringify(value), /PRIVATE_EMAIL|designated-flexprice/);
  for (const call of x.remote.calls) { assert.equal(call.url.origin, 'https://us.api.flexprice.io'); assert.equal(call.options.headers['x-api-key'], key); assert.equal(call.options.redirect, 'manual'); assert.ok(call.options.signal); assert.equal(call.url.search, ''); }
});

test('wallet identity, active prepaid status and explicit uncached freshness are mandatory', async t => {
  const x = await setup(t);
  for (const patch of [{ is_cached_fallback: true }, { is_cached_fallback: undefined }, { customer_id: 'other_customer' }, { environment_id: 'other_environment' }, { wallet_status: 'frozen' }, { wallet_type: 'POST_PAID' }, { real_time_credit_balance: 'NaN' }, { real_time_credit_balance: '1e10' }, { conversion_rate: '0' }]) {
    x.remote.control.walletOverride = patch; await assert.rejects(x.provider.wallet('allco'));
  }
  x.remote.control.walletOverride = {}; x.remote.control.customerOverride = { external_id: 'wrong_customer' }; await assert.rejects(x.provider.wallet('allco'));
});

test('fixed-point amounts preserve fractional boundaries without floating point', () => {
  assert.equal(creditMicros('0.999999'), 999999n); assert.equal(creditMicros('1.000001'), 1000001n); assert.equal(creditMicros('-0.500000'), -500000n);
  for (const value of [1, 'Infinity', '1e6', '0.0000001', '1000000000000']) assert.throws(() => creditMicros(value));
});

test('credit gates require explicit mapping/rate consent and fresh provider balance', async t => {
  const x = await setup(t);
  assert.throws(() => x.store.reserve('allco', 'graph_query', 1), { code: 'flexprice_confirmation_required' });
  await assert.rejects(x.service.connectBilling('allco', x.input({ acknowledgedRates: false }))); assert.equal(x.remote.calls.length, 0);
  await x.connect(); x.remote.control.balance = '0.999999'; await x.service.prepareBilling('allco');
  assert.throws(() => x.store.reserve('allco', 'graph_query', 1), { code: 'flexprice_insufficient_credits' }); assert.equal(x.store.read('allco').wallet.credits, 100);
  x.remote.control.balance = '1.000000'; await x.service.prepareBilling('allco'); const id = x.store.reserve('allco', 'graph_query', 1); assert.ok(id);
  assert.throws(() => x.store.reserve('allco', 'graph_query', 1), { code: 'flexprice_usage_pending' });
});

test('demo reloads cannot fund the external wallet or bypass its gate', async t => {
  const x = await setup(t); await x.connect(); x.remote.control.balance = '0';
  reloadCredits(x.store, 'allco', { packId: 'scale', requestId: randomUUID() });
  await x.service.prepareBilling('allco'); assert.throws(() => x.store.reserve('allco', 'vendor_company', 5, 'a'), { code: 'flexprice_insufficient_credits' });
  assert.equal(x.store.read('allco').wallet.credits, 1100); assert.equal(x.remote.posts().length, 0);
});

test('successful settlement atomically queues one event with opaque lead allocation', async t => {
  const x = await setup(t); await x.connect(); const id = await x.consume('vendor_company', 5, 'PRIVATE_LEAD');
  x.store.settle('allco', id, true); const entry = x.store.read('allco').wallet.ledger[0];
  assert.equal(entry.metering.status, 'queued'); assert.equal(entry.metering.payload.properties.credits, '5'); assert.equal(entry.metering.payload.properties.units, '1');
  assert.equal(entry.metering.payload.properties.operation, 'enrichment_check_completed'); assert.equal(entry.metering.payload.properties.lead_key.length, 64);
  assert.doesNotMatch(JSON.stringify(entry.metering.payload), /PRIVATE_LEAD|PRIVATE_EMAIL|designated-flexprice/); assert.equal(x.remote.posts().length, 0);
  assert.equal(x.store.read('huasheng').wallet.credits, 100); assert.equal(x.service.snapshot('huasheng').flexprice.events.length, 0);
  await assert.rejects(x.service.prepareBilling('allco'), { code: 'flexprice_usage_pending' });
});

test('failed work and in-transaction cancellations refund without emitting usage', async t => {
  const x = await setup(t); await x.connect(); await x.service.prepareBilling('allco'); const id = x.store.reserve('allco', 'vendor_verify', 5, 'a');
  x.store.mutate('allco', state => x.store.settleUsageInState(state, state.wallet.ledger.find(entry => entry.id === id), false));
  assert.equal(x.store.read('allco').wallet.credits, 100); assert.equal(x.store.read('allco').wallet.ledger[0].metering.status, 'not_billed');
  await x.service.tickBilling(); assert.equal(x.remote.posts().length, 0);
});

test('acceptance is distinct from processing, matching price and fresh wallet reconciliation', async t => {
  const x = await setup(t); await x.connect(); const id = await x.consume(); await x.service.tickBilling();
  assert.equal(x.store.read('allco').wallet.ledger[0].metering.status, 'accepted');
  await assert.rejects(x.service.prepareBilling('allco'), { code: 'flexprice_usage_pending' });
  x.remote.control.eventStatus = 'processing'; await x.sync(); assert.equal(x.store.read('allco').wallet.ledger[0].metering.status, 'processing');
  x.remote.control.eventStatus = 'processed'; x.remote.control.price = 'wrong_price'; await x.sync(); assert.equal(x.store.read('allco').wallet.ledger[0].metering.status, 'price_unmatched');
  x.remote.control.price = 'price_credits'; x.remote.control.balance = '99'; await x.sync();
  const entry = x.store.read('allco').wallet.ledger[0]; assert.equal(entry.metering.status, 'processed'); assert.equal(entry.id, id); assert.equal(x.remote.posts().length, 1);
  assert.equal(x.service.snapshot('allco').flexprice.wallet.creditBalance, '99');
});

test('ambiguous ingestion never reposts automatically and reconciles the original event ID', async t => {
  const x = await setup(t); await x.connect(); await x.consume(); x.remote.control.failIngest = true; await x.service.tickBilling();
  assert.equal(x.store.read('allco').wallet.ledger[0].metering.status, 'unknown');
  assert.doesNotMatch(JSON.stringify(x.service.snapshot('allco')), new RegExp(key));
  await x.service.tickBilling(); assert.equal(x.remote.posts().length, 1);
  x.remote.control.failIngest = false; await x.sync(); assert.equal(x.store.read('allco').wallet.ledger[0].metering.status, 'processed'); assert.equal(x.remote.posts().length, 1);
});

test('same-ID resend requires acknowledgement, a not-found lookup and a bounded age', async t => {
  const x = await setup(t); await x.connect(); const id = await x.consume(); await x.service.tickBilling(); x.remote.events.clear();
  await assert.rejects(x.sync({ retryEventId: id }), { code: 'flexprice_retry_confirmation_required' });
  await x.sync({ retryEventId: id, acknowledgedRetry: true }); assert.equal(x.remote.posts().length, 2);
  assert.equal(JSON.parse(x.remote.posts()[0].options.body).event_id, JSON.parse(x.remote.posts()[1].options.body).event_id);
  x.remote.events.clear(); x.store.mutate('allco', state => { state.wallet.ledger[0].metering.payload.timestamp = new Date(Date.now() - 2 * 86400000).toISOString(); });
  await assert.rejects(x.sync({ retryEventId: id, acknowledgedRetry: true }), { code: 'flexprice_retry_expired' }); assert.equal(x.remote.posts().length, 2);
});

test('mismatched event receipts, payloads or environments cannot release a gate', async t => {
  const x = await setup(t); await x.connect(); await x.consume(); x.remote.control.wrongReceipt = true; await x.service.tickBilling();
  assert.equal(x.store.read('allco').wallet.ledger[0].metering.status, 'unknown');
  for (const mutate of [value => { value.event.environment_id = 'other'; }, value => { value.event.properties.credits = '500'; }, value => { value.event.external_customer_id = 'other'; }]) {
    x.remote.control.lookupOverride = value => { mutate(value); return value; }; await x.sync();
    assert.notEqual(x.store.read('allco').wallet.ledger[0].metering.status, 'processed');
  }
});

test('concurrent graph calls authorize only one external-credit reservation', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const x = await setup(t, { graph: { ...memoryGraph(), sync: async () => gate } }); await x.connect(); await x.service.prepareBilling('allco');
  const first = x.service.graphView('allco'); await assert.rejects(x.service.graphView('allco'), { code: 'flexprice_usage_pending' });
  release(); await first; assert.equal(x.store.read('allco').wallet.credits, 99); assert.equal(x.store.read('allco').wallet.ledger.length, 1);
});

test('local dry-run metering never emits Outreach Sent and retains HITL idempotency', async t => {
  const x = await setup(t); x.service.approveProfile('allco', true, x.store.read('allco').revision);
  x.store.mutate('allco', state => { state.leads = [{ ...structuredClone(researchCatalog[0]), businessId: 'allco', fit: scoreAccount(researchCatalog[0], state), selected: true, stage: 'Matched', events: [], contact: { email: 'public@buyer.test', mailboxStatus: 'unverified' } }]; });
  const draftId = x.service.draft('allco', researchCatalog[0].id); x.service.approveDraft('allco', draftId, true, x.store.read('allco').drafts[0].version);
  await x.connect(); await x.service.prepareBilling('allco'); await x.service.simulateSend('allco', draftId);
  const event = x.store.read('allco').wallet.ledger[0].metering;
  assert.equal(event.operation, 'outreach_dry_run'); assert.equal(event.payload.properties.delivery_mode, 'dry_run'); assert.doesNotMatch(JSON.stringify(event.payload), /outreach_sent|public@buyer|Elliott/);
  await x.service.prepareBilling('allco', { path: `/drafts/${draftId}/simulate` }); await x.service.simulateSend('allco', draftId);
  assert.equal(x.store.read('allco').wallet.ledger.length, 1);
});

test('paused metering blocks new work but keeps pending event identity and free corrections', async t => {
  const x = await setup(t); await x.connect(); const id = await x.consume();
  x.service.pauseBilling('allco', x.input()); await x.service.tickBilling();
  assert.equal(x.remote.posts().length, 0); assert.equal(x.store.read('allco').wallet.ledger[0].metering.id, id);
  await assert.rejects(x.service.prepareBilling('allco'), { code: 'flexprice_confirmation_required' });
  reloadCredits(x.store, 'allco', { packId: 'starter', requestId: randomUUID() }); assert.equal(x.store.read('allco').wallet.credits, 199);
});

test('HTTP session/CSRF/schema controls precede billing and wallet checks precede graph work', async t => {
  let graphCalls = 0; const x = await setup(t, { graph: { ...memoryGraph(), sync: async () => { graphCalls++; } } });
  const app = createApp({ store: x.store, service: x.service, serveStatic: false }); const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}/api`; const send = (route, body, headers = {}) => fetch(root + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await send('/businesses/allco/graph/query', {})).status, 401); assert.equal(x.remote.calls.length, 0);
  const session = await send('/session', {}); const token = await session.json(); const headers = { Cookie: session.headers.get('set-cookie').split(';')[0], 'x-csrf-token': token.csrf };
  assert.equal((await send('/businesses/allco/billing/flexprice/connect', { ...x.input(), apiKey: 'forbidden' }, headers)).status, 400); assert.equal(x.remote.calls.length, 0);
  assert.equal((await send('/businesses/allco/billing/flexprice/connect', x.input(), headers)).status, 200);
  x.remote.control.cached = true; assert.equal((await send('/businesses/allco/graph/query', {}, headers)).status, 503); assert.equal(graphCalls, 0);
  x.remote.control.cached = false; assert.equal((await send('/businesses/allco/graph/query', {}, headers)).status, 200); assert.equal(graphCalls, 1);
  assert.equal((await send('/businesses/allco/reset', {}, headers)).status, 200); assert.equal(x.store.read('allco').wallet.ledger[0].metering.status, 'queued'); assert.equal(x.store.read('allco').flexprice.consent.enabled, true);
});

test('restart recovers uncertain ingestion without automatic repost and preserves the event ID', async t => {
  const x = await setup(t); await x.connect(); const eventId = await x.consume();
  x.store.mutate('allco', state => { state.wallet.ledger[0].metering.status = 'sending'; state.wallet.ledger[0].metering.attempts = 1; });
  x.store.close(); const reopened = createStore(x.directory);
  try {
    recoverInterruptedWork(reopened); const service = createService({ store: reopened, graph: memoryGraph(), flexpriceProvider: x.provider });
    assert.equal(reopened.read('allco').wallet.ledger[0].metering.status, 'unknown'); await service.tickBilling(); assert.equal(x.remote.posts().length, 0);
    await service.syncBilling('allco', { revision: reopened.read('allco').revision, expectedConsentVersion: reopened.read('allco').flexprice.consent.version, bindingHash: x.provider.binding('allco').hash, acknowledged: true, retryEventId: eventId, acknowledgedRetry: true });
    assert.equal(x.remote.posts().length, 1); assert.equal(JSON.parse(x.remote.posts()[0].options.body).event_id, eventId); assert.equal(reopened.read('allco').wallet.credits, 99);
  } finally { reopened.close(); }
});

test('restart refunds interrupted reservations without generating an external usage event', async t => {
  const x = await setup(t); await x.connect(); await x.service.prepareBilling('allco'); x.store.reserve('allco', 'vendor_verify', 5, 'lead');
  x.store.close(); const reopened = createStore(x.directory);
  try {
    recoverInterruptedWork(reopened); const service = createService({ store: reopened, graph: memoryGraph(), flexpriceProvider: x.provider });
    await service.tickBilling(); assert.equal(reopened.read('allco').wallet.credits, 100); assert.equal(reopened.read('allco').wallet.ledger[0].metering.status, 'not_billed'); assert.equal(x.remote.posts().length, 0);
  } finally { reopened.close(); }
});

test('binding and wallet-unit changes cannot retarget pending usage or reuse consent', async t => {
  const x = await setup(t); await x.connect(); await x.consume();
  x.remote.control.walletOverride = { conversion_rate: '2' }; await x.service.tickBilling();
  assert.equal(x.remote.posts().length, 0); assert.equal(x.store.read('allco').wallet.ledger[0].metering.status, 'blocked');
  await assert.rejects(x.connect(), { code: 'flexprice_wallet_context_changed' });
  const other = createFlexpriceProvider({ env: { ...environment(), PROJECT_FLEXPRICE_PRICE_ID: 'price_changed' }, fetcher: x.remote.fetcher });
  const service = createService({ store: x.store, graph: memoryGraph(), flexpriceProvider: other });
  await assert.rejects(service.connectBilling('allco', {...x.input(),bindingHash:other.binding('allco').hash}), { code: 'flexprice_binding_changed' });
  await service.tickBilling(); assert.equal(x.remote.posts().length, 0);
});

test('failed fresh balance checks invalidate cached authorization', async t => {
  const x = await setup(t); await x.connect(); x.remote.control.cached = true;
  await assert.rejects(x.service.prepareBilling('allco'), { code: 'flexprice_stale_balance' });
  assert.throws(() => x.store.reserve('allco', 'graph_query', 1), { code: 'flexprice_balance_required' });
});

test('known request replay reaches its stored hash check while other work remains gated', async t => {
  const x = await setup(t, { readWebsiteSource: async url => ({url,finalUrl:url,title:'Fixture publication',text:'Alex Adams is Vice President of Engineering at this equipment manufacturer.',checkedAt:new Date().toISOString(),fetchStatus:'reachable'}) });
  x.service.approveProfile('allco',true,x.store.read('allco').revision);
  x.store.mutate('allco',state=>{state.leads=[{...structuredClone(researchCatalog[0]),businessId:'allco',fit:scoreAccount(researchCatalog[0],state),selected:false,stage:'Matched',events:[],contact:{email:null}}];});
  await x.connect(); await x.service.prepareBilling('allco');
  const leadId=researchCatalog[0].id, requestId=randomUUID(); const input={requestId,revision:x.store.read('allco').revision,sourceUrl:'https://elliottequip.com/team',employerUrl:null};
  const run=x.service.startPeopleResearch('allco',leadId,input);await run.completion;
  await x.service.prepareBilling('allco',{path:`/leads/${leadId}/people-research`,requestId});
  assert.equal(x.service.startPeopleResearch('allco',leadId,input).id,run.id);
  assert.throws(()=>x.service.startPeopleResearch('allco',leadId,{...input,sourceUrl:'https://elliottequip.com/other'}),{code:'person_request_conflict'});
  await assert.rejects(x.service.prepareBilling('allco',{path:'/source-intakes',requestId}),{code:'flexprice_usage_pending'});
  assert.equal(x.store.read('allco').wallet.ledger.length,1);
});

test('provider transport rejects redirects, error-body secrets and oversized responses', async () => {
  const cases = [
    { fetcher:async()=>response({secret:key},302), code:'flexprice_http_failed' },
    { fetcher:async()=>response({secret:key},401), code:'flexprice_auth_failed' },
    { fetcher:async()=>response({data:'x'.repeat(140000)}), code:'flexprice_response_limit' },
    { fetcher:async()=>new Response('not json '+key,{headers:{'content-type':'application/json'}}), code:'flexprice_unavailable' },
  ];
  for(const item of cases){const provider=createFlexpriceProvider({env:environment(),fetcher:item.fetcher});await assert.rejects(provider.wallet('allco'),error=>error.code===item.code&&!error.message.includes(key));}
});

test('authorization snapshots expire even when their stored balance is positive', async t => {
  const x=await setup(t);await x.connect();const realNow=Date.now;
  t.mock.method(Date,'now',()=>realNow()+31000);
  assert.throws(()=>x.store.reserve('allco','graph_query',1),{code:'flexprice_balance_required'});
  assert.equal(x.store.read('allco').wallet.credits,100);
});

test('scheduled source work performs the external gate and pauses on cached fallback', async t => {
  let sourceCalls=0;const x=await setup(t,{readWebsiteSource:async()=>{sourceCalls++;throw Error('Must not fetch');}});
  x.service.approveProfile('allco',true,x.store.read('allco').revision);
  x.store.mutate('allco',state=>{state.leads=[{...structuredClone(researchCatalog[0]),businessId:'allco',fit:scoreAccount(researchCatalog[0],state),selected:false,stage:'Matched',events:[],contact:{email:null}}];});
  await x.connect();const leadId=researchCatalog[0].id;
  x.service.configureSignalMonitor('allco',leadId,{revision:x.store.read('allco').revision,urls:['https://elliottequip.com/'],enabled:true,frequency:'daily',acknowledgedSchedule:true});
  x.store.mutate('allco',state=>{state.leads[0].signalMonitor.nextCheckAt=new Date(Date.now()-1000).toISOString();});
  x.remote.control.cached=true;await x.service.tickSignals();const state=x.store.read('allco');
  assert.equal(sourceCalls,0);assert.equal(state.wallet.credits,100);assert.equal(state.leads[0].signalMonitor.enabled,false);assert.match(state.leads[0].signalMonitor.pausedReason,/uncached/);
});

test('scheduled source settlement creates the same durable per-lead billing event', async t => {
  const x=await setup(t,{readWebsiteSource:async url=>({url,finalUrl:url,title:'Fixture company publication',text:'Fixture manufacturer builds industrial equipment. Published applications require engineering qualification.',checkedAt:new Date().toISOString(),fetchStatus:'reachable',contentHash:'fixture'})});
  x.service.approveProfile('allco',true,x.store.read('allco').revision);
  x.store.mutate('allco',state=>{state.leads=[{...structuredClone(researchCatalog[0]),businessId:'allco',fit:scoreAccount(researchCatalog[0],state),selected:false,stage:'Matched',events:[],contact:{email:null}}];});
  await x.connect();const leadId=researchCatalog[0].id;
  x.service.configureSignalMonitor('allco',leadId,{revision:x.store.read('allco').revision,urls:['https://elliottequip.com/'],enabled:true,frequency:'daily',acknowledgedSchedule:true});
  x.store.mutate('allco',state=>{state.leads[0].signalMonitor.nextCheckAt=new Date(Date.now()-1000).toISOString();});
  await x.service.tickSignals();const entry=x.store.read('allco').wallet.ledger[0];
  assert.equal(entry.status,'consumed');assert.equal(entry.metering.status,'queued');assert.equal(entry.metering.operation,'market_source_check_completed');assert.equal(entry.metering.payload.properties.credits,'2');assert.equal(entry.metering.leadKey.length,64);
});

test('billing progress preserves graph snapshots while relationship changes invalidate them', async t => {
  const x=await setup(t);await x.connect();await x.service.prepareBilling('allco');const result=await x.service.graphView('allco');
  assert.equal(result.contextKey,graphContextKey(x.service.snapshot('allco')));
  await x.service.tickBilling();assert.equal(result.contextKey,graphContextKey(x.service.snapshot('allco')));
  x.store.mutate('allco',state=>{state.knownConnections=[{id:'fixture',reviewId:'review',personKey:'person',status:'active',relationship:'worked_together',note:'PRIVATE_NOTE'}];});
  const changed=graphContextKey(x.service.snapshot('allco'));assert.notEqual(result.contextKey,changed);assert.doesNotMatch(changed,/PRIVATE_NOTE/);
  x.store.mutate('allco',state=>{state.knownConnections[0].status='revoked';});assert.notEqual(changed,graphContextKey(x.service.snapshot('allco')));
});

test('evidence changes during a graph query reject the stale result and refund its usage', async t => {
  let release;const gate=new Promise(resolve=>{release=resolve;});const x=await setup(t,{graph:{...memoryGraph(),sync:async()=>gate}});
  await x.connect();await x.service.prepareBilling('allco');const query=x.service.graphView('allco');
  x.store.mutate('allco',state=>{state.knownConnections=[{id:'new-connection',reviewId:'review',personKey:'person',status:'active',relationship:'worked_together'}];});
  release();await assert.rejects(query,{code:'stale_graph_context'});assert.equal(x.store.read('allco').wallet.credits,100);assert.equal(x.store.read('allco').wallet.ledger[0].metering.status,'not_billed');
});

test('billing decisions bind to consent versions, not unrelated workspace telemetry revisions', async t => {
  const x=await setup(t);const original=x.input();x.store.mutate('allco',state=>{state.activity=[];});
  await x.service.connectBilling('allco',original);assert.equal(x.store.read('allco').flexprice.consent.version,1);
  const valid=x.input();await x.service.syncBilling('allco',{...valid,revision:0,retryEventId:null,acknowledgedRetry:false});
  assert.throws(()=>x.service.pauseBilling('allco',original),{code:'flexprice_decision_changed'});
  await assert.rejects(x.service.syncBilling('allco',{...original,retryEventId:null,acknowledgedRetry:false}),{code:'flexprice_decision_changed'});
  x.service.pauseBilling('allco',valid);assert.equal(x.store.read('allco').flexprice.consent.version,2);
  await assert.rejects(x.service.connectBilling('allco',valid),{code:'flexprice_decision_changed'});
});
