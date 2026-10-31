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
import { reviewCandidate } from '../server/evidence.js';

const root='https://example-equipment.test/'; const contact=root+'contact';
const org='Example Equipment manufactures heavy equipment.';
const application='Our excavators feature a hydraulic boom and bucket system.';
const geography='Example Equipment, Columbus, OH 43215, United States.';
const source=async url=>({url,finalUrl:url,site:'example-equipment.test',title:'Example Equipment',text:url===contact?geography:`${org} ${application}`,emails:url===contact?['sales@example-equipment.test']:[],checkedAt:new Date().toISOString(),fetchStatus:'reachable',contentHash:'fixture',preview:'Synthetic source fixture'});
const memoryGraph=()=>({sync:async()=>{},snapshot:async id=>({businessId:id,nodes:[],edges:[]}),paths:async()=>[]});
async function setup(t,options={}) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'gtm-website-')); const store=createStore(directory);
  t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  const graph=options.graph||memoryGraph();
  const service=createService({store,graph,readWebsiteSource:options.source||source,review:async(candidate,state)=>reviewCandidate(candidate,state,{fetcher:async()=>{throw Error('No fixture network');}}),...options.service});
  service.approveProfile('allco',true,store.read('allco').revision);
  const start=(overrides={})=>service.startWebsiteIntake('allco',{requestId:randomUUID(),revision:store.read('allco').revision,urls:[root,contact],...overrides});
  const payload=(overrides={})=>({revision:store.read('allco').revision,acknowledged:true,name:'Example Equipment',industry:'Construction equipment',location:'Columbus, Ohio',country:'United States',buyerType:'OEM',productFamily:'excavator',application:'Hydraulic excavator assemblies',reason:'Hypothesis: excavator systems may require cylinders; specifications and supplier access need review.',publicEmail:'sales@example-equipment.test',quotes:{organization:{url:root,text:org},application:{url:root,text:application},geography:{url:contact,text:geography}},...overrides});
  const admit=async()=>{const intake=start();await intake.completion;return service.reviewWebsiteIntake('allco',intake.id,payload());};
  return {directory,store,service,graph,start,payload,admit};
}

test('website retrieval reserves before network, deduplicates requests, rejects conflicts, and isolates businesses',async t=>{
  let calls=0,release;const gate=new Promise(resolve=>{release=resolve;});
  const {store,service,start}=await setup(t,{source:async url=>{calls++;await gate;return source(url);}});
  store.mutate('allco',state=>{state.wallet.credits=0;});assert.throws(()=>start(),{code:'insufficient_credits'});assert.equal(calls,0);
  store.mutate('allco',state=>{state.wallet.credits=100;});
  const requestId=randomUUID();const running=start({requestId});assert.equal(calls,2);assert.equal(store.read('allco').wallet.credits,98);
  assert.equal(start({requestId,revision:0}).id,running.id);assert.equal(calls,2);
  assert.throws(()=>start({requestId,urls:[root]}),{code:'intake_request_conflict'});
  assert.throws(()=>start(),{code:'job_running'});
  release();await running.completion;
  assert.equal(store.read('allco').leads.length,0);assert.equal(store.read('allco').sourceIntakes[0].status,'ready');assert.equal(store.read('allco').wallet.ledger[0].status,'consumed');
  assert.equal(store.read('huasheng').wallet.credits,100);assert.equal(store.read('huasheng').sourceIntakes.length,0);
  assert.equal(start({requestId}).id,running.id);assert.equal(calls,2);
});

test('failed and stale website work refunds once, never adds accounts, and never silently retries',async t=>{
  const {store,service,start}=await setup(t,{source:async()=>{throw Error('Fixture blocked');}});
  const failed=start();await failed.completion;assert.equal(store.read('allco').wallet.credits,100);assert.equal(store.read('allco').sourceIntakes[0].status,'failed');
  start({requestId:failed.id});assert.equal(store.read('allco').wallet.ledger.length,1);
  store.settle('allco',store.read('allco').wallet.ledger[0].id,false);assert.equal(store.read('allco').wallet.credits,100);
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const staleService=createService({store,graph:memoryGraph(),readWebsiteSource:async url=>{await gate;return source(url);}});
  const stale=staleService.startWebsiteIntake('allco',{requestId:randomUUID(),revision:store.read('allco').revision,urls:[root]});
  service.saveProfile('allco',{icp:{...store.read('allco').icp,regions:'Canada'}},store.read('allco').revision);release();await stale.completion;
  assert.equal(store.read('allco').sourceIntakes[0].errorCode,'stale_research');assert.equal(store.read('allco').wallet.credits,100);assert.equal(store.read('allco').leads.length,0);
});

