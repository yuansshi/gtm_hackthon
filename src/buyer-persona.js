export const personaFields=[
  {key:'targetTitles',label:'Target job titles',help:'Comma-separated title phrases, for example Director of Engineering, Procurement Manager. These are research targets, not verified buyer roles.'},
  {key:'targetSeniority',label:'Target seniority',help:'Comma-separated seniority terms. Vendor wording is compared literally; rank, authority and equivalent titles are not inferred.'},
];
export const personaScope=icp=>({version:1,targetTitles:icp?.targetTitles||'',targetSeniority:icp?.targetSeniority||''});
const normalized=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
function compare(criteria,observed){
  if(!criteria.trim())return{criteria,observed,status:'not_specified',matchedPhrase:null};
  // Do not interpret negation, rank ranges, boolean expressions or wildcards.
  if(/\b(?:not|no|never|don['’]?t|exclude|except|avoid|without|above|below|least|most|or|and)\b|[+*<>|]/i.test(criteria))return{criteria,observed,status:'needs_review',matchedPhrase:null};
  const phrases=criteria.split(/[,;\n]/).map(p=>p.trim()).filter(Boolean);
  if(!phrases.length||phrases.length>20||phrases.some(p=>!normalized(p)))return{criteria,observed,status:'needs_review',matchedPhrase:null};
  const text=normalized(observed);
  if(!text||['unknown','not available','not specified','n a','undisclosed','none'].includes(text))return{criteria,observed,status:'unknown',matchedPhrase:null};
  const matchedPhrase=phrases.find(p=>(' '+text+' ').includes(' '+normalized(p)+' '))||null;
  return{criteria,observed,status:matchedPhrase?'phrase_overlap':'no_phrase_overlap',matchedPhrase};
}
export function comparePersona(candidate,scope){
  if(scope?.version!==1)return null;
  return{version:1,title:compare(scope.targetTitles||'',candidate?.role||''),seniority:compare(scope.targetSeniority||'',candidate?.seniority||'')};
}
export const personaComparisonLabels={not_specified:'Not specified',needs_review:'Criteria need review',unknown:'Vendor text unknown',phrase_overlap:'Phrase overlap',no_phrase_overlap:'No phrase overlap'};
