import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore, recoverInterruptedWork, digest, AppError } from '../server/store.js';
import { createService } from '../server/service.js';
import { createGraph } from '../server/graph.js';
import { createApp } from '../server/app.js';
import { createHunterProvider, parseHunterSearch, parseHunterVerification, evidenceUrl, linkedInProfile } from '../server/hunter.js';
import { validContactVerification } from '../src/contact-evidence.js';
import { researchCatalog, competitors } from '../server/catalog.js';
import { scoreAccount } from '../server/evidence.js';

const key='project-fixture-hunter-key-only';
const env={PROJECT_HUNTER_ENABLED:'true',PROJECT_HUNTER_API_KEY:key};
const today=()=>new Date().toISOString().slice(0,10);
const sourceUrl='https://buyer.test/team';
const address='sam@buyer.test';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function searchRaw(domain='buyer.test',overrides={}) {return {data:{domain,disposable:false,webmail:false,organization:'Fixture Equipment',emails:[{value:`sam@${domain}`,type:'personal',confidence:88,first_name:'Sam',last_name:'Fixture',position:'Director of Engineering',seniority:'executive',department:'engineering',linkedin:'https://www.linkedin.com/in/gtm-fixture-person/',sources:[{uri:sourceUrl,extracted_on:today(),last_seen_on:today(),still_on_page:true}],verification:{date:today(),status:'valid'}}],...overrides}};}
function verifyRaw(email=address,overrides={}){return {data:{email,status:'valid',score:98,regexp:true,disposable:false,webmail:false,mx_records:true,smtp_check:true,accept_all:false,block:false,verification:{date:today()},sources:[{uri:sourceUrl,last_seen_on:today()}],...overrides}};}
const memoryGraph=()=>({sync:async()=>{},snapshot:async id=>({businessId:id,nodes:[],edges:[]}),paths:async()=>[]});
async function setup(t,{fetcher,graph=memoryGraph(),provider}={}) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'gtm-hunter-'));const store=createStore(directory);t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  const captures=[];
  const hunter=provider||createHunterProvider({env,fetcher:async(url,options)=>{captures.push({url,options});return fetcher?fetcher(url,options):json(url.pathname.endsWith('domain-search')?searchRaw():verifyRaw());}});
  const service=createService({store,graph,hunter,review:async(candidate,state)=>({...candidate,businessId:state.businessId,fit:scoreAccount(candidate,state),contact:state.leads.find(lead=>lead.id===candidate.id)?.contact||{},events:[]})});
  service.approveProfile('allco',true,store.read('allco').revision);
  store.mutate('allco',state=>{const lead={...researchCatalog[0],id:'fixture',name:'Fixture Equipment',domain:'buyer.test',source:'https://buyer.test/',contactSource:sourceUrl,publicEmail:'office@buyer.test',people:[],facts:['Synthetic equipment fixture.'],businessId:'allco',fit:scoreAccount(researchCatalog[0],state),selected:true,contact:{email:'office@buyer.test',mailboxStatus:'unverified',linkedIn:null},stage:'Matched',events:[]};state.leads=[lead,{...structuredClone(lead),id:'other',name:'Other Fixture',domain:'other.test',source:'https://other.test/'}];});
  const input=(extra={})=>({requestId:randomUUID(),revision:store.read('allco').revision,acknowledgedExternalProcessing:true,...extra});
  const search=async()=>service.searchContacts('allco','fixture',input());
  const verify=async result=>{const run=result.enrichmentRuns.find(run=>run.id===result.activeEnrichmentRunId);return service.verifyContact('allco','fixture',input({searchRunId:run.id,candidateId:run.result.candidates[0].id}));};
  const review=(result,extra={})=>{const verification=result.enrichmentRuns.find(run=>run.id===result.activeEnrichmentRunId);return {requestId:randomUUID(),revision:store.read('allco').revision,searchRunId:verification.searchRunId,candidateId:verification.candidateId,verificationRunId:verification.id,acknowledged:true,acknowledgedUncertain:false,...extra};};
  return {directory,store,service,hunter,captures,input,search,verify,review,graph};
}

