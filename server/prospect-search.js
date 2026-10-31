import { randomUUID } from 'node:crypto';
import { AppError, digest, now, addActivity } from './store.js';
import { costs } from './catalog.js';
import { buildProspectPlan, excludedDomains, matchesExcludedDomain } from '../src/prospect-plan.js';
import { sourceSite } from './public-source.js';

const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const directoryDomains=['linkedin.com','facebook.com','wikipedia.org','youtube.com','twitter.com','x.com','indeed.com','glassdoor.com','zoominfo.com','apollo.io','crunchbase.com','alibaba.com'];
export function createProspectSearch({store,provider,readSource,stageIntake,snapshot,profileDigest}) {
  const findRun=(state,runId)=>{const run=(state.prospectSearches||[]).find(run=>run.id===runId);if(!run)throw new AppError(404,'Prospect search not found in this business.','search_not_found');return run;};
  const start=(id,input)=>{
    if(!uuid(input.requestId)||!Array.isArray(input.productFamilies)||!Array.isArray(input.queries))throw new AppError(400,'Supply a valid request ID and current search plan.','invalid_search_request');
    if(!input.acknowledgedExternalProcessing)throw new AppError(400,'Confirm sending the displayed search queries to Tavily.','external_processing_review_required');
    const initial=store.read(id);const requestHash=digest({productFamilies:[...input.productFamilies].sort(),queries:input.queries,...(input.expansionId?{expansionId:input.expansionId}:{})});
    const previous=(initial.prospectSearches||[]).find(run=>run.id===input.requestId);
    if(previous){if(previous.requestHash!==requestHash)throw new AppError(409,'This request ID belongs to a different search plan.','search_request_conflict');return {id:previous.id,jobId:previous.jobId};}
    if(!initial.approved)throw new AppError(409,'Approve the current customer profile before prospect search.','profile_approval_required');
    if(initial.revision!==input.revision)throw new AppError(409,'Refresh the workspace before sending this search plan.','revision_conflict');
    let plan;try{plan=buildProspectPlan(initial,input.productFamilies,input.expansionId);}catch(error){throw new AppError(400,error.message,'invalid_search_scope');}
    if(JSON.stringify(plan.queries)!==JSON.stringify(input.queries))throw new AppError(409,'The query plan changed. Review the current plan before searching.','search_plan_changed');
    if(initial.jobs.some(job=>job.status==='running'))throw new AppError(409,'Wait for current source research before starting another search.','job_running');
    const capacity=10-(initial.sourceIntakes||[]).filter(intake=>['running','ready'].includes(intake.status)).length;
    if(capacity<=0)throw new AppError(409,'Review or dismiss queued website intakes before searching for more accounts.','intake_limit');
    provider.requireConfigured();
    const reservation=store.reserve(id,'prospect_search',costs.discovery);const jobId=randomUUID();
    const run={id:input.requestId,jobId,businessId:id,status:'running',requestHash,profileHash:profileDigest(initial),plan,startedAt:now(),reservation,candidates:[],providerResults:[]};
    const job={id:jobId,kind:'prospect_search',status:'running',startedAt:now(),steps:[],reservation,prospectSearchId:run.id};
    store.mutate(id,state=>{state.prospectSearches||=[];state.prospectSearches.unshift(run);state.jobs.unshift(job);const entry=state.wallet.ledger.find(entry=>entry.id===reservation);entry.provider='Tavily';entry.prospectSearchId=run.id;entry.externalStatus='provider_requested';entry.providerBilling='Local demo credits are separate from Tavily charges.';addActivity(state,'ICP prospect search started',`${plan.queries.length} reviewed queries; up to ${Math.min(3,capacity)} company domains. Private exclusions stay local; no account is admitted automatically.`,'Planner',{prospectSearchId:run.id});});
    const step=(actor,summary)=>store.mutate(id,state=>state.jobs.find(job=>job.id===jobId).steps.push({actor,summary,at:now()}));
    const completion=(async()=>{
      const responses=[];
      try {
        step('Planner',`Approved US OEM scope; ${plan.productFamilies.join(', ')}. Only the displayed query text is sent to Tavily.`);
        const settled=await Promise.allSettled(plan.queries.map(query=>provider.search(query)));
        settled.forEach((result,index)=>responses.push(result.status==='fulfilled'?{queryIndex:index,...result.value}:{queryIndex:index,query:plan.queries[index],failed:true,error:result.reason instanceof AppError?result.reason.code:'search_request_failed'}));
        if(!responses.some(result=>!result.failed))throw new AppError(502,'The search provider returned no usable responses. Local credits were refunded; vendor billing may be unknown.','prospect_search_failed');
        const groups=new Map();
        for(const response of responses.filter(response=>!response.failed))for(const result of response.results){const domain=sourceSite(result.url);let group=groups.get(domain);if(!group){group={id:randomUUID(),domain,title:result.title,urls:[],searchResults:[],status:'discovered',sourceErrors:[]};groups.set(domain,group);}if(!group.urls.includes(result.url))group.urls.push(result.url);group.searchResults.push({...result,queryIndex:response.queryIndex});}
        const exclusions=excludedDomains(initial.icp.excludedDomains);let checked=0;const candidates=[];
        step('Builder',`${groups.size} discovered domains. Applying local domain, duplicate, and source limits before public retrieval.`);
        for(const group of groups.values()){
          const existing=initial.leads.find(lead=>lead.domain.toLowerCase().replace(/^www\./,'')===group.domain);
          const queued=(initial.sourceIntakes||[]).find(intake=>intake.site===group.domain&&['ready','running'].includes(intake.status));
          if(matchesExcludedDomain(group.domain,exclusions)){group.status='excluded';group.reason='Excluded domain or subdomain in the approved profile.';}
          else if(matchesExcludedDomain(group.domain,directoryDomains)){group.status='excluded';group.reason='Directory or social source; a company website is required for this intake path.';}
          else if(existing){group.status='existing';group.existingLeadId=existing.id;group.reason='Already in this business’s account collection. Use source refresh for updates.';}
          else if(queued){group.status='queued';group.intakeId=queued.id;group.reason='This website is already in the source-review queue.';}
          else if(checked>=Math.min(3,capacity)){group.status='deferred';group.reason='This run’s source-check limit was reached. Research this website separately if needed.';}
          else {
            checked++;const urls=group.urls.slice(0,2);const pages=await Promise.allSettled(urls.map(url=>readSource(url)));
            group.pages=pages.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);group.sourceErrors=pages.flatMap((result,index)=>result.status==='rejected'?[{url:urls[index],code:result.reason instanceof AppError?result.reason.code:'source_unavailable'}]:[]);
            if(group.pages.length){group.status='ready';group.intakeId=randomUUID();group.reason=group.sourceErrors.length?'Some sources failed; review the retained pages.':'Sources retrieved; company, geography, OEM, and application still require review.';}
            else{group.status='source_failed';group.reason='No readable source page was retrieved. No website intake or account was created.';}
          }
          candidates.push(group);
        }
        step('Reviewer',`${candidates.filter(candidate=>candidate.status==='ready').length} source proposals ready for quoted-evidence review. Search snippets and ranks do not establish company facts, buyer authority, or intent.`);
        step('Security reviewer','Public-address-pinned HTTPS retrieval only; at most three domains and two pages per domain. No page scripts, external model call, recipient selection, or message dispatch.');
        store.mutate(id,state=>{
          if(!state.approved||profileDigest(state)!==run.profileHash)throw new AppError(409,'The profile changed during search. No source proposals were applied. Start fresh research for the current approved profile.','stale_research');
          const current=findRun(state,run.id);
          for(const candidate of candidates)if(candidate.status==='ready')stageIntake(state,{id:candidate.intakeId,jobId,pages:candidate.pages,sourceSearchRunId:run.id,searchCandidateId:candidate.id,reservation,profileHash:run.profileHash});
          current.candidates=candidates.map(({pages,...candidate})=>({...candidate,fetchedPageCount:pages?.length||0}));current.providerResults=responses.map(({results,...result})=>({...result,resultCount:results?.length||0}));current.status='completed';current.completedAt=now();
          const currentJob=state.jobs.find(job=>job.id===jobId);currentJob.status='completed';currentJob.completedAt=now();
          const entry=state.wallet.ledger.find(entry=>entry.id===reservation);entry.status='consumed';entry.externalStatus='provider_response';entry.providerRequests=plan.queries.length;entry.confirmedProviderUsage=responses.filter(result=>result.usage).map(result=>({queryIndex:result.queryIndex,...result.usage}));entry.proposals=candidates.filter(candidate=>candidate.status==='ready').length;
          addActivity(state,'Prospect search completed',`${current.candidates.length} domains; ${entry.proposals} source proposals. No accounts were admitted or shortlisted.`,'Reviewer',{prospectSearchId:run.id});
        });
      }catch(error){
        store.settle(id,reservation,false);store.mutate(id,state=>{const current=findRun(state,run.id);current.status='failed';current.error=error instanceof AppError?error.message:'Prospect search failed. No accounts were admitted.';current.errorCode=error instanceof AppError?error.code:'prospect_search_failed';current.completedAt=now();current.providerResults=responses.map(({results,...response})=>({...response,resultCount:results?.length||0}));const currentJob=state.jobs.find(job=>job.id===jobId);currentJob.status='failed';currentJob.error=current.error;currentJob.completedAt=now();const entry=state.wallet.ledger.find(entry=>entry.id===reservation);entry.externalStatus='provider_unknown';entry.providerBilling='Local refund does not establish a provider refund.';addActivity(state,'Prospect search needs attention',current.error,'Reviewer',{prospectSearchId:run.id});});
      }
    })();
    return {id:run.id,jobId,completion};
  };
  return {start};
}
