import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore} from '../server/store.js';
import {createService,profileDigest,profileKeys} from '../server/service.js';
import {createApp} from '../server/app.js';
import {localIntake,intakeFields,validIntakeValue} from '../server/intake.js';
import {createModelProvider,validateSuggestions} from '../server/model.js';
import {commercialPlanningFields,commercialIntakeFields,outreachResearchBrief} from '../src/commercial-planning.js';
import {initialBusinessState,createResearchBrief,profileConfidence} from '../src/businesses.js';
import {graphContextKey} from '../src/graph-context.js';
import {buildProspectPlan} from '../src/prospect-plan.js';
import {researchCatalog} from '../server/catalog.js';
import {scoreAccount} from '../server/evidence.js';
import {bandFixture} from './helpers/band-fixture.js';
const graph={sync:async()=>{},snapshot:async()=>({nodes:[],edges:[]}),paths:async()=>[]};
const terms={monetizationModel:'Custom manufacturing per order',pricingFramework:'Quoted per drawing after qualification',targetContractValue:'USD 25,000–50,000 per order'};
const message=Object.entries(terms).map(([key,value])=>commercialPlanningFields.find(f=>f.key===key).label+': '+value).join('; ');
const env={PROJECT_AI_ENABLED:'true',PROJECT_OPENAI_API_KEY:'fixture-commercial-project-key',PROJECT_OPENAI_MODEL:'fixture-model'};
const response=value=>new Response(JSON.stringify({id:'resp_commercial',object:'response',created_at:1,model:'fixture-model',status:'completed',output:[{id:'msg_commercial',type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value),annotations:[]}]}],usage:{input_tokens:20,output_tokens:10,total_tokens:30}}),{headers:{'content-type':'application/json'}});
async function fixture(t,model=createModelProvider({env:{}})){
 const directory=await mkdtemp(path.join(os.tmpdir(),'gtm-commercial-')),store=createStore(directory);t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
 const service=createService({store,graph,model});
 for(const id of ['allco','huasheng']){store.mutate(id,s=>{s.icp.regions='United States';s.icp.segments=['Equipment manufacturer (OEM)'];s.icp.motion='oem';});service.approveProfile(id,true,store.read(id).revision);store.mutate(id,s=>{s.leads=[{...structuredClone(researchCatalog[0]),businessId:id,selected:true,stage:'Matched',events:[],contact:{email:'buyer@fixture.test'},fit:scoreAccount(researchCatalog[0],s)}];});}
 const request=(id='allco',mode='local')=>({message,mode,requestId:randomUUID(),acknowledgedExternalProcessing:mode==='model',revision:store.read(id).revision});
 const review=(id,result,decisions)=>service.reviewIntake(id,result.activeAssistantRunId,{revision:store.read(id).revision,acknowledged:true,decisions:decisions||result.assistantRuns.find(r=>r.id===result.activeAssistantRunId).result.suggestions.map(s=>({field:s.field,decision:'accepted'}))});
 return{directory,store,service,request,review};
}
test('local labels preserve currency, units and contract wording without inferring values or confusing company revenue',()=>{
 const output=localIntake(message);assert.equal(output.suggestions.length,3);for(const {key}of commercialPlanningFields){const s=output.suggestions.find(s=>s.field==='commercial.'+key);assert.equal(s.value,terms[key]);assert.equal(s.evidence,terms[key]);assert.equal(s.confidence,1);}
 assert.equal(localIntake('We manufacture cylinders and want profitable contracts.').suggestions.some(s=>s.field.startsWith('commercial.')),false);
 assert.equal(localIntake('Do not use Pricing framework: subscription').suggestions.length,0);
 const multiline=localIntake(message.replaceAll('; ','\n'));assert.deepEqual(multiline.suggestions,output.suggestions);assert.ok(output.suggestions.every(s=>s.field!=='revenue'));
});
test('conflicting/oversized labels ask for clarification and do not silently select or truncate commercial targets',()=>{
 for(const {label,key}of commercialPlanningFields){const conflict=localIntake(`${label}: First; ${label}: Second`);assert.ok(conflict.questions.some(q=>q.includes('Multiple')));assert.ok(!conflict.suggestions.some(s=>s.field==='commercial.'+key));const long=localIntake(`${label}: `+'x'.repeat(601));assert.ok(long.questions.some(q=>q.includes('600 characters')));assert.ok(!long.suggestions.some(s=>s.field==='commercial.'+key));}
});
test('proposals wait for explicit accept/adjust/dismiss review, stay business-scoped and revoke approvals only when applied',async t=>{
 const{store,service,request,review}=await fixture(t),draft=service.draft('allco','elliott');service.approveDraft('allco',draft,true,1);const before=store.read('allco');const result=await service.inferProfile('allco',request());assert.deepEqual(store.read('allco').commercial,before.commercial);assert.equal(store.read('allco').approved,true);
 const decisions=result.assistantRuns[0].result.suggestions.map(s=>({field:s.field,decision:s.field.endsWith('pricingFramework')?'adjusted':s.field.endsWith('targetContractValue')?'dismissed':'accepted',...(s.field.endsWith('pricingFramework')?{value:'Owner-adjusted RFQ framework'}:{})}));review('allco',result,decisions);const state=store.read('allco');assert.equal(state.commercial.monetizationModel,terms.monetizationModel);assert.equal(state.commercial.pricingFramework,'Owner-adjusted RFQ framework');assert.equal(state.commercial.targetContractValue,undefined);assert.equal(state.icp.revenue,'');assert.equal(state.icp['commercial.monetizationModel'],undefined);assert.equal(state.approved,false);assert.equal(state.drafts[0].approvedHash,null);assert.equal(state.wallet.credits,100);assert.equal(store.read('huasheng').commercial.monetizationModel,undefined);
});
test('namespace provenance survives unrelated target edits and is removed when its commercial value changes',async t=>{
 const{store,service,request,review}=await fixture(t),result=await service.inferProfile('allco',request());review('allco',result);let state=store.read('allco');const id=state.assistantFieldProvenance['commercial.targetContractValue'].runId;
 service.saveProfile('allco',{icp:{...state.icp,headcount:'100–500 employees'}},state.revision);state=store.read('allco');assert.equal(profileConfidence(state).find(f=>f.field==='commercial.targetContractValue').runId,id);
 service.saveProfile('allco',{commercial:{...state.commercial,targetContractValue:'Owner-updated amount; not a quote'}},state.revision);state=store.read('allco');assert.equal(state.assistantFieldProvenance['commercial.targetContractValue'],undefined);assert.equal(state.assistantFieldProvenance['commercial.pricingFramework'].runId,id);
});
test('legacy commercial objects remain exact and optional blank inputs do not inject defaults into approval fingerprints',async t=>{
 const{store,service}=await fixture(t),before=store.read('allco'),hash=profileDigest(before);assert.equal(Object.keys(initialBusinessState('allco').commercial).length,5);assert.ok(profileConfidence(before).filter(f=>f.field.startsWith('commercial.')).every(f=>f.confidence===0));service.saveProfile('allco',{commercial:{...before.commercial}},before.revision);assert.equal(profileDigest(store.read('allco')),hash);assert.equal(store.read('allco').approved,true);assert.deepEqual(outreachResearchBrief(createResearchBrief(before)).commercial,before.commercial);
});
test('invalid commercial namespace/value, partial reviews and stale profiles cannot mutate or spend',async t=>{
 const{store,service,request}=await fixture(t),result=await service.inferProfile('allco',request()),before=store.read('allco'),base={revision:before.revision,acknowledged:true};
 for(const value of [[],{},null,'','x'.repeat(601)])assert.equal(validIntakeValue('commercial.targetContractValue',value),false);assert.equal(validIntakeValue('commercial.__proto__','Injected'),false);
 assert.throws(()=>service.reviewIntake('allco',result.activeAssistantRunId,{...base,decisions:[]}),{code:'incomplete_proposal_review'});
 assert.throws(()=>service.reviewIntake('huasheng',result.activeAssistantRunId,{...base,revision:store.read('huasheng').revision,decisions:[]}),{code:'proposal_not_found'});
 const decisions=result.assistantRuns[0].result.suggestions.map(s=>({field:s.field,decision:'adjusted',value:s.field.endsWith('targetContractValue')?[]:s.value}));assert.throws(()=>service.reviewIntake('allco',result.activeAssistantRunId,{...base,decisions}),{code:'invalid_proposal_value'});assert.deepEqual(store.read('allco'),before);
 service.saveProfile('allco',{company:{...before.company,name:'Changed supplier context'}},before.revision);assert.throws(()=>service.reviewIntake('allco',result.activeAssistantRunId,{...base,revision:store.read('allco').revision,decisions}),{code:'stale_assistant_context'});assert.equal(store.read('allco').wallet.credits,100);
});
test('catalog economic guesses and rewritten values are rejected before application',()=>{
 const base={summary:'Fixture',suggestions:[],questions:[],caveats:[]};for(const field of commercialIntakeFields){assert.throws(()=>validateSuggestions({...base,suggestions:[{field,value:'USD 999,999',confidence:0.4,basis:'catalog_hypothesis',evidence:'https://supplier.fixture.test/'}]},message,['https://supplier.fixture.test/']),{code:'ungrounded_model_output'});assert.throws(()=>validateSuggestions({...base,suggestions:[{field,value:'USD 999,999',confidence:0.8,basis:'user_input',evidence:terms.targetContractValue}]},message,[]),{code:'ungrounded_model_output'});}
});
test('real SDK intake includes typed commercial fields, one consented request and retained usage on invalid-value refund',async t=>{
 let calls=0,wire;const value={summary:'Commercial fixture',suggestions:commercialPlanningFields.map(({key})=>({field:'commercial.'+key,value:terms[key],confidence:0.9,basis:'user_input',evidence:terms[key]})),questions:[],caveats:['Owner input, not a quote.']};
 const model=createModelProvider({env,fetcher:async(_url,options)=>{calls++;wire=JSON.parse(options.body);return response(value);}});const{store,service,request,review}=await fixture(t,model),req=request('allco','model');await assert.rejects(service.inferProfile('allco',{...req,acknowledgedExternalProcessing:false}),{code:'external_processing_review_required'});assert.equal(calls,0);
 const result=await service.inferProfile('allco',req);await service.inferProfile('allco',req);assert.equal(calls,1);assert.equal(store.read('allco').wallet.credits,98);assert.match(wire.instructions,/literal value/);assert.ok(JSON.stringify(wire.text.format.schema).includes('commercial.targetContractValue'));assert.equal(store.read('allco').commercial.targetContractValue,undefined);review('allco',result);assert.equal(store.read('allco').commercial.targetContractValue,terms.targetContractValue);
 value.suggestions[2].value='USD 999,999';const bad=request('allco','model');await assert.rejects(service.inferProfile('allco',bad),{code:'ungrounded_model_output'});await assert.rejects(service.inferProfile('allco',bad),{code:'request_already_failed'});assert.equal(calls,2);assert.equal(store.read('allco').wallet.credits,98);assert.equal(store.read('allco').assistantRuns[0].providerUsage.totalTokens,30);
});
test('new internal planning values remain in owner exports but outside real SDK outreach, search and graph context',async t=>{
 let wire;const model=createModelProvider({env,fetcher:async(_url,options)=>{wire=JSON.parse(options.body);return response({subject:'Supplier qualification',body:`Requirements remain subject to technical review. [1] ${researchCatalog[0].source} [2] https://www.allcohydraulic.com/`,claims:[{text:'Account source',sourceUrl:researchCatalog[0].source},{text:'Supplier source',sourceUrl:'https://www.allcohydraulic.com/'}],qualificationQuestions:['What requirements apply?']});}});
 const{store,service}=await fixture(t,model);service.saveProfile('allco',{commercial:{...store.read('allco').commercial,monetizationModel:'PRIVATE_MODEL_TARGET',pricingFramework:'PRIVATE_PRICING_TARGET',targetContractValue:'PRIVATE_ORDER_TARGET'}},store.read('allco').revision);service.approveProfile('allco',true,store.read('allco').revision);const state=store.read('allco');assert.match(JSON.stringify(createResearchBrief(state)),/PRIVATE_ORDER_TARGET/);assert.doesNotMatch(graphContextKey(state),/PRIVATE_.*TARGET/);assert.doesNotMatch(JSON.stringify(buildProspectPlan(state,['custom'])),/PRIVATE_.*TARGET/);
 await service.draftWithModel('allco','elliott',{channel:'email',variant:'A',sequenceStep:0,requestId:randomUUID(),acknowledgedExternalProcessing:true,revision:state.revision});assert.doesNotMatch(JSON.stringify(JSON.parse(wire.input[0].content).context),/PRIVATE_.*TARGET/);assert.equal(JSON.parse(wire.input[0].content).context.supplier.commercial.quoteBasis,state.commercial.quoteBasis);
});
test('Band packets exclude internal commercial targets while profile changes still require a fresh approved context',async t=>{
 const x=await bandFixture(t);x.service.saveProfile('allco',{commercial:{...x.store.read('allco').commercial,...Object.fromEntries(commercialPlanningFields.map(({key})=>[key,'PRIVATE_BAND_'+key]))}},x.store.read('allco').revision);x.service.approveProfile('allco',true,x.store.read('allco').revision);await x.enable();const plan=x.service.planBandDraft('allco',x.input());assert.doesNotMatch(JSON.stringify(plan.packet),/PRIVATE_BAND_/);assert.equal(x.messages.length,0);
});

