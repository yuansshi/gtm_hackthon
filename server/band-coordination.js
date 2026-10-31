import { randomUUID } from 'node:crypto';
import { AppError, addActivity, digest, now } from './store.js';
import { bandRoles } from './band-provider.js';
import { checkedMessageBrief } from './message-brief.js';
import { assessMessageBrief } from '../src/message-brief.js';
import { communicationContext } from './communication-policy.js';

const active = ['planning','waiting_builder','building','waiting_reviewer','reviewing','waiting_security','security_review','waiting_planner'];
const fail = (status,message,code) => { throw new AppError(status,message,code); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const fresh = value => Number.isFinite(Date.parse(value)) && Date.parse(value)<=Date.now() && Date.now()-Date.parse(value)<=15*60000;
const companyKey = state => digest({ name: state.company.name, website: state.company.website });
const sourceUrls = draft => [...new Set((draft.body.match(/https?:\/\/[^\s<>\[\]()]+/g)||[]).map(url=>url.replace(/[.,;]+$/,'')))];
const draftFingerprint = draft => draft ? digest({ id:draft.id, version:draft.version, body:draft.body, subject:draft.subject, recipient:draft.recipient, messageBrief:draft.messageBrief, status:draft.status }) : null;

export function createBandCoordination({ store, provider, snapshot, profileDigest, accountContextDigest, requireEligible, requireCommunicationAllowed, createTemplate, createModelDraft, prepareBilling, modelStatus, clock = { setTimeout, clearTimeout } }) {
  const sessions=new Map(),queues=new Map(),workerCounts=new Map(),retryTimers=new Map(),retryCounts=new Map();let stopping=false;
  const data = state => state.band || {};
  const ensure = state => {state.band||={};state.band.checks||=[];state.band.runs||=[];state.band.handled||=[];return state.band;};
  const connection = id => {
    const state=store.read(id),config=provider.binding(id),band=data(state),proof=band.team;
    return !!config.configured && !!band.enabled && proof?.bindingHash===config.hash && fresh(proof.checkedAt) && band.confirmation?.teamHash===digest(proof) && band.confirmation.companyKey===companyKey(state);
  };
  const connected = id => connection(id)&&bandRoles.every(role=>sessions.get(role)?.status().state==='connected'&&sessions.get(role).status().rooms.includes(provider.binding(id).roomId));
  const view = state => {
    const config=provider.binding(state.businessId),band=data(state),ready=connected(state.businessId);
    return { configured:config.configured, enabled:!!band.enabled, connected:ready, bindingHash:config.hash, team:band.team||null, teamHash:band.team?digest(band.team):null, checks:band.checks||[], runs:band.runs||[], requiresInvestigation:!!band.requiresInvestigation, pauseReason:band.pauseReason||null, fixture:!!provider.status().fixture, connections:bandRoles.map(role=>({role,state:sessions.get(role)?.status().state||'stopped',joined:!!sessions.get(role)?.status().rooms.includes(config.roomId)})), status:!config.configured?'Not configured':band.requiresInvestigation?'Handoff needs investigation':ready?'Project agents connected':band.enabled?(connection(state.businessId)?'Connecting project agents':'Room review expired or changed; check again'):'Review and connect this business’s room' };
  };
  const existingTarget = (state,input) => state.drafts.find(draft=>!draft.modelMetadata&&draft.leadId===input.leadId&&draft.channel===input.channel&&draft.variant===input.variant&&draft.sequenceStep===input.sequenceStep&&draft.profileHash===profileDigest(state));
  const buildPlan = (id,input) => {
    provider.requireConfigured(id);const state=store.read(id),lead=state.leads.find(lead=>lead.id===input.leadId);
    if(!state.approved||!lead?.selected)fail(409,'Approve the supplier profile and shortlist the account first.','band_context_not_ready');
    requireEligible(lead,state);requireCommunicationAllowed(state,lead,input.channel,input.channel==='email'?lead.contact?.email:lead.contact?.linkedIn);
    if(!['email','linkedin'].includes(input.channel)||!['A','B'].includes(input.variant)||![0,1,2].includes(input.sequenceStep)||!['template','model'].includes(input.generation))fail(400,'Choose a supported Band drafting request.','band_invalid_request');
    if(input.generation==='model'&&!modelStatus().configured)fail(503,'The project model is not configured. Use the source-template team.','model_not_configured');
    const messageBrief=checkedMessageBrief(input.messageBrief);if(!messageBrief)fail(400,'A saved message brief is required for Band drafting.','invalid_message_brief');
    const target=existingTarget(state,input);if(target&&['simulated','accepted','dispatching','delivery_unknown'].includes(target.status))fail(409,'This variant already has a dispatched or uncertain receipt. Choose an editable step.','draft_locked');
    const request={leadId:lead.id,channel:input.channel,variant:input.variant,sequenceStep:input.sequenceStep,generation:input.generation,messageBrief};
    const packet={business:{id,name:state.company.name,website:state.company.website},account:{id:lead.id,name:lead.name,domain:lead.domain,application:lead.application,source:lead.source},productFamilies:state.productFamilies,request,policy:'Prepare and check a draft. Human review is required; no agent can approve, modify schema or dispatch outreach.'};
    if(JSON.stringify(packet).length>12000)fail(400,'The public Band packet exceeds its prototype size limit.','band_packet_too_large');
    const context={roomBinding:provider.binding(id).hash,roster:data(state).team?.rosterHash||null,confirmation:data(state).confirmation?.at||null,profile:profileDigest(state),account:accountContextDigest(lead),preferences:communicationContext(state),target:draftFingerprint(existingTarget(state,request))};
    return {packet,context,revision:state.revision,destination:{roomId:provider.binding(id).roomId,readers:data(state).team?.participants||[]},previewHash:digest({packet,context}),costCredits:input.generation==='model'?2:0};
  };
  const check = async(id,input) => {
    if(!uuid(input.requestId)||!input.acknowledged)fail(400,'Confirm checking the four project identities and room readers. No message is sent.','band_review_required');
    const config=provider.requireConfigured(id),before=store.read(id),old=data(before).checks?.find(item=>item.id===input.requestId);
    if(old){if(old.bindingHash!==config.hash)fail(409,'This check ID belongs to another Band configuration.','band_request_conflict');return snapshot(id);}
    if(data(before).runs?.some(run=>active.includes(run.status))||(workerCounts.get(id)||0)>0)fail(409,'Wait for agent work or stop it before checking the team again.','band_run_busy');
    if(data(before).checks?.some(item=>item.status==='running'))fail(409,'Wait for the existing Band identity check.','band_check_running');
    store.mutate(id,state=>{const band=ensure(state);band.checks.unshift({id:input.requestId,bindingHash:config.hash,status:'running',startedAt:now()});band.checks=band.checks.slice(0,30);},input.revision);
    try{const proof=await provider.checkTeam(id);store.mutate(id,state=>{const band=ensure(state);if(provider.binding(id).hash!==config.hash)fail(409,'Band configuration changed during the check.','band_context_changed');band.team=proof;Object.assign(band.checks.find(item=>item.id===input.requestId),{status:'completed',completedAt:now()});band.confirmation=null;band.enabled=false;addActivity(state,'Band project team checked','Review the four agent identities and every room reader before connecting. No message sent.');});await leaveBusiness(id);}
    catch(error){store.mutate(id,state=>{const band=ensure(state);band.enabled=false;Object.assign(band.checks.find(item=>item.id===input.requestId),{status:'failed',completedAt:now(),error:error instanceof AppError?error.message:'Band identity check failed.'});});await leaveBusiness(id);}
    return snapshot(id);
  };
  const markPaused = (id,reason) => store.mutate(id,state=>{const band=ensure(state);band.enabled=false;band.pauseReason=reason;for(const run of band.runs.filter(run=>active.includes(run.status))){run.status='paused';run.error=reason;run.completedAt=now();}addActivity(state,'Band project agents paused',reason);});
  const leaveBusiness = async id => {
    clearRetries(id);const roomId=provider.binding(id).roomId;
    await Promise.allSettled([...sessions.values()].map(session=>session.leave(roomId)));
    if(!['allco','huasheng'].some(business=>data(store.read(business)).enabled)){for(const session of sessions.values())session.close();sessions.clear();}
  };
  const pause = async(id,input) => {
    if(!input.acknowledged)fail(400,'Confirm stopping this business’s Band agents. In-flight model requests may still finish or time out.','band_review_required');
    store.mutate(id,state=>{const band=ensure(state);band.enabled=false;for(const run of band.runs.filter(run=>active.includes(run.status))){run.status='paused';run.error='Project agents stopped. No automatic restart or message replay.';run.completedAt=now();}addActivity(state,'Band project agents stopped','Existing model requests can still finish; results cannot apply to a stopped run. No outreach was cancelled or sent.');},input.revision);
    await leaveBusiness(id);return snapshot(id);
  };
  const abandon = (id,runId,input) => {
    if(!input.acknowledged)fail(400,'Confirm abandoning further processing of this exact Band run. This does not cancel provider work or assert message delivery.','band_review_required');
    store.mutate(id,state=>{const band=ensure(state),run=band.runs.find(item=>item.id===runId);if(!run)fail(404,'Band run not found in this business.','band_run_not_found');if(run.status==='abandoned')return;if(!['needs_investigation','interrupted','paused'].includes(run.status))fail(409,'Stop active work before abandoning this run.','band_run_busy');run.status='abandoned';run.completedAt=now();run.abandonedBy='You';run.error='Further processing abandoned by owner. Provider acceptance/cancellation is not established; recorded messages will not trigger this run again.';band.requiresInvestigation=band.runs.some(item=>item.status==='needs_investigation');addActivity(state,'Band run abandoned',run.error,'You',{bandRunId:runId});},input.revision);return snapshot(id);
  };
  const clearRetries = id => {for(const[key,timer]of retryTimers)if(!id||key.startsWith(id+':')){clock.clearTimeout(timer);retryTimers.delete(key);retryCounts.delete(key);}};
  const retryDrain = (id,role) => {const key=id+':'+role;if(stopping||!connection(id)||retryTimers.has(key))return;const attempt=retryCounts.get(key)||0;if(attempt>=5){markPaused(id,'Band message processing did not recover. Inspect the room and reconnect the project agents; no handoff or model request was reposted.');clearRetries(id);void leaveBusiness(id);return;}retryCounts.set(key,attempt+1);retryTimers.set(key,clock.setTimeout(()=>{retryTimers.delete(key);if(connection(id)&&!stopping)void enqueue(id,role,()=>drain(id,role));},Math.min(16000,1000*2**attempt)));};
  const enqueue = (id,role,fn) => {
    const key=id+':'+role,previous=queues.get(key)||Promise.resolve();workerCounts.set(id,(workerCounts.get(id)||0)+1);
    const next=previous.catch(()=>{}).then(fn).catch(error=>{if(['band_lookup_failed','band_operation_unknown'].includes(error?.code))retryDrain(id,role);else if(connection(id)){markPaused(id,'Band message processing needs attention. Inspect project access before reconnecting.');clearRetries(id);void leaveBusiness(id);}}).finally(()=>{workerCounts.set(id,Math.max(0,(workerCounts.get(id)||1)-1));if(queues.get(key)===next)queues.delete(key);});queues.set(key,next);return next;
  };
  const businessForRoom = roomId => ['allco','huasheng'].find(id=>provider.binding(id).roomId===roomId&&connection(id));
  const onStatus = info => {
    if(stopping)return;
    for(const id of ['allco','huasheng'])if(data(store.read(id)).enabled){store.mutate(id,state=>{const band=ensure(state);band.connections||={};band.connections[info.role]=info;});if(['conflict','needs_reconnect','handler_error'].includes(info.state)){markPaused(id,info.reason||'Project agent connection needs attention.');void leaveBusiness(id);}}
  };
  const connect = async(id,input) => {
    if(!input.acknowledged)fail(400,'Review the dedicated Band room and all readers before connecting project agents.','band_review_required');
    store.mutate(id,state=>{const config=provider.requireConfigured(id),band=ensure(state),team=band.team;if(!team||team.bindingHash!==config.hash||input.bindingHash!==config.hash||input.teamHash!==digest(team)||!fresh(team.checkedAt)||band.checks[0]?.status!=='completed')fail(409,'The Band identity/room check changed or expired. Check again.','band_team_stale');if(band.requiresInvestigation)fail(409,'Investigate the uncertain Band handoff before reconnecting.','band_investigation_required');band.confirmation={teamHash:digest(team),companyKey:companyKey(state),at:now(),actor:'You'};band.enabled=true;band.pauseReason=null;addActivity(state,'Band room access confirmed','Project agents may acknowledge mentions in this dedicated room. Draft creation requires its own reviewed request; no agent can approve or send outreach.');},input.revision);
    try{for(const role of bandRoles){let session=sessions.get(role);if(!session||['stopped','conflict','needs_reconnect'].includes(session.status().state)){session=provider.open(role,{onStatus,onJoined:roomId=>{const business=businessForRoom(roomId);if(business)return enqueue(business,role,()=>drain(business,role));},onRoomRemoved:roomId=>{const business=businessForRoom(roomId);if(business){markPaused(business,'A project agent lost room access. Check and confirm the room again.');return leaveBusiness(business);}},onMessage:(roomId,message)=>{const business=businessForRoom(roomId);if(business)return enqueue(business,role,()=>handle(business,role,message));}});sessions.set(role,session);}await session.join(provider.binding(id).roomId);if(!data(store.read(id)).enabled)fail(409,'The project agent connection stopped.','band_not_connected');}}
    catch(error){markPaused(id,'Band connections could not be established. Check the dedicated identities before reconnecting.');await leaveBusiness(id);throw error;}
    return snapshot(id);
  };
  const assertRun = (id,runId) => {
    const state=store.read(id),band=data(state),run=band.runs?.find(item=>item.id===runId);
    if(!run||!active.includes(run.status)||!connection(id)||stopping)fail(409,'This Band run is stopped or its room review expired.','band_run_stale');
    const lead=state.leads.find(item=>item.id===run.request.leadId);
    if(!state.approved||!lead?.selected||profileDigest(state)!==run.context.profile||accountContextDigest(lead)!==run.context.account||communicationContext(state)!==run.context.preferences)fail(409,'The account, profile or preferences changed during Band work. Start a fresh reviewed request.','band_context_changed');
    requireEligible(lead,state);requireCommunicationAllowed(state,lead,run.request.channel,run.request.channel==='email'?lead.contact?.email:lead.contact?.linkedIn);
    if(run.draftId){const draft=state.drafts.find(item=>item.id===run.draftId);if(!draft||draftFingerprint(draft)!==run.draftHash)fail(409,'The message changed during Band review. Review the current version yourself or start a fresh run.','band_context_changed');}
    else if(draftFingerprint(existingTarget(state,run.request))!==run.context.target)fail(409,'This message variant changed while Band was working.','band_context_changed');
    return{state,run,lead};
  };
  const rosterGate = async(id,role) => {const expected=data(store.read(id)).team?.rosterHash,current=await provider.checkRoster(id,role);if(current.hash!==expected){markPaused(id,'Band room readers changed. Check and confirm access again.');await leaveBusiness(id);fail(409,'Band room readers changed.','band_roster_changed');}};
  const handoff = async(id,runId,from,to,step,note) => {
    await rosterGate(id,from);const {run}=assertRun(id,runId),team=data(store.read(id)).team;
    const envelope={protocol:'gtm-band-v1',runId,businessId:id,contextHash:run.previewHash,step,note,packet:run.packet};
    const content=`@${team.roles.find(item=>item.role===to).handle.replace(/^@/,'')}\n${JSON.stringify(envelope)}`;
    store.mutate(id,state=>{const current=ensure(state).runs.find(item=>item.id===runId);current.outbound||=[];if(current.outbound.some(item=>item.step===step))fail(409,'This Band handoff is already recorded. It will not replay.','band_handoff_recorded');current.outbound.push({step,from,to,content,hash:digest(content),status:'submitting',at:now()});current.status={builder:'waiting_builder',reviewer:'waiting_reviewer',security:'waiting_security',planner:'waiting_planner'}[to];});
    try{const accepted=await provider.send(id,from,to,content);store.mutate(id,state=>{const band=ensure(state),current=band.runs.find(item=>item.id===runId),out=current.outbound.find(item=>item.step===step);if(out.messageId&&out.messageId!==accepted.id){band.requiresInvestigation=true;current.status='needs_investigation';current.error='Band message identifiers disagree. Inspect the room before further work.';return;}out.messageId=accepted.id;if(out.status!=='consumed')out.status='accepted';out.acceptedAt=accepted.acceptedAt;});}
    catch(error){store.mutate(id,state=>{const band=ensure(state),current=band.runs.find(item=>item.id===runId),out=current.outbound.find(item=>item.step===step);if(out.status==='consumed'||out.messageId){if(error.code==='band_operation_rejected'){band.requiresInvestigation=true;current.status='needs_investigation';current.error='Band receipt conflicts with a rejected handoff. Inspect the room.';}return;}out.status=error.code==='band_operation_rejected'?'rejected':'unknown';current.status=out.status==='unknown'?'needs_investigation':'failed';current.error=error instanceof AppError?error.message:'Band handoff acceptance is unknown.';current.completedAt=now();if(out.status==='unknown')band.requiresInvestigation=true;});}
  };
  const start = async(id,input) => {
    if(!uuid(input.requestId)||!input.acknowledged)fail(400,'Review and acknowledge the exact public Band packet before starting.','band_packet_review_required');
    const requestHash=digest({leadId:input.leadId,channel:input.channel,variant:input.variant,sequenceStep:input.sequenceStep,generation:input.generation,messageBrief:input.messageBrief,previewHash:input.previewHash});
    const old=data(store.read(id)).runs?.find(item=>item.id===input.requestId);if(old){if(old.requestHash!==requestHash)fail(409,'This Band request ID belongs to another packet.','band_request_conflict');return{...snapshot(id),activeBandRunId:old.id};}
    if(!connected(id))fail(409,'Check and connect the project agents before starting.','band_not_connected');
    const plan=buildPlan(id,input);if(input.previewHash!==plan.previewHash)fail(409,'The public Band packet changed. Inspect it again.','band_packet_stale');
    if(input.generation==='model'&&!input.acknowledgedModelProcessing)fail(400,'Confirm the separate project-model processing and two-credit budget.','external_processing_review_required');
    store.mutate(id,state=>{const band=ensure(state);if(band.requiresInvestigation)fail(409,'Inspect the uncertain Band handoff before starting another run.','band_investigation_required');if(band.runs.some(run=>active.includes(run.status))||(workerCounts.get(id)||0)>0)fail(409,'Wait for this business’s current agent work.','band_run_busy');if(band.runs.length>=200)fail(409,'The prototype retained-run limit is 200 per business.','band_history_limit');if(band.runs.filter(run=>Date.parse(run.startedAt)>Date.now()-60000).length>=5)fail(429,'Limit Band starts to five per business per minute.','band_rate_limited');band.runs.unshift({id:input.requestId,requestHash,previewHash:plan.previewHash,packet:plan.packet,context:plan.context,request:plan.packet.request,status:'planning',startedAt:now(),builderRequestId:randomUUID(),steps:[{role:'planner',agentId:provider.agentId('planner'),at:now(),summary:'Plan: prepare the requested draft, check citation/brief coverage, check URL boundaries, then return to a person. No schema or outreach authority.',modelTokens:0,costCredits:0}],outbound:[]});addActivity(state,'Band drafting requested','Exact public packet reviewed; project agents may prepare a draft. Human approval and sending remain separate.','You',{bandRunId:input.requestId});},input.revision);
    await handoff(id,input.requestId,'planner','builder',0,'Prepare the requested source template or explicitly authorized project-model draft.');
    return{...snapshot(id),activeBandRunId:input.requestId};
  };
  const remember = (id,role,messageId,acked) => store.mutate(id,state=>{const band=ensure(state),key=role+':'+messageId,item=band.handled.find(item=>item.key===key);if(item)item.acked||=acked;else band.handled.unshift({key,role,messageId,acked,at:now()});band.handled=band.handled.slice(0,2000);});
  const processStep = async(id,role,runId) => {
    await rosterGate(id,role);const before=assertRun(id,runId),run=before.run;
    if(role==='builder'){
      store.mutate(id,state=>{ensure(state).runs.find(item=>item.id===runId).status='building';});
      let draftId;
      if(run.request.generation==='model'){
        await prepareBilling(id,{path:`/leads/${run.request.leadId}/drafts`,requestId:run.builderRequestId});assertRun(id,runId);
        const result=await createModelDraft(id,run.request.leadId,{...run.request,requestId:run.builderRequestId,acknowledgedExternalProcessing:true,revision:store.read(id).revision,beforeApply:()=>assertRun(id,runId)});draftId=result.activeDraftId;
      }else{assertRun(id,runId);draftId=createTemplate(id,run.request.leadId,run.request.channel,run.request.variant,run.request.sequenceStep,run.request.messageBrief);}
      const draft=store.read(id).drafts.find(item=>item.id===draftId);if(!draft)fail(409,'Builder draft is unavailable.','band_context_changed');
      store.mutate(id,state=>{const current=ensure(state).runs.find(item=>item.id===runId);if(current.status!=='building')fail(409,'This Band builder was stopped.','band_run_stale');current.draftId=draftId;current.draftHash=draftFingerprint(draft);current.steps.push({role,agentId:provider.agentId(role),at:now(),summary:'Draft prepared; recipient and message still need human review.',modelAttempted:run.request.generation==='model',modelUsage:draft.modelMetadata?.usage||null,modelTokens:draft.modelMetadata?.usage?.totalTokens??(run.request.generation==='model'?null:0),costCredits:run.request.generation==='model'?2:0});});
      await handoff(id,runId,'builder','reviewer',1,'Check the exact prepared draft’s source coverage and saved message brief.');
    }else if(role==='reviewer'||role==='security'){
      const draft=before.state.drafts.find(item=>item.id===run.draftId),issues=[];
      if(role==='reviewer'){issues.push(...assessMessageBrief(draft).issues);for(const source of[before.lead.source,before.state.company.website])if(!draft.body.includes(source))issues.push('Required account/supplier citation is absent.');}
      else{for(const url of sourceUrls(draft)){try{const value=new URL(url);if(value.protocol!=='https:'||value.username||value.password||!(draft.sources||[]).includes(url))issues.push('An outbound URL is outside this draft’s HTTPS evidence.');}catch{issues.push('An outbound URL is invalid.');}}}
      store.mutate(id,state=>{const current=ensure(state).runs.find(item=>item.id===runId);current.status=role==='reviewer'?'reviewing':'security_review';current.steps.push({role,agentId:provider.agentId(role),at:now(),summary:role==='reviewer'?'Citation membership and objective brief checks only; factual accuracy, audience and tone require a person.':'HTTPS/source-membership checks only; this is not SAST, SCA or an independent security audit.',issues,modelTokens:0,costCredits:0});});
      await handoff(id,runId,role,role==='reviewer'?'security':'planner',role==='reviewer'?2:3,issues.length?'Checks found issues. Human correction is required.':'Bounded checks completed. Human approval remains required.');
    }else{
      assertRun(id,runId);store.mutate(id,state=>{const current=ensure(state).runs.find(item=>item.id===runId);current.status='human_review_required';current.completedAt=now();current.summary='Agent handoffs completed. Inspect the exact draft, sources and any reported issues; no approval or outreach was authorized.';addActivity(state,'Band draft ready for human review',current.summary,'Band planner',{bandRunId:runId,draftId:current.draftId});});
    }
  };
  const handle = async(id,role,message,fromQueue=false) => {
    if(!connection(id)||stopping)return;
    const prior=data(store.read(id)).handled?.find(item=>item.key===role+':'+message.id);
    if(prior){if(fromQueue&&!prior.acked){if(await provider.claim(id,role,message.id)){await provider.processed(id,role,message.id);remember(id,role,message.id,true);retryCounts.delete(id+':'+role);}else retryDrain(id,role);}return;}
    let envelope;try{envelope=JSON.parse(message.content.slice(message.content.indexOf('\n')+1));}catch{}
    const state=store.read(id),run=data(state).runs?.find(item=>item.id===envelope?.runId),out=run?.outbound?.find(item=>item.step===envelope?.step);
    const expectedState={builder:'waiting_builder',reviewer:'waiting_reviewer',security:'waiting_security',planner:'waiting_planner'}[role];
    const valid=(run?.status===expectedState||run?.status==='needs_investigation'&&out?.status==='unknown')&&out?.status!=='consumed'&&(!out?.messageId||out.messageId===message.id)&&envelope?.protocol==='gtm-band-v1'&&envelope.businessId===id&&envelope.contextHash===run?.previewHash&&out?.to===role&&message.senderType==='Agent'&&message.senderId===provider.agentId(out.from)&&message.mentions.includes(provider.agentId(role))&&out.hash===digest(message.content);
    if(!await provider.claim(id,role,message.id)){retryDrain(id,role);return;}
    remember(id,role,message.id,false);
    if(valid){
      store.mutate(id,current=>{const entry=ensure(current).runs.find(item=>item.id===run.id).outbound.find(item=>item.step===out.step);if(entry.messageId&&entry.messageId!==message.id)fail(409,'Band handoff message identity differs.','band_message_conflict');entry.messageId=message.id;entry.status='consumed';entry.receivedAt=now();const band=ensure(current),local=band.runs.find(item=>item.id===run.id);if(local.status==='needs_investigation'){local.status=expectedState;local.error=null;local.completedAt=null;band.requiresInvestigation=band.runs.some(item=>item.status==='needs_investigation');}});
      try{await processStep(id,role,run.id);}catch(error){store.mutate(id,current=>{const item=ensure(current).runs.find(item=>item.id===run.id);if(role==='builder'&&!item.steps.some(step=>step.role==='builder')){const assistant=current.assistantRuns?.find(value=>value.id===item.builderRequestId);if(assistant)item.steps.push({role,agentId:provider.agentId(role),at:now(),summary:'Model processing ended without an applied draft. Local credit refunds do not establish provider refunds.',modelAttempted:true,modelUsage:assistant.providerUsage||assistant.metadata?.usage||null,modelTokens:assistant.providerUsage?.totalTokens||assistant.metadata?.usage?.totalTokens||null,costCredits:0});}if(active.includes(item.status)){item.status='failed';item.completedAt=now();item.error=error instanceof AppError?error.message:'Project agent processing failed. No human approval granted.';}});}
    }
    await provider.processed(id,role,message.id);remember(id,role,message.id,true);retryCounts.delete(id+':'+role);
  };
  const drain = async(id,role) => {for(let i=0;i<50&&connection(id)&&!stopping;i++){const message=await provider.next(id,role);if(!message){retryCounts.delete(id+':'+role);return;}await handle(id,role,message,true);const mark=data(store.read(id)).handled?.find(item=>item.key===role+':'+message.id);if(!mark?.acked)return;}};
  const stop = async() => {stopping=true;clearRetries();for(const session of sessions.values())session.close();sessions.clear();await Promise.allSettled([...queues.values()]);};
  return{view,plan:buildPlan,check,connect,pause,abandon,start,stop,drain:async()=>{while(queues.size)await Promise.allSettled([...queues.values()]);},status:()=>({...provider.status(),connected:['allco','huasheng'].some(connected)})};
}