test('Hunter live adapter ignores global/personal, dummy, public-test and disabled configuration before any transmission',async t=>{
  let calls=0;
  for(const configuration of [{HUNTER_API_KEY:key,PROJECT_HUNTER_ENABLED:'true'},{...env,PROJECT_HUNTER_ENABLED:'false'},{...env,PROJECT_HUNTER_API_KEY:'dummy-not-connected'},{...env,PROJECT_HUNTER_API_KEY:'test-api-key'}]){const provider=createHunterProvider({env:configuration,fetcher:async()=>{calls++;}});assert.equal(provider.status().configured,false);await assert.rejects(provider.search('buyer.test'),{code:'enrichment_not_configured'});}
  const {store,service,input}=await setup(t,{provider:createHunterProvider({env:{}})});await assert.rejects(service.searchContacts('allco','fixture',input()),{code:'enrichment_not_configured'});assert.equal(store.read('allco').wallet.credits,100);assert.equal(calls,0);
});

test('real provider contract sends only the explicit domain/address to fixed HTTPS endpoints and does not expose keys',async t=>{
  const {search,verify,store,hunter,captures}=await setup(t);const result=await verify(await search());
  assert.equal(captures.length,2);assert.equal(captures[0].url.origin,'https://api.hunter.io');assert.equal(captures[0].url.pathname,'/v2/domain-search');assert.equal(captures[0].url.searchParams.get('domain'),'buyer.test');assert.equal(captures[0].url.searchParams.get('limit'),'10');assert.equal(captures[1].url.pathname,'/v2/email-verifier');assert.equal(captures[1].url.searchParams.get('email'),address);assert.equal(captures[0].url.searchParams.get('api_key'),key);
  assert.equal(captures[0].options.redirect,'manual');assert.deepEqual(captures[0].options.headers,{Accept:'application/json'});assert.equal(captures[0].options.body,undefined);assert.ok(!String(captures[0].url).includes('Huasheng'));assert.ok(!JSON.stringify(result).includes(key));assert.ok(hunter.status().verifiedAt);
  assert.equal(store.read('allco').wallet.credits,90);assert.equal(store.read('allco').leads[0].contact.email,'office@buyer.test');assert.equal(store.read('allco').leads[0].people.length,0);assert.equal(store.read('allco').enrichmentRuns[0].result.providerValid,true);
});

test('search parsing rejects domain mismatch, masks and off-domain addresses, and only retains safe source/profile links',()=>{
  assert.throws(()=>parseHunterSearch(searchRaw('foreign.test'),'buyer.test'),{code:'invalid_enrichment_output'});
  assert.throws(()=>parseHunterSearch(searchRaw('buyer.test',{disposable:true}),'buyer.test'),{code:'unsupported_contact_domain'});
  const raw=searchRaw();raw.data.emails.push({...raw.data.emails[0],value:'masked***@buyer.test'},{...raw.data.emails[0],value:'other@wrong.test'},raw.data.emails[0]);raw.data.emails[0].sources.push({uri:'javascript:alert(1)'},{uri:'https://user:password@buyer.test/'},{uri:'https://buyer.test/?api_key=secret'},{uri:'https://127.0.0.1/'},{uri:'https://internal.local/'});
  const parsed=parseHunterSearch(raw,'buyer.test');assert.equal(parsed.candidates.length,1);assert.equal(parsed.candidates[0].sources.length,1);assert.equal(parsed.candidates[0].linkedIn,'https://www.linkedin.com/in/gtm-fixture-person/');assert.equal(linkedInProfile('https://linkedin.com.evil.test/in/person'),null);assert.equal(linkedInProfile('https://www.linkedin.com/company/fixture'),null);assert.equal(evidenceUrl('https://buyer.test/?access_token=secret'),null);
});

test('provider-valid requires matching email, all checks, and a real recent verification date; accept-all and scores do not replace checks',()=>{
  assert.equal(parseHunterVerification(verifyRaw(),address).providerValid,true);
  assert.throws(()=>parseHunterVerification(verifyRaw('other@buyer.test'),address),{code:'invalid_enrichment_output'});
  for(const overrides of [{status:'accept_all'},{smtp_check:false},{mx_records:false},{regexp:false},{accept_all:true},{block:true},{webmail:true},{disposable:true},{verification:null},{verification:{date:'2026-02-30'}},{verification:{date:'2020-01-01'}},{verification:{date:'2099-01-01'}}])assert.equal(parseHunterVerification(verifyRaw(address,overrides),address).providerValid,false,JSON.stringify(overrides));
  const result=parseHunterVerification(verifyRaw(),address);assert.equal(validContactVerification(result,Date.parse(result.verificationDate)+31*86400000),false);assert.equal(validContactVerification({...result,verificationDate:'2026-02-30'},Date.parse('2026-03-03')),false);
});

