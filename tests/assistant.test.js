import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createService } from '../server/service.js';
import { createModelProvider, validateSuggestions, validateDraft } from '../server/model.js';
import { localIntake } from '../server/intake.js';
import { profileConfidence } from '../src/businesses.js';
import { researchCatalog } from '../server/catalog.js';
import { scoreAccount } from '../server/evidence.js';

const fixtureEnv = { PROJECT_AI_ENABLED: 'true', PROJECT_OPENAI_API_KEY: 'test-project-key-fixtures-only', PROJECT_OPENAI_MODEL: 'fixture-model' };
const graph = { sync: async () => {}, snapshot: async () => ({}), paths: async () => [] };
const proposal = { summary: 'Explicit US target.', suggestions: [{ field: 'regions', value: 'United States', confidence: 0.9, basis: 'user_input', evidence: 'US' }], questions: ['What employee range should we target?'], caveats: ['Uncalibrated suggestion.'] };
function response(value, overrides = {}) {
  return new Response(JSON.stringify({ id: 'resp_fixture', object: 'response', created_at: 1, model: 'fixture-model', status: 'completed', output: [{ id: 'msg_fixture', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }] }], usage: { input_tokens: 120, output_tokens: 45, total_tokens: 165 }, ...overrides }), { status: 200, headers: { 'content-type': 'application/json' } });
}
async function setup(t, model = createModelProvider({ env: {} })) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtm-assistant-')); const store = createStore(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const service = createService({ store, graph, model });
  const request = (message, mode = 'local', requestId = randomUUID()) => ({ message, mode, requestId, acknowledgedExternalProcessing: mode === 'model', revision: store.read('allco').revision });
  const seed = () => { service.approveProfile('allco', true, store.read('allco').revision); store.mutate('allco', s => { s.leads = [{ ...researchCatalog[0], fit: scoreAccount(researchCatalog[0], s), selected: true, stage: 'Matched', contact: { email: 'test@example.test', linkedIn: null }, events: [] }]; }); };
  return { store, service, request, seed };
}
test('local intake avoids pronouns, negated geography and reversed ranges', () => {
  assert.equal(localIntake('Tell us about buyers, not US, not OEMs.').suggestions.length, 0);
  assert.equal(localIntake('Target Canada, not US.').suggestions.find(s => s.field === 'regions').value, 'Canada');
  const value = localIntake('Target US equipment OEMs with 100–1,000 employees. NAICS: 333120. Exclude domains: example.test, another.test');
  assert.equal(value.suggestions.find(s => s.field === 'headcount').value, '100–1,000 employees');
  assert.equal(value.suggestions.find(s => s.field === 'naics').value, 'NAICS: 333120');
  assert.equal(value.suggestions.find(s => s.field === 'excludedDomains').value, 'example.test, another.test');
  assert.equal(localIntake('Target 900 to 100 employees').suggestions.some(s => s.field === 'headcount'), false);
});
test('local proposals persist without applying fields; review accepts, adjusts, dismisses and revokes approvals', async t => {
  const { service, store, request, seed } = await setup(t); seed();
  const draftId = service.draft('allco', 'elliott'); service.approveDraft('allco', draftId, true, 1);
  const req = request('Target US OEMs with 100–500 employees.');
  const result = await service.inferProfile('allco', req); const runId = result.activeAssistantRunId;
  assert.equal(store.read('allco').icp.headcount, ''); assert.equal(store.read('allco').approved, true);
  const repeated = await service.inferProfile('allco', req); assert.equal(repeated.activeAssistantRunId, runId); assert.equal(store.read('allco').assistantRuns.length, 1);
  assert.equal(store.read('allco').wallet.credits, 100);
  const decisions = result.assistantRuns[0].result.suggestions.map(s => ({ field: s.field, decision: s.field === 'headcount' ? 'adjusted' : s.field === 'motion' ? 'dismissed' : 'accepted', ...(s.field === 'headcount' ? { value: '200–600 employees' } : {}) }));
  const reviewed = service.reviewIntake('allco', runId, { decisions, acknowledged: true, revision: store.read('allco').revision });
  assert.equal(reviewed.icp.headcount, '200–600 employees'); assert.equal(reviewed.approved, false);
  assert.equal(reviewed.drafts[0].approvedHash, null); assert.equal(reviewed.drafts[0].status, 'draft');
  assert.equal(profileConfidence(reviewed).find(f => f.field === 'headcount').runId, runId);
  assert.throws(() => service.reviewIntake('allco', runId, { decisions, acknowledged: true, revision: reviewed.revision }), { code: 'proposal_already_reviewed' });
  assert.throws(() => service.reviewIntake('huasheng', runId, { decisions, acknowledged: true, revision: store.read('huasheng').revision }), { code: 'proposal_not_found' });
});
test('partial, unauthorized or stale reviews cannot mutate the profile', async t => {
  const { service, store, request } = await setup(t);
  const result = await service.inferProfile('allco', request('Target US OEMs.'));
  const runId = result.activeAssistantRunId;
  assert.throws(() => service.reviewIntake('allco', runId, { decisions: [], acknowledged: false, revision: store.read('allco').revision }), { code: 'review_required' });
  assert.throws(() => service.reviewIntake('allco', runId, { decisions: [], acknowledged: true, revision: store.read('allco').revision }), { code: 'incomplete_proposal_review' });
  service.saveProfile('allco', { icp: { ...store.read('allco').icp, regions: 'Canada' } }, store.read('allco').revision);
  assert.throws(() => service.reviewIntake('allco', runId, { decisions: [], acknowledged: true, revision: store.read('allco').revision }), { code: 'stale_assistant_context' });
  assert.equal(store.read('allco').icp.regions, 'Canada');
});
test('global or dummy keys never configure AI and unconfigured calls do not charge', async t => {
  for (const env of [{ OPENAI_API_KEY: 'simulated-global-key', PROJECT_AI_ENABLED: 'true', PROJECT_OPENAI_MODEL: 'fixture-model' }, { ...fixtureEnv, PROJECT_OPENAI_API_KEY: 'dummy-not-connected' }, { ...fixtureEnv, PROJECT_AI_ENABLED: 'false' }]) assert.equal(createModelProvider({ env }).status().configured, false);
  const { service, store, request } = await setup(t);
  await assert.rejects(service.inferProfile('allco', request('Target US', 'model')), { code: 'model_not_configured' });
  assert.equal(store.read('allco').wallet.credits, 100); assert.equal(store.read('allco').assistantRuns.length, 0);
});
test('real SDK contract uses strict structured output, store:false, project key and explicit processing acknowledgement', async t => {
  const captures = [];
  const model = createModelProvider({ env: fixtureEnv, fetcher: async (url, init) => { captures.push({ url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) }); return response(proposal); } });
  const { service, store, request } = await setup(t, model); const req = request('Target US equipment OEMs.', 'model');
  await assert.rejects(service.inferProfile('allco', { ...req, acknowledgedExternalProcessing: false }), { code: 'external_processing_review_required' }); assert.equal(captures.length, 0);
  const result = await service.inferProfile('allco', req); await service.inferProfile('allco', req);
  assert.equal(captures.length, 1); assert.equal(captures[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(captures[0].headers.get('authorization'), 'Bearer test-project-key-fixtures-only');
  assert.equal(captures[0].body.store, false); assert.equal(captures[0].body.text.format.type, 'json_schema'); assert.equal(captures[0].body.text.format.strict, true);
  assert.equal(captures[0].body.input[0].content.includes('Huasheng'), false);
  assert.equal(result.wallet.credits, 98); assert.equal(result.assistantRuns[0].metadata.usage.totalTokens, 165); assert.ok(result.assistant.verifiedAt);
  assert.equal(result.wallet.ledger[0].status, 'consumed'); assert.equal(result.wallet.ledger.length, 1);
  assert.equal(JSON.stringify(result).includes('test-project-key'), false);
});
test('quota and stale revision checks run before model transmission', async t => {
  let calls = 0; const model = createModelProvider({ env: fixtureEnv, fetcher: async () => { calls++; return response(proposal); } });
  const { service, store, request } = await setup(t, model);
  const stale = request('Target US', 'model'); store.mutate('allco', s => { s.wallet.credits = 0; });
  await assert.rejects(service.inferProfile('allco', stale), { code: 'revision_conflict' });
  await assert.rejects(service.inferProfile('allco', request('Target US', 'model')), { code: 'insufficient_credits' }); assert.equal(calls, 0);
});
test('refusals refund local credits once and preserve confirmed provider usage', async t => {
  let calls = 0;
  const model = createModelProvider({ env: fixtureEnv, fetcher: async () => { calls++; return response(null, { output: [{ id: 'msg_refusal', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'refusal', refusal: 'Fixture refusal' }] }] }); } });
  const { service, store, request } = await setup(t, model); const req = request('Target US', 'model');
  await assert.rejects(service.inferProfile('allco', req), { code: 'model_incomplete' });
  await assert.rejects(service.inferProfile('allco', req), { code: 'request_already_failed' });
  assert.equal(calls, 1); assert.equal(store.read('allco').wallet.credits, 100);
  assert.equal(store.read('allco').wallet.ledger[0].providerUsage.totalTokens, 165); assert.equal(store.read('allco').wallet.ledger[0].status, 'refunded');
});
test('profile changes during a model call discard results and retain usage evidence', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const model = createModelProvider({ env: fixtureEnv, fetcher: async () => { await gate; return response(proposal); } });
  const { service, store, request } = await setup(t, model);
  const pending = service.inferProfile('allco', request('Target US', 'model'));
  service.saveProfile('allco', { icp: { ...store.read('allco').icp, regions: 'Canada' } }, store.read('allco').revision);
  release(); await assert.rejects(pending, { code: 'stale_assistant_context' });
  assert.equal(store.read('allco').icp.regions, 'Canada'); assert.equal(store.read('allco').wallet.credits, 100);
  assert.equal(store.read('allco').wallet.ledger[0].providerUsage.totalTokens, 165);
});
test('fabricated source, evidence, contact and numeric target claims are rejected', () => {
  assert.throws(() => validateSuggestions({ ...proposal, suggestions: [{ ...proposal.suggestions[0], evidence: 'a fabricated quote' }] }, 'US OEMs', []), { code: 'ungrounded_model_output' });
  assert.throws(() => validateSuggestions({ ...proposal, suggestions: [{ field: 'revenue', value: '$10m', confidence: 1, basis: 'catalog_hypothesis', evidence: 'https://supplier.test/' }] }, '', ['https://supplier.test/']), { code: 'ungrounded_model_output' });
  const hypothetical = validateSuggestions({ ...proposal, suggestions: [{ field: 'industries', value: 'Mobile equipment', confidence: 0.99, basis: 'catalog_hypothesis', evidence: 'https://supplier.test/' }] }, '', ['https://supplier.test/']);
  assert.equal(hypothetical.suggestions[0].confidence, 0.5);
  const draft = { subject: 'Introduction', body: 'Contact invented@buyer.test', claims: [{ text: 'Claim', sourceUrl: 'https://buyer.test/' }], qualificationQuestions: ['What is your qualification process?'] };
  assert.throws(() => validateDraft(draft, ['https://buyer.test/']), { code: 'ungrounded_model_output' });
});
test('AI drafts retain source claims and usage but can never send without exact-message approval', async t => {
  const leadSource = researchCatalog[0].source; const supplierSource = 'https://www.allcohydraulic.com/';
  const value = { subject: 'Supplier qualification introduction', body: `Hello sourcing team, your equipment portfolio appears relevant: ${leadSource}\nOur supplier catalog: ${supplierSource}\nCould you share your qualification process? Compatibility, price and delivery require review.`, claims: [{ text: 'Public equipment portfolio', sourceUrl: leadSource }, { text: 'Supplier catalog', sourceUrl: supplierSource }], qualificationQuestions: ['What is your supplier qualification process?'] };
  let calls = 0;
  const model = createModelProvider({ env: fixtureEnv, fetcher: async () => { calls++; return response(value); } });
  const { service, store, seed } = await setup(t, model); seed();
  const options = { requestId: randomUUID(), revision: store.read('allco').revision, acknowledgedExternalProcessing: true, channel: 'email', variant: 'A', sequenceStep: 0 };
  const result = await service.draftWithModel('allco', 'elliott', options);
  const repeated = await service.draftWithModel('allco', 'elliott', options); assert.equal(repeated.activeDraftId, result.activeDraftId); assert.equal(calls, 1);
  const draft = result.drafts.find(d => d.id === result.activeDraftId);
  assert.equal(draft.status, 'draft'); assert.equal(draft.approvedHash, null); assert.equal(draft.recipient, 'test@example.test');
  assert.equal(draft.modelMetadata.usage.totalTokens, 165); assert.equal(result.wallet.credits, 98);
  await assert.rejects(service.simulateSend('allco', draft.id), { code: 'approval_required' });
  assert.notEqual(service.draft('allco', 'elliott'), draft.id);
});
