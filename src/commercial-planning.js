export const commercialPlanningFields = [
  {key:'monetizationModel',label:'Monetization model',help:'Describe how this business earns revenue. Record only owner-supplied planning information.'},
  {key:'pricingFramework',label:'Pricing framework',help:'Record the intended pricing or quotation structure. Customer quotes still require separate review.'},
  {key:'targetContractValue',label:'Target contract value',help:'Include currency, range and per-order or program basis when known. This is an internal target, not a quoted price.'},
];
export const commercialIntakeFields=commercialPlanningFields.map(({key})=>'commercial.'+key);
export const commercialIntakeKey=field=>commercialIntakeFields.includes(field)?field.slice('commercial.'.length):null;
export function withoutCommercialPlan(commercial){
  if(!commercial)return commercial;
  const privateKeys=new Set(commercialPlanningFields.map(({key})=>key));
  return Object.fromEntries(Object.entries(commercial).filter(([key])=>!privateKeys.has(key)));
}
// Intake/export retain planning inputs; outbound copy needs only the established
// supplier brief. Never forward the new internal targets through that path.
export function outreachResearchBrief(brief) {
  return {...brief,commercial:withoutCommercialPlan(brief.commercial),...(Array.isArray(brief.fieldConfidence)?{fieldConfidence:brief.fieldConfidence.filter(row=>!commercialIntakeFields.includes(row.field))}:{})};
}
