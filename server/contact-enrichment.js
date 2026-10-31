import { AppError, digest, now, addActivity } from './store.js';
import { costs } from './catalog.js';
import { validContactVerification } from '../src/contact-evidence.js';
import { emailForDomain } from './hunter.js';
import { invalidateAccountDrafts, suppressedContact } from './review-policy.js';
import { publicSourceUrl, readPublicSource } from './public-source.js';
import { companyFieldLabels, companyEvidenceKey } from '../src/company-evidence.js';

const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const contactEvidenceDigest=lead=>digest({domain:lead.domain,facts:lead.facts,source:lead.source,contactSource:lead.contactSource,sourceIntakeId:lead.sourceIntakeId,evidenceNeedsReview:!!lead.evidenceNeedsReview});
export const mergeAccountPeople=(primary=[],vendor=[])=>[...new Map([...primary,...vendor].map(person=>[`${person.name}|${person.source}`,person])).values()];
export function markContactProjection(store,id,projected) {
  const ids=new Set((projected.contactReviews||[]).map(review=>review.id));
  if(!(store.read(id).contactReviews||[]).some(review=>ids.has(review.id)&&review.graphStatus!=='synced'))return;
  store.mutate(id,state=>{for(const review of state.contactReviews||[])if(ids.has(review.id))review.graphStatus='synced';});
}
export function markCompanyProjection(store,id,projected){const ids=new Set((projected.companyReviews||[]).map(review=>review.id));if(!(store.read(id).companyReviews||[]).some(review=>ids.has(review.id)&&review.graphStatus!=='synced'))return;store.mutate(id,state=>{for(const review of state.companyReviews||[])if(ids.has(review.id))review.graphStatus='synced';});}
export function createContactEnrichment({store,graph,competitors,provider,snapshot,profileDigest,requireEligible,exclusionReason,readSource=readPublicSource}) {
  const leadFor=(state,leadId)=>{const lead=state.leads.find(lead=>lead.id===leadId);if(!lead)throw new AppError(404,'Account not found in this business.','lead_not_found');return lead;};
  const runFor=(state,runId,leadId)=>{const run=(state.enrichmentRuns||[]).find(run=>run.id===runId&&run.leadId===leadId);if(!run)throw new AppError(404,'Contact research not found for this account and business.','enrichment_run_not_found');return run;};
  const checkContext=(state,lead,run,kind=run?.kind)=>{
    if(!state.approved)throw new AppError(409,'Approve the current profile before vendor research.','profile_approval_required');requireEligible(kind==='company'?{...lead,companyProfile:null}:lead,state);
    if(kind==='company'&&(state.companyRestrictions||[]).some(item=>item.domainHash===digest({businessId:state.businessId,domain:lead.domain.replace(/^www\./,'')})))throw new AppError(409,'Vendor processing of this company domain is restricted.','company_processing_restricted');
    if(run&&(run.profileHash!==profileDigest(state)||run.evidenceHash!==contactEvidenceDigest(lead)))throw new AppError(409,'Account or profile evidence changed. Start fresh vendor research.','stale_enrichment_context');
  };
  const fresh=run=>{if(Date.now()-Date.parse(run.completedAt)>86400000||!Number.isFinite(Date.parse(run.completedAt)))throw new AppError(409,'These vendor results are over 24 hours old. Run fresh research.','enrichment_result_expired');};
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
    if(previous){if(previous.requestHash!==requestHash)throw new AppError(409,'This request ID belongs to different contact work.','enrichment_request_conflict');if(previous.status==='running')throw new AppError(409,'This vendor request is already running. Wait for its result.','enrichment_in_progress');return {previous};}
    checkContext(state,lead,undefined,kind);if(state.revision!==input.revision)throw new AppError(409,'Refresh this workspace before vendor research.','revision_conflict');provider.requireConfigured();
    if(kind==='company'&&(state.enrichmentRuns||[]).filter(run=>run.kind==='company').length>=30)throw new AppError(409,'This prototype reached its 30-company-lookup history limit. Review/export this campaign before more company work.','company_history_full');
    if((state.enrichmentRuns||[]).some(run=>['running','pending'].includes(run.status)))throw new AppError(409,'Finish the current vendor contact request before starting another.','enrichment_in_progress');
    const reservation=store.reserve(id,'vendor_'+kind,costs.enrichment,leadId);
    const run={id:input.requestId,leadId,businessId:id,kind,domain:lead.domain.replace(/^www\./,''),requestHash,profileHash:profileDigest(state),evidenceHash:contactEvidenceDigest(lead),status:'running',startedAt:now(),reservation,requests:0,...extra};
    store.mutate(id,current=>{current.enrichmentRuns||=[];current.enrichmentRuns.unshift(run);const entry=current.wallet.ledger.find(entry=>entry.id===reservation);entry.provider='Hunter';entry.providerBilling='Local credits are separate from Hunter charges.';entry.externalStatus='provider_requested';entry.enrichmentRunId=run.id;addActivity(current,kind==='company'?'Company enrichment started':kind==='search'?'Vendor contact search started':'Vendor email verification started',`${lead.name}; Hunter ${kind}. Explicit external-processing confirmation recorded. No recipient or outreach approval changed.`,'Enrichment agent',{leadId,enrichmentRunId:run.id});});
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
      if(error.code==='company_processing_restricted'&&run.kind==='company'){state.companyRestrictions||=[];const domainHash=digest({businessId:id,domain:run.domain});if(!state.companyRestrictions.some(item=>item.domainHash===domainHash))state.companyRestrictions.push({domainHash,at:now(),reason:'Hunter company processing restriction'});const lead=leadFor(state,run.leadId);if(lead.companyProfile?.status==='reviewed'){lead.companyProfile.processingRestricted=true;const review=(state.companyReviews||[]).find(review=>review.id===lead.companyProfile.id);if(review)review.graphStatus='pending';lead.excludedReason=exclusionReason(lead,state);lead.selected=false;invalidateAccountDrafts(state,lead.id,{reason:'company_processing_restricted'});}}
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
      addActivity(state,run.kind==='company'?'Company data ready for review':result.pending?'Email verification pending':run.kind==='search'?'Vendor contacts ready for review':'Vendor verification ready',`${lead.name}; ${result.pending?'Hunter returned 202. Check this result explicitly; no automatic replay.':'No company field or contact was selected and no message was approved.'}`,'Enrichment agent',{leadId:lead.id,enrichmentRunId:run.id});
    });
  };
  const execute=async(id,run)=>{
    store.mutate(id,state=>{const current=runFor(state,run.id,run.leadId);current.requests++;state.wallet.ledger.find(entry=>entry.id===run.reservation).providerRequests=current.requests;});
    try {
      const result=run.kind==='company'?await provider.company(run.domain):run.kind==='search'?await provider.search(run.domain):await provider.verify(run.email);
      if(run.kind==='company'&&result.found){const lead=leadFor(store.read(id),run.leadId);const urls=[...new Set([lead.contactSource,lead.source].filter(Boolean))].slice(0,2);const fetched=await Promise.all(urls.map(async value=>{try{const url=publicSourceUrl(value,run.domain).href;const page=await readSource(url);publicSourceUrl(page.finalUrl||page.url,run.domain);if(page.url!==url||page.fetchStatus!=='reachable'||typeof page.text!=='string'||page.text.length<30||page.text.length>48000||!Number.isFinite(Date.parse(page.checkedAt))||Date.parse(page.checkedAt)>Date.now())throw Error('Invalid source');return {page,check:{url,status:'reachable',checkedAt:page.checkedAt,title:page.title}};}catch{return {check:{url:value,status:'failed',error:'source_unavailable'}};}}));result.sourcePages=fetched.flatMap(item=>item.page?[item.page]:[]);result.sourceChecks=fetched.map(item=>item.check);}
      finish(id,run,result);
    }catch(error){fail(id,run,error);}
    return {...snapshot(id),activeEnrichmentRunId:run.id};
  };
  const search=async(id,leadId,input)=>{const started=begin(id,leadId,input,'search');return started.previous?{...snapshot(id),activeEnrichmentRunId:started.previous.id}:execute(id,started.run);};
  const company=async(id,leadId,input)=>{const started=begin(id,leadId,input,'company');return started.previous?{...snapshot(id),activeEnrichmentRunId:started.previous.id}:execute(id,started.run);};
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
  const projectCompany=async id=>{const saved=store.read(id);try{await graph.sync(saved,competitors[id]);markCompanyProjection(store,id,saved);}catch{/* Company review is durable; graph query/replay can repair it. */}};
  const companyQuote=(result,evidence)=>{
    if(!evidence)return null;
    const page=result.sourcePages?.find(page=>page.url===evidence.url),hq=result.fields.headquarters;
    const normalize=value=>String(value||'').replace(/\s+/g,' ').trim();const quote=normalize(evidence.text),text=normalize(page?.text),city=normalize(hq.city).toLowerCase();
    const countryMatches=hq.countryCode==='US'?/united states|\bUSA\b|U\.S\.A\./i.test(quote):hq.country&&quote.toLowerCase().includes(hq.country.toLowerCase());
    if(!page||hq.countryConflict||!Number.isFinite(Date.parse(page.checkedAt))||Date.now()-Date.parse(page.checkedAt)>86400000||Date.parse(page.checkedAt)>Date.now()||quote.length<12||quote.length>600||!text.includes(quote)||!/\b(?:headquarters?|head office|corporate office)\b/i.test(quote)||!city||!quote.toLowerCase().includes(city)||!countryMatches)throw new AppError(409,'Choose an exact current company-source passage identifying headquarters, the returned city, and country. Other address fields remain vendor-reported.','headquarters_evidence_required');
    return {url:page.url,text:quote,checkedAt:page.checkedAt,contentHash:page.contentHash,scope:'Headquarters city and country only; interpretation reviewed by owner'};
  };
  const applyCompany=async(id,leadId,input)=>{
    if(!uuid(input.requestId)||!input.acknowledged||!input.acknowledgedEstimates)throw new AppError(400,'Review the company identity, selected fields, estimates, and qualification effects before applying.','company_review_required');
    const fields=[...new Set(input.fields||[])].sort();if(!fields.length||fields.length>5||fields.some(field=>!Object.hasOwn(companyFieldLabels,field)))throw new AppError(400,'Select supported company fields from this lookup.','invalid_company_fields');
    if(input.enforceHeadquartersCountry&&!fields.includes('headquarters'))throw new AppError(400,'Select headquarters before using its country to gate qualification.','invalid_company_fields');
    const hash=digest({action:'apply',leadId,runId:input.runId,fields,headquartersEvidence:input.headquartersEvidence||null,enforceHeadquartersCountry:!!input.enforceHeadquartersCountry});
    const initial=store.read(id),lead=leadFor(initial,leadId);const previous=(initial.companyReviews||[]).find(review=>review.id===input.requestId);
    if(previous&&previous.reviewHash!==hash)throw new AppError(409,'This company review ID belongs to different input.','company_review_conflict');
    if(!previous){const run=runFor(initial,input.runId,leadId);if(run.kind!=='company'||run.status!=='completed'||!run.result.found)throw new AppError(409,'Complete a matching company lookup before reviewing fields.','company_result_required');checkContext(initial,lead,run);fresh(run);
      const available=field=>{const value=run.result.fields[field];return field==='employees'?!!value?.range||value?.count!=null:field==='headquarters'?!!(value?.label||value?.city||value?.country):field==='industry'?!!(value?.label||value?.sector):field==='classification'?value?.naics.length||value?.naics2022.length||value?.sic.length:field==='revenue'?value?.annual!=null||value?.estimated!=null:false;};
      if(fields.some(field=>!available(field)))throw new AppError(400,'Do not select fields the vendor did not return. Unknowns remain unknown.','company_field_unavailable');
      if(input.headquartersEvidence&&!fields.includes('headquarters'))throw new AppError(400,'Select headquarters before corroborating its source.','invalid_company_fields');
      if(input.enforceHeadquartersCountry&&(!run.result.fields.headquarters.countryCode||run.result.fields.headquarters.countryConflict))throw new AppError(400,'A headquarters-country boundary requires a returned, nonconflicting country code.','invalid_company_fields');
      const corroboration=companyQuote(run.result,input.headquartersEvidence);
      store.mutate(id,state=>{const current=leadFor(state,leadId);checkContext(state,current,run);const selected=Object.fromEntries(fields.map(field=>[field,structuredClone(run.result.fields[field])]));if(corroboration)selected.headquarters.corroboration=corroboration;
        current.companyProfile={id:input.requestId,runId:run.id,domain:run.domain,provider:'Hunter',vendorName:run.result.name,indexedAt:run.result.indexedAt,checkedAt:run.result.checkedAt,reviewedAt:now(),reviewedBy:'You',status:'reviewed',fields:selected,evidenceKey:companyEvidenceKey(current),enforceHeadquartersCountry:!!input.enforceHeadquartersCountry,provenance:'owner_reviewed_vendor_company',independentlyVerified:false};
        current.excludedReason=exclusionReason(current,state);if(current.excludedReason)current.selected=false;
        state.companyReviews||=[];state.companyReviews.unshift({id:input.requestId,leadId,runId:run.id,action:'apply',reviewHash:hash,at:now(),fields,graphStatus:'pending'});invalidateAccountDrafts(state,leadId,{reason:'company_profile_changed'});addActivity(state,'Company data reviewed',`${current.name}; ${fields.map(field=>companyFieldLabels[field]).join(', ')}. Vendor estimates remain unverified; unsent approvals cleared.`,'You',{leadId,companyReviewId:input.requestId});
      },input.revision);
    }
    if(store.read(id).companyReviews.find(review=>review.id===input.requestId).graphStatus!=='synced')await projectCompany(id);return {...snapshot(id),activeCompanyReviewId:input.requestId};
  };
  const withdrawCompany=async(id,leadId,input)=>{
    if(!uuid(input.requestId)||!input.acknowledged)throw new AppError(400,'Confirm withdrawal of the reviewed company data.','company_review_required');
    const initial=store.read(id);leadFor(initial,leadId);const hash=digest({action:'withdraw',leadId,reviewId:input.reviewId});const previous=(initial.companyReviews||[]).find(review=>review.id===input.requestId);if(previous&&previous.reviewHash!==hash)throw new AppError(409,'This company review ID belongs to different input.','company_review_conflict');
    if(!previous)store.mutate(id,state=>{const lead=leadFor(state,leadId);if(lead.companyProfile?.id!==input.reviewId||lead.companyProfile.status!=='reviewed')throw new AppError(409,'The active company profile changed. Reload before withdrawing it.','stale_company_profile');lead.companyProfile.status='withdrawn';lead.companyProfile.withdrawnAt=now();lead.excludedReason=exclusionReason(lead,state);state.companyReviews||=[];state.companyReviews.unshift({id:input.requestId,leadId,action:'withdraw',profileId:input.reviewId,reviewHash:hash,at:now(),graphStatus:'pending'});invalidateAccountDrafts(state,leadId,{reason:'company_profile_changed'});addActivity(state,'Company data withdrawn',`${lead.name}; vendor company fields are no longer used for qualification. Contacts, sent history and prior receipts retained.`,'You',{leadId,companyReviewId:input.requestId});},input.revision);
    if(store.read(id).companyReviews.find(review=>review.id===input.requestId).graphStatus!=='synced')await projectCompany(id);return snapshot(id);
  };
  return {search,verify,poll,cancel,apply,company,applyCompany,withdrawCompany};
}
