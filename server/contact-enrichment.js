import { AppError, digest, now, addActivity } from './store.js';
import { costs } from './catalog.js';
import { validContactVerification } from '../src/contact-evidence.js';
import { emailForDomain } from './hunter.js';
import { invalidateAccountDrafts, suppressedContact } from './review-policy.js';

const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const contactEvidenceDigest=lead=>digest({domain:lead.domain,facts:lead.facts,source:lead.source,sourceIntakeId:lead.sourceIntakeId,evidenceNeedsReview:!!lead.evidenceNeedsReview});
export const mergeAccountPeople=(primary=[],vendor=[])=>[...new Map([...primary,...vendor].map(person=>[`${person.name}|${person.source}`,person])).values()];
export function markContactProjection(store,id,projected) {
  const ids=new Set((projected.contactReviews||[]).map(review=>review.id));
  if(!(store.read(id).contactReviews||[]).some(review=>ids.has(review.id)&&review.graphStatus!=='synced'))return;
  store.mutate(id,state=>{for(const review of state.contactReviews||[])if(ids.has(review.id))review.graphStatus='synced';});
}
export function createContactEnrichment({store,graph,competitors,provider,snapshot,profileDigest,requireEligible}) {
  const leadFor=(state,leadId)=>{const lead=state.leads.find(lead=>lead.id===leadId);if(!lead)throw new AppError(404,'Account not found in this business.','lead_not_found');return lead;};
  const runFor=(state,runId,leadId)=>{const run=(state.enrichmentRuns||[]).find(run=>run.id===runId&&run.leadId===leadId);if(!run)throw new AppError(404,'Contact research not found for this account and business.','enrichment_run_not_found');return run;};
  const checkContext=(state,lead,run)=>{
    if(!state.approved)throw new AppError(409,'Approve the current profile before vendor contact research.','profile_approval_required');requireEligible(lead,state);
    if(run&&(run.profileHash!==profileDigest(state)||run.evidenceHash!==contactEvidenceDigest(lead)))throw new AppError(409,'Account or profile evidence changed. Start fresh contact research.','stale_enrichment_context');
  };
  const fresh=run=>{if(Date.now()-Date.parse(run.completedAt)>86400000||!Number.isFinite(Date.parse(run.completedAt)))throw new AppError(409,'These contact results are over 24 hours old. Run fresh contact research.','enrichment_result_expired');};
  const candidateFor=(state,leadId,searchRunId,candidateId)=>{
    const run=runFor(state,searchRunId,leadId);if(run.kind!=='search'||run.status!=='completed')throw new AppError(409,'Complete contact search before choosing an address.','contact_search_required');
    checkContext(state,leadFor(state,leadId),run);fresh(run);
    const candidate=run.result.candidates.find(candidate=>candidate.id===candidateId);if(!candidate)throw new AppError(404,'Choose a contact returned by this account’s search.','candidate_not_found');
    if(candidate.restricted||suppressedContact(state,candidate.email))throw new AppError(409,'Processing of this address is restricted. Choose another contact.','contact_suppressed');
    return {run,candidate};
  };
  const begin=(id,leadId,input,kind,extra={})=>{
    if(!input.acknowledgedExternalProcessing)throw new AppError(400,'Confirm sending this account’s domain or selected address to Hunter.','external_processing_review_required');
    if(!uuid(input.requestId))throw new AppError(400,'A valid request ID is required.','invalid_request');
    const state=store.read(id);const lead=leadFor(state,leadId);const requestHash=digest({kind,leadId,...extra});
    const previous=(state.enrichmentRuns||[]).find(run=>run.id===input.requestId);
    if(previous){if(previous.requestHash!==requestHash)throw new AppError(409,'This request ID belongs to different contact work.','enrichment_request_conflict');if(previous.status==='running')throw new AppError(409,'This contact request is already running. Wait for its result.','enrichment_in_progress');return {previous};}
    checkContext(state,lead);if(state.revision!==input.revision)throw new AppError(409,'Refresh this workspace before vendor contact research.','revision_conflict');provider.requireConfigured();
    if((state.enrichmentRuns||[]).some(run=>['running','pending'].includes(run.status)))throw new AppError(409,'Finish the current vendor contact request before starting another.','enrichment_in_progress');
    const reservation=store.reserve(id,'vendor_'+kind,costs.enrichment,leadId);
    const run={id:input.requestId,leadId,businessId:id,kind,domain:lead.domain.replace(/^www\./,''),requestHash,profileHash:profileDigest(state),evidenceHash:contactEvidenceDigest(lead),status:'running',startedAt:now(),reservation,requests:0,...extra};
    store.mutate(id,current=>{current.enrichmentRuns||=[];current.enrichmentRuns.unshift(run);const entry=current.wallet.ledger.find(entry=>entry.id===reservation);entry.provider='Hunter';entry.providerBilling='Local credits are separate from Hunter charges.';entry.externalStatus='provider_requested';entry.enrichmentRunId=run.id;addActivity(current,kind==='search'?'Vendor contact search started':'Vendor email verification started',`${lead.name}; Hunter ${kind}. Explicit external-processing confirmation recorded. No recipient or outreach approval changed.`,'Enrichment agent',{leadId,enrichmentRunId:run.id});});
    return {run,lead};
  };
  const fail=(id,run,error)=>{
    store.settle(id,run.reservation,false);
    store.mutate(id,state=>{
      const current=runFor(state,run.id,run.leadId);current.status='failed';current.error=error instanceof AppError?error.message:'Vendor contact request failed. Local credits were refunded; external billing may be unknown.';current.errorCode=error instanceof AppError?error.code:'enrichment_request_failed';current.completedAt=now();
      const entry=state.wallet.ledger.find(entry=>entry.id===run.reservation);entry.externalStatus='provider_unknown';
      if(error.code==='contact_processing_restricted'&&run.email){state.contactSuppressions||=[];const addressHash=digest({businessId:id,email:run.email});if(!state.contactSuppressions.some(item=>item.addressHash===addressHash))state.contactSuppressions.push({addressHash,at:now(),reason:'Hunter processing restriction'});
        for(const record of state.enrichmentRuns||[])for(const candidate of record.result?.candidates||[])if(candidate.email===run.email)candidate.restricted=true;
        for(const lead of state.leads)if(lead.contact?.email===run.email){lead.contact.processingRestricted=true;const ids=invalidateAccountDrafts(state,lead.id,{reason:'contact_processing_restricted'});for(const draft of state.drafts.filter(draft=>ids.includes(draft.id)))draft.recipient='';}
      }
      addActivity(state,'Vendor contact work needs attention',`${leadFor(state,run.leadId).name}; ${current.error}`,'Reviewer',{leadId:run.leadId,enrichmentRunId:run.id});
    });
  };
  const finish=(id,run,result)=>{
    store.mutate(id,state=>{
      const lead=leadFor(state,run.leadId);checkContext(state,lead,run);const current=runFor(state,run.id,run.leadId);
      if(run.kind==='search')for(const candidate of result.candidates)if(suppressedContact(state,candidate.email))candidate.restricted=true;
      current.result=result;current.status=result.pending?'pending':'completed';current.completedAt=result.pending?null:now();
      const entry=state.wallet.ledger.find(entry=>entry.id===run.reservation);entry.externalStatus=result.pending?'verification_pending':'provider_response';entry.providerRequests=current.requests;
      if(!result.pending)entry.status='consumed';
      addActivity(state,result.pending?'Email verification pending':run.kind==='search'?'Vendor contacts ready for review':'Vendor verification ready',`${lead.name}; ${result.pending?'Hunter returned 202. Check this result explicitly; no automatic replay.':'No contact was selected and no message was approved.'}`,'Enrichment agent',{leadId:lead.id,enrichmentRunId:run.id});
    });
  };
  const execute=async(id,run)=>{
    store.mutate(id,state=>{const current=runFor(state,run.id,run.leadId);current.requests++;state.wallet.ledger.find(entry=>entry.id===run.reservation).providerRequests=current.requests;});
    try {const result=run.kind==='search'?await provider.search(run.domain):await provider.verify(run.email);finish(id,run,result);}catch(error){fail(id,run,error);}
    return {...snapshot(id),activeEnrichmentRunId:run.id};
  };
  const search=async(id,leadId,input)=>{const started=begin(id,leadId,input,'search');return started.previous?{...snapshot(id),activeEnrichmentRunId:started.previous.id}:execute(id,started.run);};
  const verify=async(id,leadId,input)=>{
    const state=store.read(id);const previous=(state.enrichmentRuns||[]).find(run=>run.id===input.requestId);
    if(previous){const started=begin(id,leadId,input,'verify',{searchRunId:input.searchRunId,candidateId:input.candidateId,email:previous.email});return {...snapshot(id),activeEnrichmentRunId:started.previous.id};}
    const {candidate}=candidateFor(state,leadId,input.searchRunId,input.candidateId);
    if(!candidate.sources.length)throw new AppError(409,'Choose a contact with public evidence links before verification.','contact_evidence_required');
    const started=begin(id,leadId,input,'verify',{searchRunId:input.searchRunId,candidateId:input.candidateId,email:candidate.email});return execute(id,started.run);
  };
  const poll=async(id,leadId,runId,input)=>{
    if(!input.acknowledgedExternalProcessing)throw new AppError(400,'Confirm checking the selected address with Hunter.','external_processing_review_required');
    const state=store.read(id);const run=runFor(state,runId,leadId);
    if(['completed','failed','cancelled'].includes(run.status))return {...snapshot(id),activeEnrichmentRunId:run.id};
    if(run.status!=='pending'||run.kind!=='verify')throw new AppError(409,'This verification request is already running.','enrichment_in_progress');
    try {checkContext(state,leadFor(state,leadId),run);candidateFor(state,leadId,run.searchRunId,run.candidateId);if(Date.now()-Date.parse(run.startedAt)>86400000)throw new AppError(409,'This pending request expired. Start a fresh search.','enrichment_result_expired');provider.requireConfigured();}catch(error){fail(id,run,error);return {...snapshot(id),activeEnrichmentRunId:run.id};}
    store.mutate(id,current=>{runFor(current,run.id,leadId).status='running';},input.revision);
    return execute(id,run);
  };
  const cancel=(id,leadId,runId,input)=>{
    const initial=store.read(id);const run=runFor(initial,runId,leadId);
    if(run.status==='cancelled')return snapshot(id);
    if(run.status!=='pending')throw new AppError(409,'Only a pending verification can be closed locally.','enrichment_in_progress');
    store.mutate(id,state=>{
      const current=runFor(state,runId,leadId);current.status='cancelled';current.completedAt=now();current.error='Closed locally. Reserved local credits refunded; Hunter processing and charges are not cancelled.';
      const entry=state.wallet.ledger.find(entry=>entry.id===current.reservation);if(entry.status==='reserved'){state.wallet.credits+=entry.credits;entry.status='refunded';}entry.externalStatus='provider_unknown';
      addActivity(state,'Pending vendor check closed',`${leadFor(state,leadId).name}; local credit reservation refunded. This does not cancel vendor processing or charges.`,'You',{leadId,enrichmentRunId:runId});
    },input.revision);return snapshot(id);
  };
  const apply=async(id,leadId,input)=>{
    if(!uuid(input.requestId)||!input.acknowledged)throw new AppError(400,'Confirm the contact, role, sources, and changed message recipients.','contact_review_required');
    const initial=store.read(id);const lead=leadFor(initial,leadId);const reviewHash=digest({leadId,searchRunId:input.searchRunId,candidateId:input.candidateId,verificationRunId:input.verificationRunId,acknowledgedUncertain:input.acknowledgedUncertain});
    const previous=(initial.contactReviews||[]).find(review=>review.id===input.requestId);
    if(previous){if(previous.reviewHash!==reviewHash)throw new AppError(409,'This review ID belongs to a different contact decision.','contact_review_conflict');}
    else {
      const {candidate}=candidateFor(initial,leadId,input.searchRunId,input.candidateId);
      if(!emailForDomain(candidate.email,lead.domain.replace(/^www\./,''))||!candidate.sources.length)throw new AppError(409,'Choose a same-domain contact with public evidence links.','contact_evidence_required');
      const verification=runFor(initial,input.verificationRunId,leadId);
      if(verification.kind!=='verify'||verification.status!=='completed'||verification.candidateId!==candidate.id||verification.searchRunId!==input.searchRunId||verification.result.email!==candidate.email)throw new AppError(409,'Complete verification for this exact contact before selecting it.','contact_verification_required');
      checkContext(initial,lead,verification);fresh(verification);const result={...verification.result,providerValid:validContactVerification(verification.result)};
      if(['invalid','disposable','webmail'].includes(result.status)||result.disposable||result.webmail)throw new AppError(409,'This verifier result cannot be used as a business contact.','contact_not_usable');
      if(!result.providerValid&&!input.acknowledgedUncertain)throw new AppError(400,'Acknowledge the uncertain or accept-all result. It does not establish deliverability.','uncertain_contact_review_required');
      store.mutate(id,state=>{
        const current=leadFor(state,leadId);checkContext(state,current,verification);
        const contact={email:candidate.email,name:candidate.name,role:candidate.role,emailKind:candidate.addressType==='personal'?'Vendor-returned personal business address':'Vendor-returned company address',linkedIn:candidate.linkedIn,source:candidate.sources[0].url,sources:candidate.sources,mailboxStatus:result.providerValid?'provider_valid':result.acceptAll?'accept_all':'unknown',mxStatus:result.mxFound?'found':'not_found',mxVerificationProvider:'Hunter',verificationProvider:'Hunter',verification:result,checkedAt:result.checkedAt,roleMatch:'Owner-reviewed persona relevance; buying authority unverified',selectedReviewId:input.requestId,provenance:'hunter_reviewed',enrichmentNote:'Hunter reports dated email checks. A valid result does not establish inbox delivery, profile ownership, purchasing authority, or consent to outreach.'};
        current.contact=contact;
        if(candidate.name){current.vendorPeople||=[];const person={name:candidate.name,role:candidate.role||'Role unknown',relevance:'Vendor-returned role reviewed for persona relevance; buying responsibility is unverified.',source:candidate.sources[0].url,provenance:'hunter_reviewed',vendorCandidateId:candidate.id,reviewedAt:now()};current.vendorPeople=mergeAccountPeople(current.vendorPeople,[person]);current.people=mergeAccountPeople(current.people,current.vendorPeople);}
        const ids=invalidateAccountDrafts(state,leadId,{reason:'account_contact_changed'});
        for(const draft of state.drafts.filter(draft=>ids.includes(draft.id))){draft.recipient=draft.channel==='email'?contact.email:contact.linkedIn||'';draft.sources=[...new Set([...(draft.sources||[]),...candidate.sources.map(source=>source.url)])];}
        state.contactReviews||=[];state.contactReviews.unshift({id:input.requestId,reviewHash,leadId,businessId:id,searchRunId:input.searchRunId,candidateId:candidate.id,verificationRunId:input.verificationRunId,acknowledgedUncertain:input.acknowledgedUncertain,reviewedAt:now(),graphStatus:'pending'});
        addActivity(state,'Vendor contact selected',`${current.name}; owner-reviewed contact and dated Hunter checks. ${ids.length} editable unsent message(s) received new recipient/version review. No buying authority or message delivery verified.`,'You',{leadId,contactReviewId:input.requestId});
      },input.revision);
    }
    const saved=store.read(id);const review=saved.contactReviews.find(review=>review.id===input.requestId);
    if(review.graphStatus!=='synced'){try{await graph.sync(saved,competitors[id]);markContactProjection(store,id,saved);}catch{/* Durable decision can repair projection without reapplying contact or approval invalidation. */}}
    return {...snapshot(id),activeContactReviewId:input.requestId};
  };
  return {search,verify,poll,cancel,apply};
}
