export const companyFieldLabels={headquarters:'Headquarters',employees:'Employee size',industry:'Industry',classification:'NAICS / SIC',revenue:'Revenue'};
export const hqCorroborated=(headquarters,asOf=Date.now())=>!!headquarters?.corroboration&&Number.isFinite(Date.parse(headquarters.corroboration.checkedAt))&&Date.parse(headquarters.corroboration.checkedAt)<=asOf&&asOf-Date.parse(headquarters.corroboration.checkedAt)<=30*86400000;
export const companyEvidenceKey=lead=>JSON.stringify({domain:lead.domain,facts:lead.facts,source:lead.source,contactSource:lead.contactSource,sourceIntakeId:lead.sourceIntakeId,evidenceNeedsReview:!!lead.evidenceNeedsReview});
export const draftCompanyEvidenceCurrent=(draft,lead)=>!draft?.linkedCompanyReviewId||(lead?.companyProfile?.status==='reviewed'&&lead.companyProfile.id===draft.linkedCompanyReviewId&&!lead.companyProfile.processingRestricted&&hqCorroborated(lead.companyProfile.fields.headquarters));
export function employeeRange(value){
  if(typeof value!=='string')return null;
  const clean=value.replaceAll(',','').replace(/employees|people/gi,'').trim();
  const match=clean.match(/^(\d+)\s*(?:[-–—]|to)\s*(\d+)$/i),open=clean.match(/^(\d+)\s*\+$/),exact=clean.match(/^\d+$/);
  const range=match?[Number(match[1]),Number(match[2])]:open?[Number(open[1]),Infinity]:exact?[Number(clean),Number(clean)]:null;
  return range&&range[0]>=0&&range[0]<=range[1]&&range[0]<=100000000&&(range[1]===Infinity||range[1]<=100000000)?range:null;
}
export function companyComparison(profile,icp){
  const fields=profile?.fields||{};const target=employeeRange(icp?.headcount||''),reported=employeeRange(fields.employees?.range||'');
  const count=fields.employees?.count;
  const conflicting=reported&&Number.isFinite(count)&&(count<reported[0]||count>reported[1]);
  let employeeStatus='unknown',employeeReason='Employee criteria or vendor range is not established.';
  if(target&&reported&&!conflicting){employeeStatus=reported[1]<target[0]||reported[0]>target[1]?'outside':reported[0]>=target[0]&&reported[1]<=target[1]?'within':'overlap';employeeReason={outside:'Vendor range does not overlap the approved target.',within:'Vendor range is within the target; factual size remains unverified.',overlap:'Ranges partially overlap; confirm actual company size.'}[employeeStatus];}
  else if(conflicting)employeeReason='Vendor count and range conflict; confirm size before qualification.';
  else if(icp?.headcount&&!target)employeeReason='This target format is unsupported for automatic comparison.';
  const hq=fields.headquarters;const us=/united states|\busa?\b/i.test(icp?.regions||'');
  const headquartersStatus=us&&hq?.countryCode&&!hq.countryConflict?(hq.countryCode==='US'?'within':'outside'):'unknown';
  return [
    {field:'employees',label:'Employee size',target:icp?.headcount||'No target supplied',reported:fields.employees?.range||(Number.isFinite(count)?String(count):'Unknown'),status:employeeStatus,reason:employeeReason},
    {field:'headquarters',label:'HQ country',target:icp?.regions||'No target supplied',reported:hq?.country||hq?.countryCode||'Unknown',status:headquartersStatus,reason:headquartersStatus==='outside'?'Reported HQ is outside the target; operating location may differ. This gates qualification only if explicitly selected.':hqCorroborated(hq)?'Company-source quote supports the HQ city/country; other address fields remain vendor-reported.':'Vendor location is not independent headquarters verification.'},
    {field:'classification',label:'Classification',target:icp?.naics||'No target supplied',reported:fields.classification?.naics?.join(', ')||fields.classification?.sic?.join(', ')||'Unknown',status:'unknown',reason:'Classification edition and account mapping need confirmation; codes are not silently treated as a match.'},
    {field:'revenue',label:'Revenue',target:icp?.revenue||'No target supplied',reported:fields.revenue?.annual??fields.revenue?.estimated??'Unknown',status:'unknown',reason:'Vendor revenue currency/basis is not established for automatic comparison.'},
  ];
}
export const companyHoldReasons=(lead,state)=>lead.companyProfile?.status==='reviewed'?[
  ...(lead.companyProfile.processingRestricted?['Vendor-company data processing is restricted; withdraw this company profile before using it.']:[]),
  ...(lead.companyProfile.evidenceKey!==companyEvidenceKey(lead)?['Company source context changed. Refresh/review or withdraw the company profile.']:[]),
  ...(!Number.isFinite(Date.parse(lead.companyProfile.checkedAt))||Date.parse(lead.companyProfile.checkedAt)>Date.now()||Date.now()-Date.parse(lead.companyProfile.checkedAt)>30*86400000?['Company research is stale or undated. Refresh/review or withdraw the company profile.']:[]),
  ...companyComparison(lead.companyProfile,state.icp).filter(row=>row.status==='outside'&&(row.field!=='headquarters'||lead.companyProfile.enforceHeadquartersCountry)).map(row=>`${row.label}: ${row.reason}`),
]:[];
export function reviewedCompanyContext(lead){const p=lead.companyProfile;return p?{id:p.id,status:p.status,fields:p.fields,processingRestricted:!!p.processingRestricted}:null;}