test('admission requires quoted evidence, current scope, published contact, and owner review',async t=>{
  const {store,service,start,payload}=await setup(t);const intake=start();await intake.completion;
  const rejects=[
    [payload({acknowledged:false}),'source_review_required'],
    [payload({revision:0}),'revision_conflict'],
    [payload({name:'Fabricated Account'}),'company_evidence_required'],
    [payload({publicEmail:'ceo@example-equipment.test'}),'unpublished_contact'],
    [payload({productFamily:'cone'}),'invalid_profile_scope'],
    [payload({country:'Canada'}),'account_excluded'],
    [payload({buyerType:'Other'}),'oem_evidence_required'],
    [payload({quotes:{...payload().quotes,application:{url:root,text:'We are buying cylinders immediately.'}}}),'ungrounded_source_quote'],
    [payload({quotes:{...payload().quotes,geography:{url:root,text:org}}}),'country_evidence_required'],
    [payload({quotes:{...payload().quotes,organization:{url:root,text:application}}}),'oem_evidence_required'],
    [payload({quotes:{...payload().quotes,application:{url:'https://other.test/',text:application}}}),'ungrounded_source_quote'],
  ];
  for(const [input,code] of rejects)await assert.rejects(service.reviewWebsiteIntake('allco',intake.id,input),{code});
  await assert.rejects(service.reviewWebsiteIntake('huasheng',intake.id,payload()),{code:'intake_not_found'});
  assert.equal(store.read('allco').leads.length,0);
  const result=await service.reviewWebsiteIntake('allco',intake.id,payload());const lead=result.leads[0];
  assert.equal(lead.selected,false);assert.equal(lead.stage,'Matched');assert.equal(lead.people.length,0);assert.equal(lead.fit.companySize,'Unknown');assert.equal(lead.fit.intent,'Unconfirmed');assert.equal(lead.contact.mailboxStatus,'unverified');assert.equal(lead.contact.mxStatus,'not_checked');assert.equal(lead.sourceEvidenceState,'quote_present');assert.equal(lead.evidenceQuotes.geography.text,geography);
  assert.equal(result.customCandidates.length,1);assert.equal(result.wallet.ledger[0].leadId,lead.id);assert.equal(result.sourceIntakes[0].graphStatus,'synced');assert.equal(result.wallet.credits,98);
});

test('approved profile, excluded domains, campaign products, pending limits, and source expiry guard intake',async t=>{
  const {store,service,start,payload}=await setup(t);
  assert.throws(()=>start({revision:0}),{code:'revision_conflict'});
  assert.throws(()=>start({urls:[root,'https://other.test/']}),{code:'source_site_mismatch'});
  const intake=start();await intake.completion;
  store.mutate('allco',state=>{state.sourceIntakes[0].pages[0].checkedAt='2020-01-01T00:00:00.000Z';});
  await assert.rejects(service.reviewWebsiteIntake('allco',intake.id,payload()),{code:'source_snapshot_expired'});
  const next=start();await next.completion;
  service.saveProfile('allco',{icp:{...store.read('allco').icp,excludedDomains:'example-equipment.test'}},store.read('allco').revision);
  assert.throws(()=>start(),{code:'profile_approval_required'});
  service.approveProfile('allco',true,store.read('allco').revision);
  await assert.rejects(service.reviewWebsiteIntake('allco',next.id,payload()),{code:'stale_research'});
  const excluded=start();await excluded.completion;await assert.rejects(service.reviewWebsiteIntake('allco',excluded.id,payload()),{code:'account_excluded'});
  service.saveProfile('allco',{icp:{...store.read('allco').icp,excludedDomains:''},productFamilies:['truck']},store.read('allco').revision);service.approveProfile('allco',true,store.read('allco').revision);
  const product=start();await product.completion;await assert.rejects(service.reviewWebsiteIntake('allco',product.id,payload()),{code:'account_excluded'});
  store.mutate('allco',state=>{state.sourceIntakes=Array.from({length:10},()=>({status:'ready'}));});assert.throws(()=>start(),{code:'intake_limit'});
  store.mutate('allco',state=>{state.sourceIntakes=[];state.leads=[researchCatalog[0]];});assert.throws(()=>start({urls:[researchCatalog[0].source]}),{code:'account_exists'});
});

