import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createStore} from '../server/store.js';
import {createService,profileDigest,profileKeys} from '../server/service.js';
import {createApp} from '../server/app.js';
import {createHunterProvider} from '../server/hunter.js';
import {createModelProvider,validateSuggestions} from '../server/model.js';
import {localIntake,validIntakeValue} from '../server/intake.js';
import {createResearchBrief,profileConfidence,initialBusinessState} from '../src/businesses.js';
import {personaScope,comparePersona} from '../src/buyer-persona.js';
import {researchCatalog} from '../server/catalog.js';
import {scoreAccount} from '../server/evidence.js';
const targets={targetTitles:'Director of Engineering, Procurement Manager',targetSeniority:'Director, Manager'};
const message=`Target job titles: ${targets.targetTitles}\nTarget seniority: ${targets.targetSeniority}`;
const graph={sync:async()=>{},snapshot:async()=>({nodes:[],edges:[]}),paths:async()=>[]};
const today=()=>new Date().toISOString().slice(0,10);
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const source='https://buyer.test/team';
const searchRaw=()=>({data:{domain:'buyer.test',disposable:false,webmail:false,emails:[{value:'sam@buyer.test',type:'personal',first_name:'Synthetic',last_name:'Engineer',position:'Director of Engineering',seniority:'executive',department:'engineering',sources:[{uri:source,last_seen_on:today(),still_on_page:true}]}]}});
const verifyRaw=()=>({data:{email:'sam@buyer.test',status:'valid',score:98,regexp:true,disposable:false,webmail:false,mx_records:true,smtp_check:true,accept_all:false,block:false,verification:{date:today()},sources:[{uri:source,last_seen_on:today()}]}});
const modelEnv={PROJECT_AI_ENABLED:'true',PROJECT_OPENAI_API_KEY:'fixture-project-persona-key',PROJECT_OPENAI_MODEL:'fixture-model'};
const modelResponse=value=>json({id:'resp_persona',object:'response',created_at:1,model:'fixture-model',status:'completed',output:[{id:'msg_persona',type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value),annotations:[]}]}],usage:{input_tokens:20,output_tokens:10,total_tokens:30}});
const proposal=()=>({summary:'Synthetic buyer persona targets',suggestions:Object.entries(targets).map(([field,value])=>({field,value,evidence:value,basis:'user_input',confidence:0.9})),questions:[],caveats:['Research targets, not verified people.']});
async function fixture(t,{model=createModelProvider({env:{}}),fetcher}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'gtm-persona-')),store=createStore(directory);let closed=false;const close=()=>{if(!closed){store.close();closed=true;}};t.after(async()=>{close();await rm(directory,{recursive:true,force:true});});const captures=[];
 const hunter=createHunterProvider({env:{PROJECT_HUNTER_ENABLED:'true',PROJECT_HUNTER_API_KEY:'fixture-designated-project-hunter'},fetcher:async(url,options)=>{captures.push({url,options});return fetcher?fetcher(url,options):json(url.pathname.endsWith('domain-search')?searchRaw():verifyRaw());}});
 const service=createService({store,graph,hunter,model});service.approveProfile('allco',true,store.read('allco').revision);store.mutate('allco',s=>{s.leads=[{...structuredClone(researchCatalog[0]),id:'fixture',name:'Synthetic Buyer',domain:'buyer.test',source:'https://buyer.test/',contactSource:source,publicEmail:'office@buyer.test',people:[],facts:['Synthetic equipment data only'],businessId:'allco',fit:scoreAccount(researchCatalog[0],s),selected:true,contact:{email:'office@buyer.test',mailboxStatus:'unverified'},stage:'Matched',events:[]}];});
 const input=extra=>({requestId:randomUUID(),revision:store.read('allco').revision,acknowledgedExternalProcessing:true,...extra});
 const setTargets=values=>{service.saveProfile('allco',{icp:{...store.read('allco').icp,...values}},store.read('allco').revision);service.approveProfile('allco',true,store.read('allco').revision);};
 const infer=(mode='local')=>service.inferProfile('allco',input({message,mode}));
 const review=(result,decisions)=>service.reviewIntake('allco',result.activeAssistantRunId,{revision:store.read('allco').revision,acknowledged:true,decisions:decisions||result.assistantRuns.find(r=>r.id===result.activeAssistantRunId).result.suggestions.map(s=>({field:s.field,decision:'accepted'}))});
 const search=()=>service.searchContacts('allco','fixture',input());
 const verify=async result=>{const run=result.enrichmentRuns.find(r=>r.id===result.activeEnrichmentRunId);return service.verifyContact('allco','fixture',input({searchRunId:run.id,candidateId:run.result.candidates[0].id}));};
 const apply=async result=>{const run=result.enrichmentRuns.find(r=>r.id===result.activeEnrichmentRunId);return service.applyContact('allco','fixture',input({searchRunId:run.searchRunId,candidateId:run.candidateId,verificationRunId:run.id,acknowledged:true,acknowledgedUncertain:false}));};
 return{directory,store,service,captures,input,setTargets,infer,review,search,verify,apply,close};
}
test('explicit persona labels preserve target phrases, blank/duplicate/oversized values and do not become company geography',()=>{
 const output=localIntake(message,'allco');assert.deepEqual(output.suggestions.map(s=>[s.field,s.value]),Object.entries(targets));assert.ok(output.suggestions.every(s=>s.confidence===1));
 const blank=localIntake('Target job titles:\nTarget seniority: Director','allco');assert.deepEqual(blank.suggestions.map(s=>s.field),['targetSeniority']);
 assert.equal(localIntake('Target job titles: US OEM Strategy Director','allco').suggestions.length,1);
 for(const input of ['Target seniority: Director; Target seniority: Manager','Target job titles: '+'x'.repeat(601)]){const r=localIntake(input,'allco');assert.equal(r.suggestions.length,0);assert.ok(r.questions.some(q=>/Multiple|no partial/.test(q)));}
 for(const value of [[],{},null,'','x'.repeat(601)])assert.equal(validIntakeValue('targetTitles',value),false);
});
test('persona hints compare whole phrases without deriving rank, authority, aliases, negated criteria or old search scope',()=>{
 const scope=personaScope(targets),candidate={role:'Senior Director of Engineering',seniority:'executive'};let r=comparePersona(candidate,scope);assert.equal(r.title.status,'phrase_overlap');assert.equal(r.title.matchedPhrase,'Director of Engineering');assert.equal(r.seniority.status,'no_phrase_overlap');
 assert.equal(comparePersona({role:'Procurement Management'},personaScope({targetTitles:'Procurement Manager'})).title.status,'no_phrase_overlap');
 assert.equal(comparePersona({role:'Director',seniority:''},personaScope({targetSeniority:'Director'})).seniority.status,'unknown');
 for(const criteria of ['not Director','Manager and above','Director or VP','Director+','*Manager'])assert.equal(comparePersona(candidate,personaScope({targetSeniority:criteria})).seniority.status,'needs_review');
 assert.equal(comparePersona({},personaScope({})).title.status,'not_specified');assert.equal(comparePersona(candidate,undefined),null);assert.equal(comparePersona(candidate,{version:0,...targets}),null);
 assert.equal(comparePersona({role:'ＶＰ — Engineering'},personaScope({targetTitles:'VP Engineering'})).title.status,'phrase_overlap');
});
test('persona suggestions remain unapplied until mixed review, revoke approvals and keep the other business and credits unchanged',async t=>{
 const x=await fixture(t),other=x.store.read('huasheng');const draft=x.service.draft('allco','fixture');x.service.approveDraft('allco',draft,true,1);const hash=x.store.read('allco').drafts[0].approvedHash,result=await x.infer();assert.equal(x.store.read('allco').icp.targetTitles,undefined);assert.equal(x.store.read('allco').drafts[0].approvedHash,hash);
 x.review(result,[{field:'targetTitles',decision:'adjusted',value:'Head of Design Engineering'},{field:'targetSeniority',decision:'dismissed'}]);const s=x.store.read('allco');assert.equal(s.icp.targetTitles,'Head of Design Engineering');assert.equal(s.icp.targetSeniority,undefined);assert.equal(s.approved,false);assert.equal(s.drafts[0].approvedHash,null);assert.equal(s.wallet.credits,100);assert.deepEqual(x.store.read('huasheng'),other);assert.equal(profileConfidence(s).find(f=>f.field==='targetTitles').runId,result.activeAssistantRunId);
});
test('persona provenance survives unrelated edits and rejects incomplete, foreign and stale decisions',async t=>{
 const x=await fixture(t),r=await x.infer(),before=x.store.read('allco');assert.throws(()=>x.review(r,[]),{code:'incomplete_proposal_review'});assert.deepEqual(x.store.read('allco'),before);assert.throws(()=>x.service.reviewIntake('huasheng',r.activeAssistantRunId,{revision:x.store.read('huasheng').revision,acknowledged:true,decisions:[]}),{code:'proposal_not_found'});x.review(r);
 let s=x.store.read('allco');x.service.saveProfile('allco',{icp:{...s.icp,triggers:'Synthetic product launch'}},s.revision);s=x.store.read('allco');assert.ok(s.assistantFieldProvenance.targetTitles);x.service.saveProfile('allco',{icp:{...s.icp,targetSeniority:'Executive'}},s.revision);s=x.store.read('allco');assert.ok(s.assistantFieldProvenance.targetTitles);assert.equal(s.assistantFieldProvenance.targetSeniority,undefined);
 const stale=await x.infer();s=x.store.read('allco');x.service.saveProfile('allco',{icp:{...s.icp,targetTitles:'Changed target'}},s.revision);assert.throws(()=>x.review(stale),{code:'stale_assistant_context'});
});
test('model persona targets preserve explicit exclusions and clamp source-grounded hypotheses without verifying any person',()=>{
 const profile=createResearchBrief(initialBusinessState('allco'));assert.equal(validateSuggestions(proposal(),message,[],profile).suggestions.length,2);
 const explicit=proposal();explicit.suggestions=[{field:'targetSeniority',value:'not Director',evidence:'not Director',basis:'user_input',confidence:0.9}];assert.equal(validateSuggestions(explicit,'Target seniority: not Director',[],profile).suggestions[0].value,'not Director');explicit.suggestions[0].value='Director';explicit.suggestions[0].evidence='Director';assert.throws(()=>validateSuggestions(explicit,'Target seniority: not Director',[],profile),{code:'ungrounded_model_output'});
 const source='https://supplier.fixture.test/',hypothesis=proposal();hypothesis.suggestions=hypothesis.suggestions.map(s=>({...s,basis:'catalog_hypothesis',evidence:source,confidence:0.99}));const parsed=validateSuggestions(hypothesis,'', [source],profile);assert.ok(parsed.suggestions.every(s=>s.confidence===0.5));assert.throws(()=>validateSuggestions(hypothesis,'',[],profile),{code:'ungrounded_model_output'});
});
test('real SDK persona proposal requires consent and deduplicates one typed request, rejecting changed wording with one local refund',async t=>{
 let wire,calls=0,value=proposal();const model=createModelProvider({env:modelEnv,fetcher:async(_url,options)=>{calls++;wire=JSON.parse(options.body);return modelResponse(value);}});const x=await fixture(t,{model}),request=x.input({message,mode:'model'});await assert.rejects(x.service.inferProfile('allco',{...request,acknowledgedExternalProcessing:false}),{code:'external_processing_review_required'});const r=await x.service.inferProfile('allco',request);await x.service.inferProfile('allco',request);assert.equal(calls,1);assert.ok(JSON.stringify(wire.text.format.schema).includes('targetSeniority'));assert.match(wire.instructions,/never claims about an actual person/);assert.equal(x.store.read('allco').icp.targetTitles,undefined);x.review(r);assert.equal(x.store.read('allco').wallet.credits,98);
 value=proposal();value.suggestions[0].value='Chief Executive Officer';const bad=x.input({message,mode:'model'});await assert.rejects(x.service.inferProfile('allco',bad),{code:'ungrounded_model_output'});await assert.rejects(x.service.inferProfile('allco',bad),{code:'request_already_failed'});assert.equal(calls,2);assert.equal(x.store.read('allco').wallet.credits,98);assert.equal(x.store.read('allco').assistantRuns[0].providerUsage.totalTokens,30);
});
test('strict profile HTTP preserves legacy hashes and validates optional persona strings before mutation',async t=>{
 const x=await fixture(t),server=createApp({service:x.service,store:x.store,serveStatic:false}).listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await new Promise(resolve=>server.once('listening',resolve));const root='http://127.0.0.1:'+server.address().port,session=await fetch(root+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),cookie=session.headers.get('set-cookie').split(';')[0],{csrf}=await session.json();const put=profile=>fetch(root+'/api/businesses/allco/profile',{method:'PUT',headers:{'Content-Type':'application/json',cookie,'x-csrf-token':csrf},body:JSON.stringify({profile,revision:x.store.read('allco').revision})});let s=x.store.read('allco'),profile=Object.fromEntries(profileKeys.map(k=>[k,s[k]])),hash=profileDigest(s);assert.equal((await put(profile)).status,200);assert.equal(profileDigest(x.store.read('allco')),hash);assert.equal(x.store.read('allco').approved,true);
 assert.equal((await put({...profile,icp:{...profile.icp,...targets}})).status,200);assert.equal(x.store.read('allco').icp.targetSeniority,targets.targetSeniority);const before=x.store.read('allco');for(const value of [[],null,'x'.repeat(601)])assert.equal((await put({...profile,icp:{...profile.icp,targetTitles:value}})).status,400);assert.deepEqual(x.store.read('allco'),before);
});
test('contact search retains local persona scope without transmitting it and selection records hints without authorizing outreach',async t=>{
 const x=await fixture(t);x.setTargets(targets);const searched=await x.search(),run=searched.enrichmentRuns.find(r=>r.id===searched.activeEnrichmentRunId);assert.deepEqual(run.personaTargets,personaScope(targets));assert.equal(x.store.read('allco').leads[0].contact.email,'office@buyer.test');assert.equal(x.captures.length,1);assert.equal(x.captures[0].url.searchParams.get('domain'),'buyer.test');assert.deepEqual([...x.captures[0].url.searchParams.keys()].sort(),['api_key','domain','limit']);assert.equal(x.captures[0].options.body,undefined);assert.ok(!String(x.captures[0].url).includes('Engineering'));
 const selected=await x.apply(await x.verify(searched)),review=selected.contactReviews[0];assert.equal(review.personaReview.title.status,'phrase_overlap');assert.equal(review.personaReview.seniority.status,'no_phrase_overlap');assert.equal(review.personaReview.title.criteria,targets.targetTitles);assert.equal(selected.leads[0].stage,'Matched');assert.equal(selected.drafts.length,0);assert.equal(selected.wallet.credits,90);assert.equal(selected.delivery.attempts.length,0);
});
test('changed persona context invalidates old vendor results even after research reapproval and does not rewrite saved search targets',async t=>{
 const x=await fixture(t);x.setTargets(targets);const searched=await x.search(),run=searched.enrichmentRuns.find(r=>r.id===searched.activeEnrichmentRunId);x.setTargets({targetTitles:'New target title'});await assert.rejects(x.verify(searched),{code:'stale_enrichment_context'});assert.equal(x.captures.length,1);assert.equal(x.store.read('allco').wallet.credits,95);assert.equal(x.store.read('allco').enrichmentRuns[0].personaTargets.targetTitles,targets.targetTitles);assert.equal(run.personaTargets.targetTitles,targets.targetTitles);
});
test('an in-flight search loses changed persona context and refunds once without applying a contact',async t=>{
 let release,started;const gate=new Promise(resolve=>release=resolve),begun=new Promise(resolve=>started=resolve);const x=await fixture(t,{fetcher:async()=>{started();await gate;return json(searchRaw());}});x.setTargets(targets);const pending=x.search();await begun;x.setTargets({targetSeniority:'Changed term'});release();const result=await pending;assert.equal(result.enrichmentRuns[0].status,'failed');assert.equal(result.enrichmentRuns[0].errorCode,'stale_enrichment_context');assert.equal(result.wallet.credits,100);assert.equal(result.leads[0].contact.email,'office@buyer.test');
});
test('persona targets, search scope and immutable contact decision survive store reopening',async t=>{
 const x=await fixture(t);x.setTargets(targets);await x.apply(await x.verify(await x.search()));const before=x.store.read('allco');x.close();const reopened=createStore(x.directory);try{assert.deepEqual(reopened.read('allco'),before);assert.equal(reopened.read('allco').contactReviews[0].personaReview.seniority.status,'no_phrase_overlap');}finally{reopened.close();}
});
