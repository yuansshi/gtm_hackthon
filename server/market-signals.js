import { randomUUID } from 'node:crypto';
import { AppError, addActivity, digest, now } from './store.js';
import { publicSourceUrl, sourceSite } from './public-source.js';
import { searchSourceUrl } from './prospect-search-provider.js';
import { costs } from './catalog.js';
import { extractSignals, normalizeText, sourceDates } from './signal-extraction.js';
import { invalidateAccountDrafts } from './review-policy.js';

const creditCost = costs.market_signals, day = 86400000;
const account = (state,id) => {const lead=state.leads.find(lead=>lead.id===id);if(!lead)throw new AppError(404,'Account not found in this business.','lead_not_found');return lead;};
const checkId = id => {if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw new AppError(400,'Use a valid signal-check request ID.','invalid_request');};
export function markSignalProjection(store,id,projected) {
  if (!projected.leads.some(lead=>lead.signalGraphStatus==='pending')) return;
  const versions=new Map(projected.leads.map(lead=>[lead.id,digest(lead.marketSignals||[])]));
  store.mutate(id,state=>{for(const lead of state.leads)if(lead.signalGraphStatus==='pending'&&versions.get(lead.id)===digest(lead.marketSignals||[]))lead.signalGraphStatus='synced';});
}
export function createMarketSignals({store,graph,competitors,snapshot,profileDigest,exclusionReason,readSource}) {
  const inFlight=new Map();
  const scope=(state,lead)=>{
    if(!state.approved)throw new AppError(409,'Approve the current business profile before checking signals.','profile_approval_required');
    const reason=exclusionReason({...lead,marketSignals:[]},state);if(reason)throw new AppError(409,reason,'account_excluded');
  };
  const refreshExclusion=(state,lead)=>{lead.excludedReason=exclusionReason(lead,state);if(lead.excludedReason)lead.selected=false;};
  const project=async(id)=>{const saved=store.read(id);try{await graph.sync(saved,competitors[id]);markSignalProjection(store,id,saved);}catch{/* Durable evidence remains available for explicit graph repair. */}};
  const configure=(id,leadId,input)=>{
    if(!Array.isArray(input.urls)||input.urls.length<1||input.urls.length>2||!['daily','weekly'].includes(input.frequency)||typeof input.enabled!=='boolean')throw new AppError(400,'Choose one or two company pages and a daily or weekly schedule.','invalid_signal_monitor');
    const initial=store.read(id),lead=account(initial,leadId);scope(initial,lead);
    const site=sourceSite(lead.source);const urls=[...new Set(input.urls.map(value=>{const safe=searchSourceUrl(value);if(!safe)throw new AppError(400,'Use a public HTTPS URL without credentials or secret parameters.','invalid_source');return publicSourceUrl(safe,site).href;}))];
    if(input.enabled&&!input.acknowledgedSchedule)throw new AppError(400,'Confirm the two-credit scheduled source checks before enabling them.','schedule_review_required');
    store.mutate(id,state=>{
      const current=account(state,leadId);const previous=current.signalMonitor;
      if(state.jobs.some(job=>job.status==='running'&&job.leadId===leadId&&job.kind==='market_signals'))throw new AppError(409,'Wait for the current signal check before changing its configuration.','job_running');
      const changed=previous&&JSON.stringify(previous.urls)!==JSON.stringify(urls);
      current.signalMonitor={...previous,version:randomUUID(),urls,enabled:input.enabled,frequency:input.frequency,nextCheckAt:input.enabled?new Date(Date.now()+(input.frequency==='daily'?day:7*day)).toISOString():null,configuredAt:now(),profileHash:profileDigest(state),pausedReason:null,runs:previous?.runs||[],pages:changed?[]:previous?.pages||[]};
      if(changed){for(const signal of current.marketSignals||[])if(['accepted','proposed'].includes(signal.status))signal.status='needs_review';invalidateAccountDrafts(state,leadId,{reason:'market_signal_sources_changed'});current.signalGraphStatus='pending';refreshExclusion(state,current);}
      addActivity(state,'Signal monitor configured',`${current.name}; ${input.enabled?input.frequency+' checks enabled, two local credits per check':'scheduled checks off'}. No message is queued.`,'You',{leadId});
    },input.revision);
    return snapshot(id);
  };
  const start=(id,leadId,input,{scheduled=false}={})=>{
    checkId(input.requestId);const initial=store.read(id),lead=account(initial,leadId),monitor=lead.signalMonitor;
    if(!monitor)throw new AppError(409,'Save company source pages before checking signals.','signal_monitor_required');
    const previous=monitor.runs.find(run=>run.id===input.requestId);
    if(previous)return {...previous,completion:inFlight.get(previous.id)||Promise.resolve()};
    if(initial.revision!==input.revision)throw new AppError(409,'This workspace changed. Reload before checking signals.','revision_conflict');
    scope(initial,lead);
    if(initial.jobs.some(job=>job.status==='running'))throw new AppError(409,'Wait for current research to finish.','job_running');
    if(monitor.runs.length>=100)throw new AppError(409,'This prototype monitor reached its 100-check history limit. Export/review the campaign before more checks.','signal_history_full');
    if(scheduled&&(!monitor.enabled||monitor.profileHash!==profileDigest(initial)))throw new AppError(409,'The monitor needs a new schedule review for this profile.','signal_schedule_stale');
    const reservation=store.reserve(id,'market_signals',creditCost,leadId);
    const run={id:input.requestId,kind:'market_signals',leadId,status:'running',startedAt:now(),scheduled,reservation,profileHash:profileDigest(initial),monitorVersion:monitor.version,accountSource:lead.source,sourceChecks:[]};
    store.mutate(id,state=>{const current=account(state,leadId);current.signalMonitor.runs.unshift(run);current.signalMonitor.nextCheckAt=current.signalMonitor.enabled?new Date(Date.now()+(current.signalMonitor.frequency==='daily'?day:7*day)).toISOString():null;state.jobs.unshift({...run,steps:[]});addActivity(state,'Signal check started',`${current.name}; ${monitor.urls.length} company pages; ${scheduled?'scheduled':'manual'} check, two local credits.`,'Source monitor',{leadId,runId:run.id});});
    const completion=(async()=>{
      const checked=await Promise.all(monitor.urls.map(async url=>{try{const page=await readSource(url);publicSourceUrl(page.url,sourceSite(lead.source));publicSourceUrl(page.finalUrl||page.url,sourceSite(lead.source));if(page.url!==url||page.fetchStatus!=='reachable'||typeof page.text!=='string'||page.text.length<30||page.text.length>48000||!Number.isFinite(Date.parse(page.checkedAt))||Date.parse(page.checkedAt)>Date.now())throw Error('Invalid source');return {page:{...page,text:normalizeText(page.text)},check:{url,status:'reachable',checkedAt:page.checkedAt,contentHash:page.contentHash,title:page.title}};}catch{return {check:{url,status:'failed',checkedAt:now(),error:'source_unavailable'}};}}));
      try{
        store.mutate(id,state=>{
          const current=account(state,leadId),currentMonitor=current.signalMonitor;
          if(!state.approved||profileDigest(state)!==run.profileHash||currentMonitor?.version!==run.monitorVersion||current.source!==run.accountSource)throw new AppError(409,'The profile, account source, or monitor changed. Retrieved work was discarded.','stale_signal_context');
          const pages=checked.flatMap(result=>result.page?[result.page]:[]);const currentRun=currentMonitor.runs.find(item=>item.id===run.id),job=state.jobs.find(item=>item.id===run.id);
          currentMonitor.pages=pages;currentMonitor.lastCheckedAt=now();currentRun.sourceChecks=checked.map(result=>result.check);
          let invalidated=false;current.marketSignals||=[];
          for(const signal of current.marketSignals.filter(signal=>['accepted','proposed'].includes(signal.status))){const page=pages.find(page=>page.url===signal.source);if(!page||!page.text.includes(normalizeText(signal.quote))||(signal.dateQuote&&!page.text.includes(normalizeText(signal.dateQuote)))){if(signal.status==='accepted')invalidated=true;signal.status='needs_review';signal.reviewReason='Source retrieval failed or the retained event/date quote changed.';}else{signal.checkedAt=page.checkedAt;signal.sourceHash=page.contentHash;}}
          const proposals=pages.flatMap(extractSignals);let created=0;
          for(const proposal of proposals){if(current.marketSignals.some(signal=>signal.fingerprint===proposal.fingerprint))continue;if(current.marketSignals.length>=50)break;current.marketSignals.unshift({...proposal,id:randomUUID(),proposedAt:now(),runId:run.id,profileHash:run.profileHash});created++;}
          if(invalidated)invalidateAccountDrafts(state,leadId,{reason:'market_signal_evidence_changed'});
          refreshExclusion(state,current);current.signalGraphStatus='pending';
          const success=pages.length>0;Object.assign(currentRun,{status:success?'completed':'failed',completedAt:now(),proposalCount:created,error:success?null:'No company source could be read. Reserved local credits were refunded.'});Object.assign(job,{status:currentRun.status,completedAt:currentRun.completedAt,error:currentRun.error});
          const entry=state.wallet.ledger.find(entry=>entry.id===reservation);if(entry.status==='reserved'){entry.status=success?'consumed':'refunded';if(!success)state.wallet.credits+=entry.credits;}
          addActivity(state,success?'Signal evidence ready':'Signal check failed',`${current.name}; ${created} new proposals; ${checked.filter(result=>!result.page).length} source failures. Buying intent remains unconfirmed.`,'Source monitor',{leadId,runId:run.id});
        });
        await project(id);
      }catch(error){store.mutate(id,state=>{const current=account(state,leadId);const currentRun=current.signalMonitor?.runs.find(item=>item.id===run.id),job=state.jobs.find(item=>item.id===run.id);const detail=error instanceof AppError?error.message:'Signal processing failed. No new evidence was applied.';if(currentRun)Object.assign(currentRun,{status:'failed',completedAt:now(),sourceChecks:checked.map(result=>result.check),error:detail,errorCode:error.code||'signal_check_failed'});if(job)Object.assign(job,{status:'failed',completedAt:now(),error:detail});const entry=state.wallet.ledger.find(entry=>entry.id===reservation);if(entry?.status==='reserved'){entry.status='refunded';state.wallet.credits+=entry.credits;}});}
    })().finally(()=>inFlight.delete(run.id));inFlight.set(run.id,completion);return {...run,completion};
  };
  const review=async(id,leadId,signalId,input)=>{
    const payload={decision:input.decision,note:String(input.note||'').trim(),eventDate:input.eventDate||'',dateQuote:String(input.dateQuote||'').trim()};
    if(!['accept','dismiss','withdraw'].includes(payload.decision)||payload.note.length>1000)throw new AppError(400,'Choose a signal review decision and a note up to 1,000 characters.','invalid_signal_review');
    if(!input.acknowledged)throw new AppError(400,'Confirm the signal and source-date review.','signal_review_required');
    const initial=store.read(id),lead=account(initial,leadId),signal=lead.marketSignals?.find(signal=>signal.id===signalId);if(!signal)throw new AppError(404,'Signal not found in this account.','signal_not_found');
    if(payload.decision==='dismiss'&&signal.acceptedAt&&['accepted','needs_review'].includes(signal.status))throw new AppError(409,'Withdraw an accepted signal explicitly to remove its effect.','signal_withdraw_required');
    const requestHash=digest(payload);if(signal.lastReviewHash!==requestHash||(payload.decision==='accept'&&signal.status!=='accepted')){
      store.mutate(id,state=>{
        const current=account(state,leadId),record=current.marketSignals.find(signal=>signal.id===signalId);
        if(payload.decision==='accept'){
          scope(state,current);const page=current.signalMonitor?.pages.find(page=>page.url===record.source);
          if(!page||Date.now()-Date.parse(page.checkedAt)>day||Date.parse(page.checkedAt)>Date.now()||!page.text.includes(normalizeText(record.quote))||!payload.dateQuote||!page.text.includes(normalizeText(payload.dateQuote))||!sourceDates(payload.dateQuote).some(date=>date.date===payload.eventDate)||Date.parse(payload.eventDate+'T00:00:00.000Z')>Date.now())throw new AppError(409,'Refresh sources and choose an exact, non-future dated passage from the retained page.','signal_evidence_required');
          record.eventDate=payload.eventDate;record.dateQuote=payload.dateQuote;record.checkedAt=page.checkedAt;record.sourceHash=page.contentHash;record.acceptedAt=now();record.status='accepted';record.reviewReason=null;
        }else record.status=payload.decision==='withdraw'?'withdrawn':'dismissed';
        record.reviewedAt=now();record.reviewedBy='You';record.reviewNote=payload.note;record.lastReviewHash=requestHash;
        invalidateAccountDrafts(state,leadId,{reason:'market_signal_review_changed'});current.signalGraphStatus='pending';refreshExclusion(state,current);
        addActivity(state,'Market signal reviewed',`${current.name}; ${record.title}; ${payload.decision}. Unsent outreach requires fresh review.`,'You',{leadId,signalId});
      },input.revision);
    }
    if(store.read(id).leads.find(lead=>lead.id===leadId).signalGraphStatus==='pending')await project(id);
    return snapshot(id);
  };
  const tick=async()=>{
    for(const id of ['allco','huasheng']){
      const state=store.read(id);if(state.jobs.some(job=>job.status==='running'))continue;
      const due=state.leads.find(lead=>lead.signalMonitor?.enabled&&Date.parse(lead.signalMonitor.nextCheckAt)<=Date.now());if(!due)continue;
      try{await start(id,due.id,{requestId:randomUUID(),revision:state.revision},{scheduled:true}).completion;}
      catch(error){if(error.code==='job_running')continue;store.mutate(id,current=>{const lead=account(current,due.id);lead.signalMonitor.enabled=false;lead.signalMonitor.nextCheckAt=null;lead.signalMonitor.pausedReason=error instanceof AppError?error.message:'Scheduled source checks need review.';addActivity(current,'Signal schedule paused',`${lead.name}; ${lead.signalMonitor.pausedReason}`,'Source monitor',{leadId:lead.id});});}
    }
  };
  return {configure,start,review,tick,drain:()=>Promise.allSettled([...inFlight.values()])};
}
export function createSignalScheduler(service) {
  let running=null,stopped=false;
  const tick=()=>{if(stopped||running)return running||Promise.resolve();running=service.tickSignals().catch(()=>{}).finally(()=>{running=null;});return running;};
  const timer=setInterval(tick,60000);timer.unref();
  return {tick,stop:async()=>{stopped=true;clearInterval(timer);if(running)await running;await service.drainSignals();}};
}