test('durable admissions replay without duplicate charges and repair a failed graph projection',async t=>{
  const graph=memoryGraph();let fail=true;graph.sync=async()=>{if(fail)throw Error('Fixture graph unavailable');};
  const {store,service,start,payload}=await setup(t,{graph});const intake=start();await intake.completion;const request=payload();
  const saved=await service.reviewWebsiteIntake('allco',intake.id,request);assert.equal(saved.sourceIntakes[0].graphStatus,'pending');assert.equal(saved.leads.length,1);
  fail=false;const replay=await service.reviewWebsiteIntake('allco',intake.id,request);assert.equal(replay.sourceIntakes[0].graphStatus,'synced');assert.equal(replay.leads[0].id,saved.leads[0].id);assert.equal(replay.customCandidates.length,1);assert.equal(replay.wallet.credits,98);
  await assert.rejects(service.reviewWebsiteIntake('allco',intake.id,{...request,reason:'Different accepted review'}),{code:'intake_already_reviewed'});
  fail=true;const second=start();await second.completion;await service.reviewWebsiteIntake('allco',second.id,payload());fail=false;await service.graphView('allco');assert.ok(store.read('allco').sourceIntakes.every(item=>item.graphStatus==='synced'));
});

test('custom research refresh detects missing quotes and contacts, blocks stale qualification, and preserves history',async t=>{
  let changed=false;
  const {store,service,start,payload,admit}=await setup(t,{source:async url=>{const page=await source(url);return changed?{...page,text:'Example Equipment now publishes a different portfolio with no retained application evidence.',emails:[]}:page;}});
  const result=await admit();const id=result.leads[0].id;service.selectLead('allco',id,true);
  const sent=service.draft('allco',id,'email','A',0);service.approveDraft('allco',sent,true,1);await service.simulateSend('allco',sent);
  const pending=service.draft('allco',id,'email','A',1);service.approveDraft('allco',pending,true,1);
  const history=store.read('allco').leads[0].events;changed=true;
  const refresh=service.startDiscovery('allco');await refresh.completion;
  let state=store.read('allco');let lead=state.leads.find(item=>item.id===id);let draft=state.drafts.find(item=>item.id===pending);
  assert.equal(lead.evidenceNeedsReview,true);assert.equal(lead.selected,false);assert.equal(lead.stage,'Contacted');assert.deepEqual(lead.events,history);assert.equal(state.customCandidates[0].evidenceNeedsReview,true);
  assert.equal(draft.status,'draft');assert.equal(draft.version,2);assert.equal(draft.approvedHash,null);assert.equal(draft.reviewReason,'account_source_changed');assert.equal(state.drafts.find(item=>item.id===sent).status,'simulated');
  assert.throws(()=>service.selectLead('allco',id,true),{code:'account_excluded'});await assert.rejects(service.enrich('allco',id),{code:'account_excluded'});assert.throws(()=>service.approveDraft('allco',pending,true,2),{code:'account_excluded'});await assert.rejects(service.simulateSend('allco',pending),{code:'approval_required'});
  changed=false;const fresh=service.startDiscovery('allco');await fresh.completion;assert.equal(store.read('allco').leads.find(item=>item.id===id).evidenceNeedsReview,true); // Sticky until human review.
  const intake=start();await intake.completion;const request=payload();const rereviewed=await service.reviewWebsiteIntake('allco',intake.id,request);lead=rereviewed.leads.find(item=>item.id===id);
  assert.equal(lead.evidenceNeedsReview,false);assert.equal(lead.selected,false);assert.equal(lead.stage,'Contacted');assert.deepEqual(lead.events,history);assert.equal(rereviewed.customCandidates.length,1);
  service.selectLead('allco',id,true);draft=store.read('allco').drafts.find(item=>item.id===pending);assert.equal(draft.version,3);service.approveDraft('allco',pending,true,3);
  await service.reviewWebsiteIntake('allco',intake.id,request);assert.equal(store.read('allco').drafts.find(item=>item.id===pending).status,'approved');
});

test('a removed selected email alone requires fresh evidence review',async t=>{
  let removed=false;const {store,service,admit}=await setup(t,{source:async url=>({...await source(url),...(removed?{emails:[]}:{})})});const result=await admit();const id=result.leads[0].id;removed=true;const job=service.startDiscovery('allco');await job.completion;assert.equal(store.read('allco').leads.find(lead=>lead.id===id).evidenceNeedsReview,true);
});

test('native graph projects admitted companies and product links without inventing people or crossing businesses',async t=>{
  const {directory,service,admit}=await setup(t);const graph=await createGraph(directory);t.after(()=>graph.close());
  const result=await admit();await graph.sync(result,[]);const snapshot=await graph.snapshot('allco');
  assert.ok(snapshot.nodes.some(node=>node.name==='Example Equipment'));assert.ok(snapshot.edges.some(edge=>edge.type==='matched_to'));assert.ok(!snapshot.nodes.some(node=>node.type==='Person'));assert.equal((await graph.snapshot('huasheng')).nodes.length,0);
});

