import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createGraph } from '../server/graph.js';
import { graphContextKey } from '../src/graph-context.js';
import { createStore, recoverInterruptedWork } from '../server/store.js';
import { createService } from '../server/service.js';
import { createFlexpriceProvider } from '../server/flexprice-provider.js';
import { createApp } from '../server/app.js';
import { createSendgridProvider, unsubscribeToken } from '../server/sendgrid-provider.js';
import { researchCatalog } from '../server/catalog.js';

const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const fixtureKey = 'SG.' + 'A'.repeat(22) + '.' + 'B'.repeat(43);
const environment = () => ({ PROJECT_SENDGRID_ENABLED: 'true', PROJECT_SENDGRID_API_KEY: fixtureKey, PROJECT_SENDGRID_EVENT_PUBLIC_KEY: publicKey, PROJECT_ACCESS_TOKEN: 'project-email-fixture-access-only', PUBLIC_ORIGIN: 'https://gtm-fixture.example.com', PROJECT_SENDGRID_ALLCO_ENABLED: 'true', PROJECT_SENDGRID_ALLCO_SENDER_ID: '101', PROJECT_SENDGRID_ALLCO_FROM_EMAIL: 'sender@allco-fixture.test', PROJECT_SENDGRID_ALLCO_UNSUBSCRIBE_GROUP_ID: '201' });
const sender = () => ({ id: 101, verified: true, from_email: 'sender@allco-fixture.test', from_name: 'Allco Fixture', reply_to: 'reply@allco-fixture.test', address: '10 Fixture Street', city: 'Fixture City', state: 'CA', zip: '99999', country: 'USA' });
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
const graph = { sync: async () => {}, paths: async () => [], snapshot: async () => ({ nodes: [], edges: [] }) };
function signed(events, timestamp = String(Math.floor(Date.now() / 1000))) {
  const bytes = Buffer.from(JSON.stringify(events)); return { bytes, timestamp, signature: sign('sha256', Buffer.concat([Buffer.from(timestamp), bytes]), pair.privateKey).toString('base64') };
}
async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gtm-email-')), store = createStore(directory), env = options.env || environment(), calls = [];
  const control = { sender: sender(), groups: [{ id: 201, name: 'Allco supplier introductions' }], global: {}, suppressions: [], response: 'accepted', gate: null, duringSend: null };
  const provider = createSendgridProvider({ env, fetcher: async (url, request) => {
    calls.push({ url, request }); if (options.fetcher) return options.fetcher(url, request);
    if (url.pathname === '/v3/verified_senders') return json({ results: [control.sender] });
    if (url.pathname === '/v3/asm/groups') return json(control.groups);
    if (url.pathname.startsWith('/v3/asm/suppressions/global/')) return json(control.global);
    if (url.pathname.startsWith('/v3/asm/suppressions/')) return json({ suppressions: control.suppressions });
    if (url.pathname === '/v3/mail/send') { if (control.duringSend) await control.duringSend(JSON.parse(request.body)); if (control.gate) await control.gate; if (control.response === 'throw') throw Error('private provider key ' + fixtureKey); if (control.response === 'reject') return new Response('', { status: 400 }); if (control.response === 'unknown') return new Response('', { status: 503 }); return new Response(null, { status: 202, headers: { 'x-message-id': 'provider-fixture-id' } }); }
    throw Error('Unexpected fixture endpoint');
  } });
  const activeGraph = options.native ? await createGraph(directory) : options.graph || graph;
  const service = createService({ store, graph: activeGraph, emailProvider: provider, ...(options.flexpriceProvider ? { flexpriceProvider: options.flexpriceProvider } : {}) }); service.approveProfile('allco', true, store.read('allco').revision);
  store.mutate('allco', state => { state.leads = [{ ...structuredClone(researchCatalog[0]), selected: true, stage: 'Matched', events: [], contact: { email: 'buyer@buyer-fixture.test', linkedIn: 'https://www.linkedin.com/in/fixture-person' }, fit: { score: 80, tier: 'A' } }]; });
  const decision = extra => ({ requestId: randomUUID(), revision: store.read('allco').revision, acknowledged: true, ...extra });
  const check = () => service.checkEmailSender('allco', decision());
  const confirm = () => { const view = service.snapshot('allco').delivery; return service.confirmEmailSender('allco', { revision: store.read('allco').revision, acknowledged: true, bindingHash: view.bindingHash, senderHash: view.sender.hash }); };
  const enable = async () => { await check(); confirm(); };
  const draft = (variant = 'A', step = 0) => service.draft('allco', 'elliott', 'email', variant, step);
  const approve = id => { const current = store.read('allco').drafts.find(item => item.id === id); return service.approveDraft('allco', id, true, current.version, 'live'); };
  const send = (id, extra = {}) => service.sendEmail('allco', id, { requestId: randomUUID(), version: store.read('allco').drafts.find(item => item.id === id).version, acknowledged: true, ...extra });
  const event = (attemptId, type = 'delivered', extra = {}) => ({ event: type, email: 'buyer@buyer-fixture.test', timestamp: Math.floor(Date.now() / 1000), sg_event_id: randomUUID(), sg_message_id: 'provider-fixture-id.filter.fixture', gtm_business_id: 'allco', gtm_dispatch_id: attemptId, ...extra });
  const ingest = async events => { const value = signed(events); return service.receiveEmailEvents(value.bytes, value.signature, value.timestamp); };
  t.after(async () => { await activeGraph.close?.(); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, store, graph: activeGraph, service, provider, control, calls, env, decision, check, confirm, enable, draft, approve, send, event, ingest, posts: () => calls.filter(call => call.request.method === 'POST') };
}
test('live adapter ignores global/personal/dummy keys, requires project protection/signed events and makes no calls when disabled', async () => {
  let calls = 0;
  for (const patch of [{ PROJECT_SENDGRID_ENABLED: 'false' }, { PROJECT_SENDGRID_API_KEY: 'dummy-not-connected' }, { PROJECT_SENDGRID_API_KEY: undefined, SENDGRID_API_KEY: fixtureKey }, { PROJECT_SENDGRID_EVENT_PUBLIC_KEY: '' }, { PUBLIC_ORIGIN: 'http://127.0.0.1:3001' }, { PROJECT_ACCESS_TOKEN: '' }]) {
    const provider = createSendgridProvider({ env: { ...environment(), ...patch }, fetcher: async () => { calls++; } }); assert.equal(provider.binding('allco').configured, false); await assert.rejects(provider.checkSender('allco'), { code: 'delivery_not_configured' });
  } assert.equal(calls, 0);
  const conflict = createSendgridProvider({ env: { ...environment(), PROJECT_SENDGRID_HUASHENG_ENABLED: 'true', PROJECT_SENDGRID_HUASHENG_SENDER_ID: '101', PROJECT_SENDGRID_HUASHENG_FROM_EMAIL: 'sender@other-fixture.test', PROJECT_SENDGRID_HUASHENG_UNSUBSCRIBE_GROUP_ID: '202' } }); assert.equal(conflict.binding('allco').configured, false);
});
test('sender check uses fixed official endpoints and explicit business confirmation; identity changes revoke live approval', async t => {
  const x = await setup(t); const id = x.draft(); assert.throws(() => x.approve(id), { code: 'delivery_sender_confirmation_required' }); await x.check(); assert.equal(x.service.snapshot('allco').delivery.available, false); x.confirm(); x.approve(id);
  const approved = x.store.read('allco').drafts[0]; assert.match(approved.approvedLiveMessage.body, /10 Fixture Street/); assert.ok(approved.approvedLiveMessage.body.endsWith(unsubscribeToken)); assert.equal(approved.approvedLiveMessage.replyTo.email, 'reply@allco-fixture.test');
  x.control.sender.from_name = 'Changed Sender Identity'; await x.check(); assert.equal(x.store.read('allco').drafts[0].status, 'draft'); assert.equal(x.service.snapshot('allco').delivery.available, false);
  assert.ok(x.calls.every(call => call.url.origin === 'https://api.sendgrid.com' && call.request.redirect === 'error')); assert.equal(x.calls[0].request.headers.Authorization, 'Bearer ' + fixtureKey); assert.doesNotMatch(JSON.stringify(x.service.snapshot('allco')), new RegExp(fixtureKey.replaceAll('.', '\\.')));
});
test('sender/revision/ack/verification and stale confirmation gates prevent live approval', async t => {
  const x = await setup(t); await assert.rejects(x.service.checkEmailSender('allco', x.decision({ acknowledged: false })), { code: 'delivery_sender_review_required' });
  await assert.rejects(x.service.checkEmailSender('allco', x.decision({ revision: 0 })), { code: 'revision_conflict' }); assert.equal(x.calls.length, 0);
  x.control.sender.verified = false; await x.check(); assert.equal(x.service.snapshot('allco').delivery.checks[0].status, 'failed'); assert.throws(x.confirm);
  x.control.sender = sender(); await x.enable(); const view = x.service.snapshot('allco').delivery;
  assert.throws(() => x.service.confirmEmailSender('allco', { revision: x.store.read('allco').revision, acknowledged: true, senderHash: 'x'.repeat(64), bindingHash: view.bindingHash }), { code: 'stale_delivery_sender' });
  x.store.mutate('allco', state => { state.company.name = 'Changed business identity'; }); assert.equal(x.service.snapshot('allco').delivery.available, false);
});
test('dry-run approval cannot send live, live approval cannot simulate, and final live acknowledgement is required', async t => {
  const x = await setup(t); await x.enable(); const id = x.draft(); x.service.approveDraft('allco', id, true, 1);
  await assert.rejects(x.send(id), { code: 'live_approval_required' }); x.service.rejectDraft('allco', id); x.approve(id);
  await assert.rejects(x.service.simulateSend('allco', id), { code: 'approval_mode_mismatch' }); await assert.rejects(x.send(id, { acknowledged: false }), { code: 'live_send_acknowledgement_required' }); assert.equal(x.posts().length, 0); assert.equal(x.store.read('allco').wallet.credits, 100);
});
test('one approved plain-text email is submitted once; acceptance, credit, pipeline and replay are durable', async t => {
  const x = await setup(t); await x.enable(); const id = x.draft(); x.approve(id); const input = { requestId: randomUUID(), acknowledged: true, version: 1 };
  const result = await x.service.sendEmail('allco', id, input); await x.service.sendEmail('allco', id, input);
  assert.equal(x.posts().length, 1); assert.equal(result.wallet.credits, 99); assert.equal(result.drafts[0].status, 'accepted'); assert.equal(result.drafts[0].deliveryStatus, 'accepted'); assert.equal(result.metrics.liveAccepted, 1); assert.equal(result.leads[0].events.filter(event => event.mode === 'live').length, 1);
  const payload = JSON.parse(x.posts()[0].request.body); assert.equal(payload.personalizations.length, 1); assert.deepEqual(payload.personalizations[0].to, [{ email: 'buyer@buyer-fixture.test' }]); assert.equal(payload.personalizations[0].custom_args.gtm_dispatch_id, input.requestId); assert.equal(payload.content[0].value, x.store.read('allco').drafts[0].approvedLiveMessage.body); assert.equal(payload.asm.group_id, 201); assert.equal(payload.tracking_settings.open_tracking.enable, false); assert.equal(payload.tracking_settings.click_tracking.enable, false); assert.equal(payload.attachments, undefined);
  const reopened = createStore(x.directory); try { assert.equal(reopened.read('allco').delivery.attempts[0].id, input.requestId); } finally { reopened.close(); }
  await assert.rejects(x.service.sendEmail('allco', id, { ...input, version: 2 }), { code: 'delivery_request_conflict' }); assert.throws(() => x.service.editDraft('allco', id, { body: 'Changed' }), { code: 'draft_locked' });
});
test('known rejection refunds once and clears approval; ambiguous responses retain a locked reservation and never resend', async t => {
  for (const response of ['reject', 'unknown', 'throw']) {
    const x = await setup(t); await x.enable(); const id = x.draft(); x.approve(id); x.control.response = response; const input = { requestId: randomUUID(), acknowledged: true, version: 1 };
    const result = await x.service.sendEmail('allco', id, input); await x.service.sendEmail('allco', id, input); assert.equal(x.posts().length, 1); assert.doesNotMatch(JSON.stringify(result), /private provider key/);
    if (response === 'reject') { assert.equal(result.wallet.credits, 100); assert.equal(result.wallet.ledger[0].status, 'refunded'); assert.equal(result.drafts[0].status, 'draft'); assert.equal(result.drafts[0].approvedHash, null); }
    else { assert.equal(result.wallet.credits, 99); assert.equal(result.wallet.ledger[0].status, 'reserved'); assert.equal(result.drafts[0].status, 'delivery_unknown'); assert.throws(() => x.service.rejectDraft('allco', id), { code: 'draft_locked' }); await assert.rejects(x.send(id), { code: 'live_approval_required' }); }
  }
});
test('unknown transmission survives restart, profile/source regeneration and alternate-variant attempts', async t => {
  const x = await setup(t); await x.enable(); const id = x.draft(), alternate = x.draft('B'); x.approve(id); x.approve(alternate); x.control.response = 'unknown'; const result = await x.send(id);
  recoverInterruptedWork(x.store); recoverInterruptedWork(x.store); assert.equal(x.store.read('allco').wallet.credits, 99); assert.equal(x.store.read('allco').wallet.ledger[0].status, 'reserved');
  assert.equal(x.service.draft('allco', 'elliott'), id); await assert.rejects(x.send(alternate), { code: 'variant_already_sent' });
  x.service.saveProfile('allco', { icp: { ...x.store.read('allco').icp, triggers: 'Changed profile' } }, x.store.read('allco').revision); assert.equal(x.store.read('allco').drafts.find(draft => draft.id === id).status, 'delivery_unknown');
  await x.ingest([x.event(result.delivery.attempts[0].id, 'processed')]); assert.equal(x.store.read('allco').wallet.ledger[0].status, 'consumed'); assert.equal(x.store.read('allco').wallet.credits, 99);
});
test('a signed receipt can win the HTTP race; later uncertainty never downgrades acceptance or duplicates debit', async t => {
  const x = await setup(t); await x.enable(); const id = x.draft(); x.approve(id); x.control.response = 'unknown'; x.control.duringSend = async payload => { await x.ingest([x.event(payload.personalizations[0].custom_args.gtm_dispatch_id)]); };
  const result = await x.send(id); assert.equal(result.delivery.attempts[0].status, 'accepted'); assert.equal(result.drafts[0].deliveryStatus, 'delivered'); assert.equal(result.wallet.credits, 99); assert.equal(result.wallet.ledger[0].status, 'consumed');
});
test('local/provider suppression, sender drift and mid-flight preference changes prevent transmission without debit', async t => {
  const x = await setup(t); await x.enable(); const id = x.draft(); x.approve(id); x.control.global = { recipient_email: 'buyer@buyer-fixture.test' }; await assert.rejects(x.send(id), { code: 'contact_suppressed' }); assert.equal(x.posts().length, 0); assert.equal(x.store.read('allco').wallet.credits, 100); assert.ok(x.store.read('allco').contactSuppressions.length);
  const y = await setup(t); await y.enable(); const other = y.draft(); y.approve(other); y.control.sender.from_name = 'Changed'; await assert.rejects(y.send(other), { code: 'stale_delivery_sender' }); assert.equal(y.posts().length, 0);
  const z = await setup(t); await z.enable(); const message = z.draft(); z.approve(message); const original = z.provider.checkSender; z.provider.checkSender = async id => { const sender = await original(id); z.service.holdCommunication('allco', z.decision({ kind: 'email', target: 'unrelated@other-fixture.test', reason: 'manual_hold', reportedAt: new Date().toISOString(), note: 'Fixture change during preflight' })); return sender; }; await assert.rejects(z.send(message), { code: 'stale_delivery_context' }); assert.equal(z.posts().length, 0); assert.equal(z.store.read('allco').wallet.credits, 100);
});
test('signed event verification rejects altered bytes, wrong keys and unmatched recipients/business/message IDs', async t => {
  const x = await setup(t); await x.enable(); const id = x.draft(); x.approve(id); const result = await x.send(id), attempt = result.delivery.attempts[0], event = x.event(attempt.id), value = signed([event]);
  await assert.rejects(x.service.receiveEmailEvents(Buffer.from(value.bytes.toString() + ' '), value.signature, value.timestamp), { code: 'delivery_signature_invalid' });
  await assert.rejects(x.service.receiveEmailEvents(value.bytes, value.signature, String(Number(value.timestamp) + 1000)), { code: 'delivery_signature_invalid' });
  const wrong = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); const signature = sign('sha256', Buffer.concat([Buffer.from(value.timestamp), value.bytes]), wrong.privateKey).toString('base64'); await assert.rejects(x.service.receiveEmailEvents(value.bytes, signature, value.timestamp), { code: 'delivery_signature_invalid' });
  const ignored = await x.ingest([x.event(attempt.id, 'delivered', { email: 'other@buyer-fixture.test' }), x.event(attempt.id, 'delivered', { gtm_business_id: 'huasheng' }), x.event(attempt.id, 'delivered', { sg_message_id: 'wrong-message-id' }), x.event(randomUUID())]); assert.equal(ignored.matched, 0); assert.equal(x.store.read('allco').delivery.attempts[0].deliveryStatus, 'accepted');
});
test('duplicate/out-of-order receipts never duplicate contact/credit, infer a reply, or regress delivered status', async t => {
  const x = await setup(t); await x.enable(); const id = x.draft(); x.approve(id); const sent = await x.send(id), attempt = sent.delivery.attempts[0]; const delivered = x.event(attempt.id);
  await x.ingest([delivered, delivered, x.event(attempt.id, 'processed'), x.event(attempt.id, 'deferred')]); const state = x.store.read('allco'); assert.equal(state.delivery.attempts[0].deliveryStatus, 'delivered'); assert.equal(state.wallet.credits, 99); assert.equal(state.leads[0].events.filter(item => item.stage === 'Contacted').length, 1); assert.equal(state.leads[0].events.filter(item => item.stage === 'Replied').length, 0); assert.equal(state.delivery.attempts[0].events.length, 3);
});
test('provider opt-out and bounce events invalidate editable recipients and survive manual release', async t => {
  const x = await setup(t); await x.enable(); const id = x.draft(), followup = x.draft('A', 1); x.approve(id); x.approve(followup); const sent = await x.send(id), attempt = sent.delivery.attempts[0];
  await x.ingest([x.event(attempt.id, 'group_unsubscribe', { asm_group_id: 999 })]); assert.equal(x.store.read('allco').contactSuppressions.length, 0);
  await x.ingest([x.event(attempt.id, 'group_unsubscribe', { asm_group_id: 201 }), x.event(attempt.id, 'bounce')]); const state = x.store.read('allco'); assert.equal(state.contactSuppressions.length, 1); assert.equal(state.drafts.find(draft => draft.id === followup).recipient, ''); assert.equal(state.drafts.find(draft => draft.id === followup).approvedHash, null); assert.equal(state.drafts.find(draft => draft.id === id).status, 'accepted');
  assert.throws(() => x.service.draft('allco', 'elliott', 'email', 'B', 2), { code: 'contact_suppressed' }); assert.equal(x.store.read('huasheng').contactSuppressions.length, 0);
});
test('public signed webhook bypasses only session/CSRF, with bounded signed input; reset retains receipts and late opt-outs', async t => {
  const x = await setup(t); await x.enable(); const id = x.draft(); x.approve(id); const sent = await x.send(id), attempt = sent.delivery.attempts[0];
  const server = createApp({ store: x.store, service: x.service, serveStatic: false }).listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve))); const root = `http://127.0.0.1:${server.address().port}/api`;
  const webhook = root + '/delivery/sendgrid/events'; assert.equal((await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]' })).status, 403);
  assert.equal((await fetch(root + '/businesses/allco/drafts/' + id + '/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  const session = await fetch(root + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), { csrf } = await session.json(), headers = { 'content-type': 'application/json', cookie: session.headers.get('set-cookie').split(';')[0], 'x-csrf-token': csrf };
  const reset = await fetch(root + '/businesses/allco/reset', { method: 'POST', headers, body: '{}' }); assert.equal(reset.status, 200); assert.equal((await reset.json()).delivery.attempts[0].id, attempt.id);
  const signedEvent = signed([x.event(attempt.id, 'unsubscribe')]); const receipt = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json', 'x-twilio-email-event-webhook-signature': signedEvent.signature, 'x-twilio-email-event-webhook-timestamp': signedEvent.timestamp }, body: signedEvent.bytes }); assert.equal(receipt.status, 200); assert.equal((await receipt.json()).matched, 1); assert.equal(x.store.read('allco').leads.length, 0); assert.equal(x.store.read('allco').drafts.length, 0); assert.equal(x.store.read('allco').contactSuppressions.length, 1); assert.equal(x.store.read('allco').wallet.credits, 99);
});
test('five-per-minute live limit gates before another provider lookup and preserves successful request replays', async t => {
  const x = await setup(t); await x.enable();
  x.store.mutate('allco', state => { const template = state.leads[0]; for (let i = 1; i < 6; i++) state.leads.push({ ...structuredClone(template), id: 'fixture-' + i, name: 'Synthetic Buyer ' + i, events: [], contact: { email: `buyer${i}@buyer-fixture.test` } }); });
  let replay, first;
  for (let i = 0; i < 5; i++) { const leadId = i ? 'fixture-' + i : 'elliott', id = x.service.draft('allco', leadId); x.approve(id); const input = { requestId: randomUUID(), version: 1, acknowledged: true }; await x.service.sendEmail('allco', id, input); if (!i) { first = id; replay = input; } }
  const next = x.service.draft('allco', 'fixture-5'); x.approve(next); const calls = x.calls.length;
  await assert.rejects(x.send(next), { code: 'delivery_rate_limited' }); assert.equal(x.calls.length, calls); assert.equal(x.posts().length, 5); assert.equal(x.store.read('allco').wallet.credits, 95);
  await x.service.sendEmail('allco', first, replay); assert.equal(x.posts().length, 5);
});
test('restart during submission retains a pending credit and reset refuses uncertain transmission', async t => {
  const x = await setup(t); await x.enable(); const id = x.draft(); x.approve(id); let resolve, started;
  x.control.gate = new Promise(done => { resolve = done; }); const ready = new Promise(done => { started = done; }); x.control.duringSend = async () => started();
  const pending = x.send(id); await ready; assert.equal(x.store.read('allco').drafts[0].status, 'dispatching'); recoverInterruptedWork(x.store); assert.equal(x.store.read('allco').drafts[0].status, 'delivery_unknown'); assert.equal(x.store.read('allco').wallet.ledger[0].status, 'reserved'); assert.equal(x.posts().length, 1);
  const server = createApp({ store: x.store, service: x.service, serveStatic: false }).listen(0, '127.0.0.1'); await new Promise(done => server.on('listening', done)); t.after(() => new Promise(done => server.close(done))); const root = `http://127.0.0.1:${server.address().port}/api`;
  const session = await fetch(root + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), { csrf } = await session.json(); const headers = { 'content-type': 'application/json', cookie: session.headers.get('set-cookie').split(';')[0], 'x-csrf-token': csrf };
  const reset = await fetch(root + '/businesses/allco/reset', { method: 'POST', headers, body: '{}' }); assert.equal(reset.status, 409); assert.equal((await reset.json()).code, 'delivery_pending');
  resolve(); const result = await pending; assert.equal(result.drafts[0].status, 'accepted'); assert.equal(result.wallet.credits, 99); assert.equal(result.delivery.attempts[0].error, null);
});
test('configured unsubscribe group suppression and conflicting signed receipts remain fail-closed', async t => {
  const x = await setup(t); await x.enable(); const id = x.draft(); x.approve(id); x.control.suppressions = [{ id: 201, suppressed: true }]; await assert.rejects(x.send(id), { code: 'contact_suppressed' }); assert.equal(x.posts().length, 0);
  const y = await setup(t); await y.enable(); const other = y.draft(); y.approve(other); y.control.response = 'reject'; const result = await y.send(other), attempt = result.delivery.attempts[0]; await y.ingest([y.event(attempt.id)]); await y.ingest([y.event(attempt.id, 'processed')]); const state = y.store.read('allco'); assert.equal(state.delivery.attempts[0].status, 'receipt_conflict'); assert.equal(state.wallet.credits, 100); assert.equal(y.service.snapshot('allco').delivery.available, false); assert.throws(() => y.approve(other), { code: 'delivery_investigation_required' });
});
test('Flexprice meters accepted live mail as live outreach, keeps unknown reservations unresolved, and settles one signed receipt once', async t => {
  const env = { PROJECT_FLEXPRICE_ENABLED: 'true', PROJECT_FLEXPRICE_REGION: 'us', PROJECT_FLEXPRICE_API_KEY: 'project-flexprice-email-fixture-key', PROJECT_FLEXPRICE_METER_ID: 'meter_credits', PROJECT_FLEXPRICE_PRICE_ID: 'price_credits', PROJECT_FLEXPRICE_ALLCO_ENABLED: 'true', PROJECT_FLEXPRICE_ALLCO_CUSTOMER_ID: 'cus_allco', PROJECT_FLEXPRICE_ALLCO_EXTERNAL_CUSTOMER_ID: 'gtm_allco', PROJECT_FLEXPRICE_ALLCO_WALLET_ID: 'wal_allco' };
  const provider = createFlexpriceProvider({ env, fetcher: async url => String(url).includes('/customers/') ? json({ id: 'cus_allco', external_id: 'gtm_allco', status: 'published', environment_id: 'env_fixture' }) : json({ id: 'wal_allco', customer_id: 'cus_allco', status: 'published', wallet_status: 'active', wallet_type: 'PRE_PAID', currency: 'usd', conversion_rate: '1', real_time_credit_balance: '100.000000', is_cached_fallback: false, environment_id: 'env_fixture' }) });
  const x = await setup(t, { flexpriceProvider: provider }); await x.enable(); await x.service.connectBilling('allco', { revision: x.store.read('allco').revision, expectedConsentVersion: 0, bindingHash: provider.binding('allco').hash, acknowledged: true, acknowledgedRates: true });
  const id = x.draft(); x.approve(id); x.control.response = 'unknown'; const result = await x.send(id), attempt = result.delivery.attempts[0]; let entry = x.store.read('allco').wallet.ledger[0]; assert.equal(entry.metering.status, 'reserved'); assert.equal(entry.metering.payload, undefined); await assert.rejects(x.service.enrich('allco', 'elliott'), { code: 'flexprice_usage_pending' });
  const event = x.event(attempt.id, 'processed'); await x.ingest([event, event]); entry = x.store.read('allco').wallet.ledger[0]; assert.equal(entry.status, 'consumed'); assert.equal(entry.metering.status, 'queued'); assert.equal(entry.metering.payload.properties.delivery_mode, 'live'); assert.equal(entry.metering.payload.properties.operation, 'outreach_sent'); assert.equal(entry.metering.payload.event_id, entry.id); assert.equal(x.store.read('allco').wallet.credits, 99);
});

test('matched signed receipts update native outreach properties and graph currency without manufacturing reply edges', async t => {
  const x = await setup(t, { native: true }); await x.enable(); const id = x.draft(); x.approve(id); const result = await x.send(id), attempt = result.delivery.attempts[0], before = graphContextKey(x.store.read('allco'));
  let snapshot = await x.graph.snapshot('allco'); assert.equal(snapshot.nodes.find(node => node.data.draftId === id).data.providerStatus, 'accepted');
  await x.ingest([x.event(attempt.id)]); snapshot = await x.graph.snapshot('allco'); const receipt = snapshot.nodes.find(node => node.data.draftId === id); assert.equal(receipt.data.providerStatus, 'delivered'); assert.ok(receipt.data.signedReceiptAt); assert.notEqual(graphContextKey(x.store.read('allco')), before); assert.equal(snapshot.edges.filter(edge => edge.type === 'contacted_via').length, 1); assert.equal(snapshot.edges.filter(edge => edge.type === 'replied_to').length, 0);
});