test('strict HTTP preserves old profile hashes, accepts optional commercial fields and reviews all fifteen typed fields',async t=>{
 const values={industries:'Industrial equipment',regions:'United States',segments:['Equipment manufacturer (OEM)'],roles:['Engineering'],motion:'oem',naics:'333120',headcount:'100–500 employees',revenue:'No company revenue threshold',triggers:'Product launch',referenceWins:'No approved reference supplied',exclusions:'Incompatible applications',excludedDomains:'excluded.fixture.test',...Object.fromEntries(commercialPlanningFields.map(({key})=>['commercial.'+key,terms[key]]))};
 const value={summary:'Fifteen explicit fixture fields',suggestions:intakeFields.map(field=>({field,value:values[field],confidence:0.9,basis:'user_input',evidence:Array.isArray(values[field])?values[field].join(', '):values[field]})),questions:[],caveats:[]};
 const model=createModelProvider({env,fetcher:async()=>response(value)});const{store,service}=await fixture(t,model),server=createApp({service,store,serveStatic:false}).listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await new Promise(resolve=>server.once('listening',resolve));const root='http://127.0.0.1:'+server.address().port;
 const session=await fetch(root+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),cookie=session.headers.get('set-cookie').split(';')[0],{csrf}=await session.json(),headers={'Content-Type':'application/json',cookie,'x-csrf-token':csrf};const send=(route,method,body)=>fetch(root+'/api/businesses/allco'+route,{method,headers,body:JSON.stringify(body)});let state=store.read('allco'),hash=profileDigest(state),profile=Object.fromEntries(profileKeys.map(key=>[key,state[key]]));
 let r=await send('/profile','PUT',{profile,revision:state.revision});assert.equal(r.status,200);state=await r.json();assert.equal(profileDigest(state),hash);assert.equal(state.approved,true);
 r=await send('/profile','PUT',{profile:{...profile,commercial:{...profile.commercial,...terms}},revision:state.revision});assert.equal(r.status,200);state=await r.json();assert.equal(state.approved,false);assert.equal(state.commercial.targetContractValue,terms.targetContractValue);
 const before=store.read('allco');r=await send('/profile','PUT',{profile:{...profile,commercial:{...profile.commercial,injected:true}},revision:state.revision});assert.equal(r.status,400);assert.deepEqual(store.read('allco'),before);
 r=await send('/assistant/intake','POST',{message:Object.values(values).flat().join('; '),mode:'model',requestId:randomUUID(),acknowledgedExternalProcessing:true,revision:state.revision});assert.equal(r.status,200);state=await r.json();const decisions=value.suggestions.map(s=>({field:s.field,decision:'accepted'}));
 r=await send('/assistant/intake/'+state.activeAssistantRunId+'/review','POST',{revision:state.revision,acknowledged:true,decisions:[...decisions,decisions[0]]});assert.equal(r.status,400);
 r=await send('/assistant/intake/'+state.activeAssistantRunId+'/review','POST',{revision:state.revision,acknowledged:true,decisions});assert.equal(r.status,200);state=await r.json();assert.equal(state.commercial.targetContractValue,terms.targetContractValue);assert.equal(state.icp.revenue,values.revenue);assert.equal(state.assistantRuns[0].acceptedFields.length,15);assert.equal(state.wallet.credits,98);
});

test('commercial values and per-field review provenance persist after closing and reopening the workspace store',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'gtm-commercial-persist-'));let store=createStore(directory);t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});const service=createService({store,graph,model:createModelProvider({env:{}})}),result=await service.inferProfile('allco',{message,mode:'local',requestId:randomUUID(),acknowledgedExternalProcessing:false,revision:store.read('allco').revision});service.reviewIntake('allco',result.activeAssistantRunId,{revision:store.read('allco').revision,acknowledged:true,decisions:result.assistantRuns[0].result.suggestions.map(s=>({field:s.field,decision:'accepted'}))});const before=store.read('allco');store.close();store=createStore(directory);assert.deepEqual(store.read('allco'),before);for(const {key}of commercialPlanningFields){assert.equal(createResearchBrief(store.read('allco')).commercial[key],terms[key]);assert.equal(profileConfidence(store.read('allco')).find(f=>f.field==='commercial.'+key).runId,result.activeAssistantRunId);}
});
