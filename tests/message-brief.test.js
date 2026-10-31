import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createService } from '../server/service.js';
import { createApp } from '../server/app.js';
import { createModelProvider } from '../server/model.js';
import { messageHash } from '../server/email-delivery.js';
import { researchCatalog } from '../server/catalog.js';
import { scoreAccount } from '../server/evidence.js';
import { audiences, tones, callsToAction, valuePropositions, defaultMessageBrief, bodyWordCount, assessMessageBrief } from '../src/message-brief.js';
import { checkedMessageBrief, messageBriefSchema } from '../server/message-brief.js';
const graph = { sync: async () => {}, snapshot: async () => ({}), paths: async () => [] };
const brief = overrides => ({ ...defaultMessageBrief, ...overrides });
async function setup(t, model) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtm-message-brief-')), store = createStore(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const service = createService({ store, graph, ...(model ? { model } : {}) });
  for (const id of ['allco', 'huasheng']) {
    store.mutate(id,state=>{ state.icp.regions='United States'; state.icp.segments=['Equipment manufacturers (OEMs)']; state.icp.motion='oem'; });
    service.approveProfile(id, true, store.read(id).revision);
    store.mutate(id, state => { state.leads = [{ ...researchCatalog[0], name: 'Synthetic Buyer', productFamily: state.productFamilies[0], fit: scoreAccount(researchCatalog[0], state), selected: true, stage: 'Matched', contact: { email: 'buyer@fixture.test', linkedIn: 'https://www.linkedin.com/in/fixture-person/' }, events: [] }]; });
  }
  return { store, service, draft: (id = 'allco', channel = 'email', variant = 'A', step = 0, input = brief()) => service.draft(id, 'elliott', channel, variant, step, input) };
}
test('body word counting excludes URLs and citation numbers without hiding Unicode or hyphenated words', () => {
  assert.equal(bodyWordCount('Supplier’s 15-minute review [1] https://fixture.test/a-long-path?q=1\n[2] https://supplier.test/ 研发'), 4);
  const cta = callsToAction.right_contact.text;
  assert.equal(assessMessageBrief({ messageBrief: brief({ cta: 'right_contact' }), body: cta, subject: 'Fit' }).valid, true);
  assert.equal(assessMessageBrief({ messageBrief: brief({ cta: 'right_contact' }), body: cta + cta, subject: 'Fit' }).valid, false);
});
test('objective copy checks reject oversized bodies/subjects and missing or repeated CTA without treating tone as verified', () => {
  const d={messageBrief:brief({maxWords:80}),subject:'Fit',body:'review '.repeat(81)+callsToAction.technical_review.text};
  assert.match(assessMessageBrief(d).issues[0],/selected limit is 80/);
  assert.match(assessMessageBrief({...d,body:callsToAction.technical_review.text,subject:'s'.repeat(121)}).issues[0],/120 characters/);
  assert.equal(assessMessageBrief({...d,body:'No question'}).valid,false);
  for(const tone of Object.keys(tones))assert.equal(assessMessageBrief({...d,body:callsToAction.technical_review.text,messageBrief:brief({tone})}).valid,true);
});
test('brief templates retain accepted event categories/dates/sources without changing quotes or claiming a buying cycle', async t => {
  const {store,draft}=await setup(t),eventDate=new Date(Date.now()-86400000).toISOString().slice(0,10),quote='Long exact public source passage '.repeat(100);
  store.mutate('allco',state=>{state.leads[0].marketSignals=[{id:randomUUID(),kind:'job_requisition',status:'accepted',eventDate,checkedAt:new Date().toISOString(),acceptedAt:new Date().toISOString(),quote,source:'https://fixture.test/jobs'}];});
  const id=draft(),d=store.read('allco').drafts.find(x=>x.id===id);
  assert.match(d.body,/published job requisition/);assert.ok(d.body.includes(eventDate));assert.ok(d.body.includes('https://fixture.test/jobs'));assert.match(d.body,/sourcing demand is unconfirmed/);
  assert.equal(d.linkedSignalIds.length,1);assert.equal(store.read('allco').leads[0].marketSignals[0].quote,quote);assert.equal(assessMessageBrief(d).valid,true);
});
test('source templates vary by audience and tone across businesses, channels, variants and sequence steps', async t => {
  const { store, draft } = await setup(t); const observed = new Set();
  for (const id of ['allco', 'huasheng']) for (const channel of ['email','linkedin']) for (const variant of ['A','B']) for (const step of [0,1,2]) {
    for (const audience of Object.keys(audiences)) for (const tone of Object.keys(tones)) {
      const key = draft(id, channel, variant, step, brief({ audience, tone, maxWords: 180 })), d = store.read(id).drafts.find(x => x.id === key);
      assert.equal(assessMessageBrief(d).valid, true); assert.ok(d.body.includes(audiences[audience].focus));
      assert.ok(d.body.includes(researchCatalog[0].source)); assert.ok(d.body.includes(store.read(id).company.website));
      assert.ok(d.body.includes('subject to technical review')); assert.equal(d.status, 'draft');
      assert.doesNotMatch(d.body, /following up on our|previous conversation|as discussed/i);
      observed.add(d.body);
    }
  }
  assert.ok(observed.size >= 120); assert.equal(store.read('allco').wallet.credits, 100);
});
test('every CTA is preserved exactly once and selecting another brief revokes the same variant approval', async t => {
  const { store, service, draft } = await setup(t); let previous;
  for (const cta of Object.keys(callsToAction)) {
    const id = draft('allco','email','A',0,brief({ cta })), d = store.read('allco').drafts.find(x => x.id === id);
    if (previous) { assert.equal(id,previous); assert.equal(d.status,'draft'); assert.equal(d.approvedHash,null); }
    assert.equal(d.body.split(callsToAction[cta].text).length-1,1);
    service.approveDraft('allco',id,true,d.version); previous=id;
  }
  const d=store.read('allco').drafts[0], version=d.version;
  assert.equal(draft('allco','email','A',0,d.messageBrief),d.id); assert.equal(store.read('allco').drafts[0].version,version);
});
test('invalid, excessive and inherited brief values cannot mutate draft state or charge credits', async t => {
  const { store, draft } = await setup(t); const revision=store.read('allco').revision;
  for (const value of [null,{},brief({ audience:'__proto__' }),brief({ tone:'toString' }),brief({ maxWords:999999 }),{ ...brief(), approved:true }]) assert.throws(()=>draft('allco','email','A',0,value),{code:'invalid_message_brief'});
  assert.equal(store.read('allco').revision,revision); assert.equal(store.read('allco').drafts.length,0); assert.equal(store.read('allco').wallet.credits,100);
});
test('over-limit source context fails visibly without truncating evidence, erasing an approved draft or charging', async t => {
  const { store, service, draft } = await setup(t); const id=draft(); let d=store.read('allco').drafts[0]; service.approveDraft('allco',id,true,d.version);
  store.mutate('allco',state=>{state.leads[0].application='industrial application '.repeat(100);});
  const before=store.read('allco');assert.throws(()=>draft('allco','email','A',0,brief({maxWords:80})),{code:'message_brief_not_met'});
  assert.deepEqual(store.read('allco').drafts,before.drafts);assert.equal(store.read('allco').wallet.credits,100);
});
test('brief edits and copy edits revoke approval; objective constraints gate approval and dry-run settlement', async t => {
  const { store, service, draft } = await setup(t); const id=draft();let d=store.read('allco').drafts[0];service.approveDraft('allco',id,true,d.version);
  service.editDraft('allco',id,{messageBrief:brief({maxWords:80,cta:'right_contact'})},d.version);d=store.read('allco').drafts[0];
  assert.equal(d.version,2);assert.equal(d.approvedHash,null);assert.equal(d.approvedDeliveryMode,null);
  assert.throws(()=>service.approveDraft('allco',id,true,d.version),{code:'message_brief_not_met'});
  const body=`Review of your application remains subject to technical review. ${callsToAction.right_contact.text} [1] ${researchCatalog[0].source}`;
  service.editDraft('allco',id,{body},d.version);d=store.read('allco').drafts[0];service.approveDraft('allco',id,true,d.version);
  await service.simulateSend('allco',id);assert.equal(store.read('allco').wallet.credits,99);
  assert.throws(()=>service.editDraft('allco',id,{messageBrief:brief()},store.read('allco').drafts[0].version),{code:'draft_locked'});
});
test('each brief field changes dry/live message hashes while legacy approval hashes remain compatible', () => {
  const base={body:'Body',subject:'Subject',recipient:'buyer@fixture.test',version:1,profileHash:'profile',businessId:'allco',channel:'email',sequenceStep:0};
  assert.equal(messageHash(base),messageHash({...base,messageBrief:undefined}));
  for(const mode of ['dry_run','live']){const d={...base,messageBrief:brief(),approvedDeliveryMode:mode,approvedSenderHash:'sender',approvedLiveMessage:{body:'Body + footer'}};
    for(const patch of [{audience:'engineering'},{tone:'technical'},{maxWords:120},{cta:'right_contact'},{valueProposition:'supplier_qualification'}])assert.notEqual(messageHash(d),messageHash({...d,messageBrief:brief(patch)}));}
});
test('existing templates, approvals and dispatched receipts stay compatible without inventing a saved brief', async t => {
  const { store, service }=await setup(t); const id=service.draft('allco','elliott');const d=store.read('allco').drafts[0];assert.equal(d.messageBrief,undefined);assert.equal(assessMessageBrief(d).legacy,true);
  service.approveDraft('allco',id,true,d.version);await service.simulateSend('allco',id);
  assert.equal(service.draft('allco','elliott','email','A',0,brief()),id);assert.equal(store.read('allco').drafts[0].messageBrief,undefined);assert.equal(store.read('allco').wallet.credits,99);
});
test('model requests retain the reviewed brief and reject noncompliant output with one local refund', async t => {
  let context;const model={status:()=>({configured:true}),requireConfigured:()=>{},draft:async input=>{context=input.context;return{value:{subject:'Fit',body:'Missing requested question',claims:[{text:'Fit',sourceUrl:researchCatalog[0].source}],qualificationQuestions:['Requirements?']},metadata:{usage:{inputTokens:12,outputTokens:8,totalTokens:20},model:'fixture'}};}};
  const {store,service}=await setup(t,model);const input={channel:'email',variant:'A',sequenceStep:0,messageBrief:brief({audience:'procurement',tone:'direct',maxWords:120,cta:'supplier_process'}),requestId:randomUUID(),acknowledgedExternalProcessing:true,revision:store.read('allco').revision};
  await assert.rejects(service.draftWithModel('allco','elliott',input),{code:'message_brief_not_met'});
  assert.equal(context.messageBrief.audience,'Procurement / sourcing');assert.equal(context.messageBrief.callToAction,callsToAction.supplier_process.text);assert.equal(context.messageBrief.maxWords,120);
  assert.equal(store.read('allco').drafts.length,0);assert.equal(store.read('allco').wallet.credits,100);assert.equal(store.read('allco').assistantRuns[0].providerUsage.totalTokens,20);
});
test('real model SDK fixture honors brief context and completed-request replay rejects a different brief', async t => {
  let requests=0,wire;const env={PROJECT_AI_ENABLED:'true',PROJECT_OPENAI_API_KEY:'fixture-project-key-never-live',PROJECT_OPENAI_MODEL:'fixture-model'};
  const model=createModelProvider({env,fetcher:async(url,options)=>{requests++;wire=JSON.parse(options.body);const value={subject:'Supplier fit',body:`${callsToAction.right_contact.text} [1] ${researchCatalog[0].source} [2] https://www.allcohydraulic.com/`,claims:[{text:'Company source',sourceUrl:researchCatalog[0].source},{text:'Supplier source',sourceUrl:'https://www.allcohydraulic.com/'}],qualificationQuestions:['Which requirements apply?']};return new Response(JSON.stringify({id:'resp_fixture',object:'response',created_at:1,model:'fixture-model',status:'completed',output:[{id:'msg_fixture',type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value),annotations:[]}]}],usage:{input_tokens:20,output_tokens:10,total_tokens:30}}),{headers:{'content-type':'application/json'}});}});
  const {store,service}=await setup(t,model), input={channel:'email',variant:'A',sequenceStep:0,messageBrief:brief({cta:'right_contact'}),requestId:randomUUID(),acknowledgedExternalProcessing:true,revision:store.read('allco').revision};
  const result=await service.draftWithModel('allco','elliott',input);assert.equal(result.drafts[0].messageBrief.cta,'right_contact');assert.equal(assessMessageBrief(result.drafts[0]).valid,true);assert.equal(requests,1);
  assert.equal(JSON.parse(wire.input[0].content).context.messageBrief.callToAction,callsToAction.right_contact.text);assert.match(wire.instructions,/callToAction exactly once/);
  assert.equal(JSON.parse(wire.input[0].content).context.messageBrief.valueProposition,'application_fit');assert.equal(JSON.parse(wire.input[0].content).context.messageBrief.valuePropositionFocus,valuePropositions.application_fit.focus);assert.match(wire.instructions,/messaging hypothesis/);
  await service.draftWithModel('allco','elliott',input);assert.equal(requests,1);assert.equal(store.read('allco').wallet.credits,98);
  await assert.rejects(service.draftWithModel('allco','elliott',{...input,messageBrief:brief({cta:'fit_call'})}),{code:'request_id_conflict'});assert.equal(requests,1);
  await assert.rejects(service.draftWithModel('allco','elliott',{...input,messageBrief:brief({valueProposition:'supplier_qualification'})}),{code:'request_id_conflict'});assert.equal(requests,1);
});
test('authenticated HTTP creates/edits strict briefs, rejects injected fields and preserves business scope', async t => {
  const {store,service}=await setup(t),server=createApp({store,service}).listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await new Promise(resolve=>server.once('listening',resolve));
  const root='http://127.0.0.1:'+server.address().port,session=await fetch(root+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),cookie=session.headers.get('set-cookie').split(';')[0],{csrf}=await session.json();
  const request=(url,body,method='POST')=>fetch(root+'/api/businesses/'+url,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'x-csrf-token':csrf},body:JSON.stringify(body)});
  assert.equal((await request('allco/leads/elliott/drafts',{channel:'email',variant:'A',sequenceStep:0,messageBrief:{...brief(),approved:true}})).status,400);
  const result=await request('allco/leads/elliott/drafts',{channel:'email',variant:'A',sequenceStep:0,messageBrief:brief()});assert.equal(result.status,200);const state=await result.json(),d=state.drafts[0];
  assert.equal(d.messageBrief.valueProposition,'application_fit');
  assert.equal((await request('allco/drafts/'+d.id,{version:d.version,messageBrief:brief({valueProposition:'guaranteed_savings'})},'PATCH')).status,400);
  assert.equal((await request('huasheng/drafts/'+d.id,{recipient:d.recipient,subject:d.subject,body:d.body,version:d.version,messageBrief:brief()},'PATCH')).status,404);
  assert.equal((await request('allco/drafts/'+d.id,{recipient:d.recipient,subject:d.subject,body:d.body,version:d.version,messageBrief:brief({audience:'engineering',valueProposition:'supplier_qualification'})},'PATCH')).status,200);
  assert.equal(store.read('allco').drafts[0].messageBrief.audience,'engineering');assert.equal(store.read('allco').drafts[0].messageBrief.valueProposition,'supplier_qualification');assert.equal(store.read('huasheng').drafts.length,0);
});