test('acknowledgement, quota, stale revision, profile, and account scope fail before provider calls',async t=>{
  const {store,service,input,captures}=await setup(t);
  await assert.rejects(service.searchContacts('allco','fixture',input({acknowledgedExternalProcessing:false})),{code:'external_processing_review_required'});
  await assert.rejects(service.searchContacts('allco','fixture',input({revision:0})),{code:'revision_conflict'});
  await assert.rejects(service.searchContacts('huasheng','fixture',input()),{code:'lead_not_found'});
  store.mutate('allco',state=>{state.wallet.credits=0;});await assert.rejects(service.searchContacts('allco','fixture',input()),{code:'insufficient_credits'});
  store.mutate('allco',state=>{state.wallet.credits=100;state.leads[0].evidenceNeedsReview=true;});await assert.rejects(service.searchContacts('allco','fixture',input()),{code:'account_excluded'});
  store.mutate('allco',state=>{state.leads[0].evidenceNeedsReview=false;state.approved=false;});await assert.rejects(service.searchContacts('allco','fixture',input()),{code:'profile_approval_required'});assert.equal(captures.length,0);
});

test('repeated and conflicting request IDs never repeat provider work or debit, and failures sanitize details and refund once',async t=>{
  const {store,service,input,captures}=await setup(t,{fetcher:async()=>{throw Error('Leaked URL api_key='+key);}});const request=input();const failed=await service.searchContacts('allco','fixture',request);assert.equal(failed.enrichmentRuns[0].status,'failed');assert.equal(failed.wallet.credits,100);assert.ok(!JSON.stringify(failed).includes(key));await service.searchContacts('allco','fixture',request);assert.equal(captures.length,1);assert.equal(store.read('allco').wallet.ledger.length,1);await assert.rejects(service.searchContacts('allco','other',request),{code:'enrichment_request_conflict'});
  for(const response of [()=>json({errors:[{details:key}]},401),()=>json({},302),()=>new Response('bad',{headers:{'content-type':'text/html'}}),()=>json({data:{malformed:true}}),()=>json({echo:key}),()=>json({data:'x'.repeat(300001)})]){const provider=createHunterProvider({env,fetcher:async()=>response()});await assert.rejects(provider.search('buyer.test'));}
});

test('changed profile or account evidence discards in-flight results with a local refund',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});const {store,service,input}=await setup(t,{fetcher:async()=>{await gate;return json(searchRaw());}});
  const pending=service.searchContacts('allco','fixture',input());store.mutate('allco',state=>{state.leads[0].facts=['Changed account evidence'];});release();const result=await pending;assert.equal(result.enrichmentRuns[0].status,'failed');assert.equal(result.enrichmentRuns[0].errorCode,'stale_enrichment_context');assert.equal(result.wallet.credits,100);assert.equal(result.leads[0].contact.email,'office@buyer.test');
});

test('pending verification reserves once; explicit polling completes it without a new charge or automatic replay',async t=>{
  let verificationCalls=0;const {store,service,input,search,verify,captures}=await setup(t,{fetcher:async url=>url.pathname.endsWith('domain-search')?json(searchRaw()):++verificationCalls===1?json({},202):json(verifyRaw())});
  const pending=await verify(await search());const run=pending.enrichmentRuns.find(run=>run.id===pending.activeEnrichmentRunId);assert.equal(run.status,'pending');assert.equal(pending.wallet.credits,90);assert.equal(pending.wallet.ledger[0].status,'reserved');assert.equal(captures.length,2);
  await assert.rejects(service.searchContacts('allco','fixture',input()),{code:'enrichment_in_progress'});
  const result=await service.pollContact('allco','fixture',run.id,{revision:store.read('allco').revision,acknowledgedExternalProcessing:true});assert.equal(result.wallet.credits,90);assert.equal(result.wallet.ledger[0].status,'consumed');assert.equal(result.enrichmentRuns[0].requests,2);
  await service.pollContact('allco','fixture',run.id,{revision:0,acknowledgedExternalProcessing:true});assert.equal(captures.length,3);
});