test('website records survive restart; dismissal neither admits nor refunds completed research',async t=>{
  const {directory,store,service,start,admit}=await setup(t);await admit();const intake=start();await intake.completion;service.dismissWebsiteIntake('allco',intake.id);assert.equal(store.read('allco').wallet.credits,96);assert.equal(store.read('allco').leads.length,1);
  const second=createStore(directory);try{assert.equal(second.read('allco').customCandidates.length,1);assert.equal(second.read('allco').sourceIntakes.length,2);assert.equal(second.read('allco').sourceIntakes[0].status,'dismissed');}finally{second.close();}
});

test('website HTTP endpoints require session and CSRF, reject forged evidence and scope, and expose admission results',async t=>{
  const {store,service,payload}=await setup(t);const app=createApp({store,service,serveStatic:false});const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;
  const post=(url,body,headers={})=>fetch(base+url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  const route='/api/businesses/allco/source-intakes';let response=await post(route,{});assert.equal(response.status,401);
  const session=await post('/api/session',{});const cookie=session.headers.get('set-cookie').split(';')[0];const {csrf}=await session.json();const headers={cookie,'x-csrf-token':csrf};
  assert.equal((await post(route,{}, {cookie})).status,403);
  const input={requestId:randomUUID(),revision:store.read('allco').revision,urls:[root,contact]};
  assert.equal((await post(route,{...input,pages:[{text:'Forged'}]},headers)).status,400);
  response=await post(route,input,headers);assert.equal(response.status,202);const started=await response.json();await new Promise(resolve=>setImmediate(resolve));
  const review=`${route}/${started.activeSourceIntakeId}/review`;
  assert.equal((await post(review,{...payload(),mailboxStatus:'verified'},headers)).status,400);
  assert.equal((await post(review,{...payload(),quotes:{...payload().quotes,application:{...payload().quotes.application,providerVerified:true}}},headers)).status,400);
  assert.equal((await post(review.replace('/allco/','/huasheng/'),payload(),headers)).status,404);
  response=await post(review,payload(),headers);assert.equal(response.status,200);const admitted=await response.json();assert.ok(admitted.admittedLeadId.startsWith('web-'));assert.equal(admitted.leads[0].selected,false);
});


test('restart recovery fails interrupted source work and refunds reservations exactly once without replay',async t=>{
  const {store,service}=await setup(t);
  const reservation=store.reserve('allco','discovery',2);const id=randomUUID();
  store.mutate('allco',state=>{state.jobs.push({id,kind:'website_intake',status:'running',reservation});state.sourceIntakes.push({id,jobId:id,status:'running',requestHash:'fixture',pages:[]});});
  recoverInterruptedWork(store);assert.equal(store.read('allco').wallet.credits,100);assert.equal(store.read('allco').jobs[0].status,'failed');assert.equal(store.read('allco').sourceIntakes[0].errorCode,'interrupted_request');assert.equal(store.read('allco').leads.length,0);
  recoverInterruptedWork(store);assert.equal(store.read('allco').wallet.credits,100);assert.equal(service.snapshot('allco').sourceIntakes[0].status,'failed');
});

test('in-flight model drafts cannot apply after account source evidence changes',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const model={status:()=>({configured:true}),requireConfigured:()=>{},draft:async()=>{await gate;return{value:{subject:'Fixture',body:'Fixture body',claims:[],qualificationQuestions:[]},metadata:{model:'fixture',usage:{inputTokens:1,outputTokens:1}}};}};
  const {store,service,start,payload,admit}=await setup(t,{service:{model}});const result=await admit();const id=result.leads[0].id;service.selectLead('allco',id,true);
  const generated=service.draftWithModel('allco',id,{requestId:randomUUID(),revision:store.read('allco').revision,acknowledgedExternalProcessing:true});
  const next=start();await next.completion;await service.reviewWebsiteIntake('allco',next.id,payload());service.selectLead('allco',id,true);release();
  await assert.rejects(generated,{code:'stale_account_context'});assert.equal(store.read('allco').drafts.length,0);assert.equal(store.read('allco').assistantRuns[0].status,'failed');assert.equal(store.read('allco').wallet.credits,96);
});

test('an in-flight contact check cannot attach old-domain MX results to updated evidence',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const {store,service,start,payload,admit}=await setup(t,{service:{mx:async()=>{await gate;return{status:'found',records:[{exchange:'mail.example-equipment.test',priority:10}]};}}});const result=await admit();const id=result.leads[0].id;
  const pending=service.enrich('allco',id);const next=start();await next.completion;await service.reviewWebsiteIntake('allco',next.id,payload());release();
  await assert.rejects(pending,{code:'stale_account_context'});assert.equal(store.read('allco').leads[0].contact.mxStatus,'not_checked');assert.equal(store.read('allco').wallet.credits,96);
});