test('all value proposition hypotheses shape qualified source copy across both businesses, channels and variants',async t=>{
  const {store,draft}=await setup(t);
  for(const business of ['allco','huasheng'])for(const channel of ['email','linkedin'])for(const variant of ['A','B'])for(const step of [0,1,2])for(const [valueProposition,option] of Object.entries(valuePropositions)){
    const id=draft(business,channel,variant,step,brief({valueProposition})),d=store.read(business).drafts.find(x=>x.id===id);
    assert.equal(d.messageBrief.valueProposition,valueProposition);assert.ok(d.body.includes(option.focus));assert.equal(assessMessageBrief(d).valid,true);assert.equal(d.status,'draft');assert.equal(d.approvedHash,null);assert.match(d.body,/subject to technical review/);assert.ok(d.sources.includes(researchCatalog[0].source));
  }
  assert.equal(store.read('allco').wallet.credits,100);
});
test('four-field saved briefs and hashes stay exact without retroactively inventing a value proposition',async t=>{
  const {store,service,draft}=await setup(t);const {valueProposition,...old}=brief();
  assert.deepEqual(checkedMessageBrief(old),old);assert.deepEqual(messageBriefSchema.parse(old),old);
  const id=draft('allco','email','A',0,old);let d=store.read('allco').drafts[0];assert.deepEqual(d.messageBrief,old);
  service.approveDraft('allco',id,true,d.version);const approved=store.read('allco').drafts[0];const hash=approved.approvedHash;
  assert.equal(draft('allco','email','A',0,old),id);assert.equal(store.read('allco').drafts[0].approvedHash,hash);
  await service.simulateSend('allco',id);assert.deepEqual(store.read('allco').drafts[0].messageBrief,old);assert.equal(store.read('allco').drafts[0].approvedHash,hash);
});
test('unknown, injected and undefined value propositions cannot mutate or spend, while absent legacy focus remains supported',async t=>{
  const {store,draft}=await setup(t),before=store.read('allco');
  for(const valueProposition of ['cost_savings','__proto__','toString','',null,undefined,{}])assert.throws(()=>draft('allco','email','A',0,brief({valueProposition})),{code:'invalid_message_brief'});
  assert.deepEqual(store.read('allco'),before);
});
test('changing value proposition alone revokes exact approval, and settled receipts cannot be retagged',async t=>{
  const {store,service,draft}=await setup(t),id=draft();let d=store.read('allco').drafts[0];service.approveDraft('allco',id,true,d.version);const oldHash=store.read('allco').drafts[0].approvedHash;
  service.editDraft('allco',id,{messageBrief:brief({valueProposition:'engineering_collaboration'})},d.version);d=store.read('allco').drafts[0];assert.equal(d.version,2);assert.equal(d.status,'draft');assert.equal(d.approvedHash,null);assert.equal(d.approvedDeliveryMode,null);
  service.approveDraft('allco',id,true,d.version);assert.notEqual(store.read('allco').drafts[0].approvedHash,oldHash);await service.simulateSend('allco',id);
  const receipt=store.read('allco').drafts[0];assert.throws(()=>service.editDraft('allco',id,{messageBrief:brief()},receipt.version),{code:'draft_locked'});assert.deepEqual(store.read('allco').drafts[0],receipt);
});