test('a pending check can be closed locally after profile changes; restart refunds once and never replays',async t=>{
  const {store,service,search,verify,captures}=await setup(t,{fetcher:async url=>url.pathname.endsWith('domain-search')?json(searchRaw()):json({},202)});
  const pending=await verify(await search());const id=pending.activeEnrichmentRunId;service.saveProfile('allco',{icp:{...store.read('allco').icp,regions:'Canada'}},store.read('allco').revision);
  service.cancelContact('allco','fixture',id,{revision:store.read('allco').revision});service.cancelContact('allco','fixture',id,{revision:0});assert.equal(store.read('allco').wallet.credits,95);assert.equal(store.read('allco').enrichmentRuns[0].status,'cancelled');assert.equal(captures.length,2);
  const reservation=store.reserve('allco','vendor_verify',5,'fixture');store.mutate('allco',state=>{state.enrichmentRuns.push({id:randomUUID(),leadId:'fixture',status:'pending',reservation});});recoverInterruptedWork(store);recoverInterruptedWork(store);assert.equal(store.read('allco').wallet.credits,95);assert.equal(store.read('allco').enrichmentRuns.at(-1).status,'failed');assert.equal(captures.length,2);
});

test('human contact selection changes only this account’s unsent recipients, versions and source context; replay preserves a fresh approval',async t=>{
  const {store,service,search,verify,review}=await setup(t);
  const sent=service.draft('allco','fixture','email','A',0);service.approveDraft('allco',sent,true,1);await service.simulateSend('allco',sent);
  const unsent=service.draft('allco','fixture','email','A',1);const linkedin=service.draft('allco','fixture','linkedin','B',0);const other=service.draft('allco','other','email','A',0);service.approveDraft('allco',unsent,true,1);service.approveDraft('allco',other,true,1);
  const verified=await verify(await search());const request=review(verified);const result=await service.applyContact('allco','fixture',request);const lead=result.leads[0];assert.equal(lead.contact.email,address);assert.equal(lead.contact.mailboxStatus,'provider_valid');assert.equal(lead.contact.linkedIn,'https://www.linkedin.com/in/gtm-fixture-person/');assert.equal(lead.contact.roleMatch.includes('unverified'),true);assert.equal(lead.vendorPeople.length,1);assert.equal(lead.people[0].provenance,'hunter_reviewed');assert.equal(lead.stage,'Contacted');
  const updated=result.drafts.find(draft=>draft.id===unsent);assert.equal(updated.recipient,address);assert.equal(updated.version,2);assert.equal(updated.status,'draft');assert.equal(updated.approvedHash,null);assert.ok(updated.sources.includes(sourceUrl));assert.equal(result.drafts.find(draft=>draft.id===linkedin).recipient,lead.contact.linkedIn);assert.equal(result.drafts.find(draft=>draft.id===sent).recipient,'office@buyer.test');assert.equal(result.drafts.find(draft=>draft.id===sent).status,'simulated');assert.equal(result.drafts.find(draft=>draft.id===other).status,'approved');
  assert.throws(()=>service.approveDraft('allco',unsent,true,1),{code:'stale_draft'});service.approveDraft('allco',unsent,true,2);await service.applyContact('allco','fixture',request);assert.equal(store.read('allco').drafts.find(draft=>draft.id===unsent).status,'approved');assert.equal(store.read('allco').contactReviews.length,1);assert.equal(store.read('allco').wallet.credits,89);
});

test('contact application enforces exact candidate, evidence, verification, expiry, uncertainty and revision',async t=>{
  const {store,service,search,verify,review}=await setup(t,{fetcher:async url=>json(url.pathname.endsWith('domain-search')?searchRaw():verifyRaw(address,{status:'accept_all',accept_all:true}))});const verified=await verify(await search());const request=review(verified);
  await assert.rejects(service.applyContact('allco','fixture',{...request,acknowledged:false}),{code:'contact_review_required'});
  await assert.rejects(service.applyContact('allco','fixture',request),{code:'uncertain_contact_review_required'});
  await assert.rejects(service.applyContact('allco','other',request),{code:'enrichment_run_not_found'});
  await assert.rejects(service.applyContact('allco','fixture',{...request,candidateId:'forged'}),{code:'candidate_not_found'});
  await assert.rejects(service.applyContact('allco','fixture',{...request,verificationRunId:request.searchRunId}),{code:'contact_verification_required'});
  await assert.rejects(service.applyContact('allco','fixture',{...request,revision:0,acknowledgedUncertain:true}),{code:'revision_conflict'});
  const result=await service.applyContact('allco','fixture',{...request,acknowledgedUncertain:true});assert.equal(result.leads[0].contact.mailboxStatus,'accept_all');assert.equal(result.leads[0].contact.verification.providerValid,false);
  store.mutate('allco',state=>{state.enrichmentRuns.forEach(run=>run.completedAt='2020-01-01T00:00:00.000Z');});await assert.rejects(service.applyContact('allco','fixture',{...request,requestId:randomUUID(),revision:store.read('allco').revision,acknowledgedUncertain:true}),{code:'enrichment_result_expired'});
});

