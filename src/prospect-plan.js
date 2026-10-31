const applications={
  allco:{truck:'mining truck equipment manufacturer',excavator:'excavator equipment manufacturer',crusher:'crusher equipment manufacturer',handling:'forklift material handling equipment manufacturer',custom:'industrial equipment original equipment manufacturer'},
  huasheng:{cone:'cone crusher manufacturer',jaw:'jaw crusher manufacturer',gyratory:'gyratory crusher manufacturer',impact:'impact crusher manufacturer',mill:'grinding mill equipment manufacturer',shredder:'industrial shredder manufacturer'},
};
const normalized=value=>String(value||'').replace(/\s+/g,' ').trim();
export function excludedDomains(value) {
  return [...new Set(String(value||'').toLowerCase().split(/[\s,;]+/).map(value=>value.replace(/^www\./,'')).filter(value=>/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(value)))];
}
export const matchesExcludedDomain=(domain,exclusions)=>exclusions.some(excluded=>domain===excluded||domain.endsWith('.'+excluded));
export function buildProspectPlan(state,selected,expansionId) {
  if(!state.approved)throw new Error('Approve the current profile before searching for prospects.');
  if(!/united states|\busa?\b/i.test(state.icp.regions)||!state.icp.segments.some(segment=>/OEM|manufacturer/i.test(segment)))throw new Error('Prospect search currently supports approved US equipment OEM campaigns.');
  if(!Array.isArray(selected)||selected.length<1||selected.length>2||new Set(selected).size!==selected.length||selected.some(family=>!applications[state.businessId]?.[family]||!state.productFamilies.includes(family)))throw new Error('Choose one or two product families in this business’s approved campaign.');
  const productFamilies=[...selected].sort();const industries=normalized(state.icp.industries).slice(0,160);
  let expansion;
  if(expansionId!==undefined&&expansionId!==''){
    expansion=acceptedExpansions(businessById(state.businessId),state).find(item=>item.id===expansionId);
    if(!expansion)throw new Error('Choose a segment accepted in this business’s current approved profile.');
  }
  return {version:expansion?2:1,productFamilies,territory:'United States',buyerType:'OEM',...(expansion?{expansion:{id:expansion.id,name:expansion.name,source:expansion.source,adjusted:!!expansion.adjusted}}:{}),queries:productFamilies.map(family=>normalized(`United States ${applications[state.businessId][family]} ${industries}${expansion?' applications for '+expansion.name:''} official company products`)),maximumDomains:3,maximumPagesPerDomain:2};
}
import {businessById} from './businesses.js';
import {acceptedExpansions} from './expansion-review.js';