test('invalid or source-free contacts cannot be selected even with acknowledgement',async t=>{
  const {service,search,verify,review}=await setup(t,{fetcher:async url=>json(url.pathname.endsWith('domain-search')?searchRaw():verifyRaw(address,{status:'invalid'}))});const checked=await verify(await search());await assert.rejects(service.applyContact('allco','fixture',review(checked,{acknowledgedUncertain:true})),{code:'contact_not_usable'});
  const noSources=await setup(t,{fetcher:async()=>{const raw=searchRaw();raw.data.emails[0].sources=[];return json(raw);}});const searched=await noSources.search();await assert.rejects(noSources.verify(searched),{code:'contact_evidence_required'});assert.equal(noSources.captures.length,1);assert.equal(noSources.store.read('allco').wallet.credits,95);
});

test('Hunter processing restrictions block verification, selection and recipient approval within this business',async t=>{
  let restricted=false;const {store,service,input,search,verify,review,captures}=await setup(t,{fetcher:async url=>url.pathname.endsWith('domain-search')?json(searchRaw()):restricted?json({errors:[{id:'claimed_email'}]},451):json(verifyRaw())});
  const searched=await search();const checked=await verify(searched);await service.applyContact('allco','fixture',review(checked));const draft=service.draft('allco','fixture');service.approveDraft('allco',draft,true,1);
  restricted=true;await verify(searched);const state=store.read('allco');assert.equal(state.contactSuppressions.length,1);assert.equal(state.contactSuppressions[0].addressHash,digest({businessId:'allco',email:address}));assert.equal(state.leads[0].contact.processingRestricted,true);assert.equal(state.drafts[0].recipient,'');assert.equal(state.drafts[0].status,'draft');
  const count=captures.length;await assert.rejects(verify(searched),{code:'contact_suppressed'});assert.equal(captures.length,count);
  service.editDraft('allco',draft,{recipient:address});assert.throws(()=>service.approveDraft('allco',draft,true,3),{code:'contact_suppressed'});
  assert.equal(store.read('huasheng').contactSuppressions.length,0);
});

test('contact decisions persist before projection, repair without reapplying, and vendor people survive source refresh',async t=>{
  const graph=memoryGraph();let fail=true;graph.sync=async()=>{if(fail)throw Error('Fixture graph failure');};const {store,service,search,verify,review}=await setup(t,{graph});const checked=await verify(await search());const request=review(checked);const result=await service.applyContact('allco','fixture',request);assert.equal(result.contactReviews[0].graphStatus,'pending');assert.equal(result.leads[0].contact.email,address);
  fail=false;await service.applyContact('allco','fixture',request);assert.equal(store.read('allco').contactReviews[0].graphStatus,'synced');
  // Refresh the catalog record that shares this ID to exercise the actual merge path.
  store.mutate('allco',state=>{state.leads[0].id=researchCatalog[0].id;});const refreshed=service.startDiscovery('allco');await refreshed.completion;assert.ok(store.read('allco').leads.find(lead=>lead.id===researchCatalog[0].id).people.some(person=>person.provenance==='hunter_reviewed'));
});

test('native graph retains reviewed vendor provenance without asserting verified buying authority or crossing businesses',async t=>{
  const {directory,store,service,search,verify,review}=await setup(t);const checked=await verify(await search());await service.applyContact('allco','fixture',review(checked));const graph=await createGraph(directory);try{await graph.sync(store.read('allco'),competitors.allco);const paths=await graph.paths('allco');assert.ok(paths.some(path=>path.person==='Sam Fixture'&&path.evidence.provenance==='hunter_reviewed'&&path.evidence.relevance.includes('unverified')));assert.equal((await graph.paths('huasheng')).length,0);}finally{await graph.close();}
});

test('contact HTTP boundaries require session/CSRF and reject forged addresses, status, identity and cross-business IDs',async t=>{
  const {store,service,input,review}=await setup(t);const server=createApp({store,service,serveStatic:false}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body,headers={})=>fetch(base+route,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});const route='/api/businesses/allco/leads/fixture/contacts';
  assert.equal((await post(route+'/search',input())).status,401);const session=await post('/api/session',{});const cookie=session.headers.get('set-cookie').split(';')[0];const {csrf}=await session.json();const headers={cookie,'x-csrf-token':csrf};assert.equal((await post(route+'/search',input(),{cookie})).status,403);
  assert.equal((await post(route+'/search',{...input(),apiKey:key},headers)).status,400);const searched=await(await post(route+'/search',input(),headers)).json();const run=searched.enrichmentRuns[0];const candidateId=run.result.candidates[0].id;
  assert.equal((await post(route+'/verify',{...input(),searchRunId:run.id,candidateId,email:'forged@other.test'},headers)).status,400);
  const checked=await(await post(route+'/verify',input({searchRunId:run.id,candidateId}),headers)).json();assert.equal((await post(route+'/apply',{...review(checked),mailboxStatus:'valid'},headers)).status,400);
  assert.equal((await post(route.replace('/allco/','/huasheng/')+'/apply',review(checked),headers)).status,404);
  assert.equal((await post(route+'/apply',review(checked),headers)).status,200);
});

test('selected vendor contacts, decisions, and provider ledgers survive SQLite restart',async t=>{
  const {directory,store,service,search,verify,review}=await setup(t);const checked=await verify(await search());await service.applyContact('allco','fixture',review(checked));const reopened=createStore(directory);try{const state=reopened.read('allco');assert.equal(state.leads[0].contact.email,address);assert.equal(state.leads[0].contact.provenance,'hunter_reviewed');assert.equal(state.leads[0].vendorPeople[0].name,'Sam Fixture');assert.equal(state.contactReviews.length,1);assert.equal(state.wallet.credits,90);assert.equal(state.wallet.ledger.filter(entry=>entry.provider==='Hunter'&&entry.status==='consumed').length,2);assert.equal(reopened.read('huasheng').contactReviews.length,0);}finally{reopened.close();}
});

test('a late processing restriction gates an already-approved dry run before credit consumption',async t=>{
  const {store,service}=await setup(t);const id=service.draft('allco','fixture');service.approveDraft('allco',id,true,1);store.mutate('allco',state=>state.contactSuppressions.push({addressHash:digest({businessId:'allco',email:'office@buyer.test'}),reason:'Fixture provider restriction'}));await assert.rejects(service.simulateSend('allco',id),{code:'contact_suppressed'});assert.equal(store.read('allco').wallet.credits,100);assert.equal(store.read('allco').drafts[0].status,'approved');
});

test('campaign reset retains provider processing restrictions along with the billing ledger',async t=>{
  const {store,service}=await setup(t);store.mutate('allco',state=>state.contactSuppressions.push({addressHash:'fixture-restricted-address',reason:'Provider restriction'}));const server=createApp({store,service,serveStatic:false}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const root=`http://127.0.0.1:${server.address().port}`;const session=await fetch(root+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const cookie=session.headers.get('set-cookie').split(';')[0];const {csrf}=await session.json();const response=await fetch(root+'/api/businesses/allco/reset',{method:'POST',headers:{cookie,'x-csrf-token':csrf,'content-type':'application/json'},body:'{}'});assert.equal(response.status,200);assert.equal(store.read('allco').contactSuppressions.length,1);assert.equal(store.read('allco').leads.length,0);
});

test('outcome reports preserve vendor-role provenance and never become provider-verified replies',async t=>{
  const {store,service,search,verify,review}=await setup(t);const checked=await verify(await search());await service.applyContact('allco','fixture',review(checked));const person=store.read('allco').leads[0].people[0];const result=await service.recordOutcome('allco','fixture',{requestId:randomUUID(),revision:store.read('allco').revision,kind:'demo',stage:'Replied',occurredAt:new Date().toISOString(),note:'Synthetic demo response observation.',evidenceUrl:'',draftId:null,respondent:{name:person.name,source:person.source},updateStage:false,acknowledged:true});const event=result.leads[0].events.at(-1);assert.equal(event.respondent.provenance,'hunter_reviewed');assert.equal(event.providerVerified,false);assert.equal(event.mode,'dry_run');assert.equal(event.updateStage,false);
});
