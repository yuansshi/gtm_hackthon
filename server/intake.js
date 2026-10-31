// Deliberately bounded local extraction. No model or external service is used.
import {commercialPlanningFields,commercialIntakeFields} from '../src/commercial-planning.js';
import {businesses} from '../src/businesses.js';
import {productIntakeFields,isProductIntakeField,capabilityIntakeKey} from '../src/product-intake.js';
export const intakeFields = [...new Set(['industries', 'regions', 'segments', 'roles', 'motion', 'naics', 'headcount', 'revenue', 'triggers', 'referenceWins', 'exclusions', 'excludedDomains',...commercialIntakeFields,...businesses.flatMap(b=>productIntakeFields(b).map(f=>f.field))])];
export const arrayFields = ['segments', 'roles'];
export function validIntakeValue(field, value,businessId) {
  if (!intakeFields.includes(field)) return false;
  if(isProductIntakeField(field))return typeof value==='string'&&!!value.trim()&&value.length<=3000&&(!capabilityIntakeKey(field)||productIntakeFields(businesses.find(b=>b.id===businessId)).some(f=>f.field===field));
  if(commercialIntakeFields.includes(field))return typeof value==='string'&&!!value.trim()&&value.length<=600;
  if (arrayFields.includes(field)) return Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every(v => typeof v === 'string' && v.trim() && v.length <= 200);
  if (typeof value !== 'string' || !value.trim() || value.length > 3000) return false;
  return field !== 'motion' || ['oem', 'replacement', 'channel'].includes(value);
}
const positiveMatch = (input, expression) => {
  for (const match of input.matchAll(expression)) {
    const before = input.slice(Math.max(0, match.index - 35), match.index);
    if (!/(?:\bnot|\bno|\bexclude|\bexcluding|\bexcept|\bavoid|don't|do not)\s+(?:the\s+)?$/i.test(before)) return match;
  }
  return null;
};
const escaped=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// Full labeled value, or one complete unlabeled source clause. Never let a
// model cherry-pick a number from the supplied qualification text.
export function productValueSupported(field,value,evidence,message,businessId){
  const definition=productIntakeFields(businesses.find(b=>b.id===businessId)).find(f=>f.field===field);
  if(!definition)return false;
  const literal=text=>text.replace(/\s+/g,' ').trim();
  if(literal(value)!==literal(evidence))return false;
  const clauses=message.split(/[;\r\n]/).map(v=>v.trim()).filter(Boolean);
  const label=new RegExp('^'+escaped(definition.label)+'[^\\S\\r\\n]*[:=][^\\S\\r\\n]*(.*)$','i');
  const matches=clauses.map(clause=>clause.match(label)).filter(Boolean);
  if(matches.length){const values=[...new Set(matches.map(m=>literal(m[1])).filter(Boolean))];return values.length===1&&values[0]===literal(value);}
  const labels=[...commercialPlanningFields,...businesses.flatMap(productIntakeFields)].map(f=>f.label);
  const anyLabel=new RegExp('^(?:'+[...new Set(labels)].map(escaped).join('|')+')[^\\S\\r\\n]*[:=]','i');
  return clauses.some(clause=>!anyLabel.test(clause)&&literal(clause)===literal(value));
}
export function localIntake(message,businessId) {
  const suggestions = []; const questions = [];
  const add = (field, value, evidence) => suggestions.push({ field, value, confidence: 1, basis: 'user_input', evidence });
  const allLabels=[...commercialPlanningFields,...businesses.flatMap(productIntakeFields)].map(f=>f.label);
  const labeledLine=new RegExp('^[^\\S\\r\\n]*(?:'+[...new Set(allLabels)].map(escaped).join('|')+')[^\\S\\r\\n]*[:=]','i');
  // Product/price statements are not buyer geography, employee or motion criteria.
  const targetMessage=message.split(/[;\r\n]/).filter(line=>!labeledLine.test(line)).join('\n');
  const regions = [
    ['United States', /United States|\bUSA?\b|\bU\.S\.(?:A\.)?/g],
    ['Canada', /\bCanada\b/gi], ['Mexico', /\bMexico\b/gi],
  ].map(([value, regex]) => ({ value, match: positiveMatch(targetMessage, regex) })).filter(r => r.match);
  if (regions.length) add('regions', regions.map(r => r.value).join(', '), regions.map(r => r.match[0]).join(' / '));
  const oem = positiveMatch(targetMessage, /\bOEMs?\b|equipment manufacturers?/gi);
  if (oem) { add('segments', ['Equipment manufacturer (OEM)'], oem[0]); add('motion', 'oem', oem[0]); }
  const headcount = targetMessage.match(/\b(\d[\d,]*\s*(?:-|to|–)\s*\d[\d,]*)\s*(?:employees|people)\b/i);
  if (headcount) {
    const range = headcount[1].replaceAll(',', '').split(/\s*(?:-|to|–)\s*/).map(Number);
    if (range[0] <= range[1]) add('headcount', headcount[0], headcount[0]);
    else questions.push('The employee range is reversed. What are the minimum and maximum?');
  }
  const codes = targetMessage.match(/\b(?:NAICS|SIC)\s*(?:codes?\s*)?[:=]?\s*(\d{4,6}(?:\s*,\s*\d{4,6})*)\b/i);
  if (codes) add('naics', codes[0], codes[0]);
  const domains = targetMessage.match(/(?:exclude domains?|excluded domains?)\s*[:=]\s*([a-z0-9.,\-\s]+)/i);
  if (domains) {
    const values = domains[1].split(/[\s,]+/).filter(d => /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(d));
    if (values.length) add('excludedDomains', values.join(', '), domains[0]);
  }
  const labeledFields=[...commercialPlanningFields.map(({key,label})=>({field:'commercial.'+key,label,maxLength:600})),...productIntakeFields(businesses.find(b=>b.id===businessId))];
  for(const {field,label,maxLength} of labeledFields){
    const expression=new RegExp('(?:^|[;\\n])[^\\S\\r\\n]*'+escaped(label)+'[^\\S\\r\\n]*[:=][^\\S\\r\\n]*([^;\\r\\n]+)','gi');
    const matches=[...message.matchAll(expression)],values=[...new Set(matches.map(match=>match[1].trim()))];
    if(values.length>1){questions.push(`Multiple ${label.toLowerCase()} values were supplied. Reconcile them in the form.`);continue;}
    if(values[0]?.length>maxLength){questions.push(`Keep ${label.toLowerCase()} within ${maxLength} characters; no partial value was extracted.`);continue;}
    if(values[0])add(field,values[0],values[0]);
  }
  if (!regions.length) questions.push('Which countries should this campaign target?');
  if (!oem) questions.push('Which buyer segment and sales motion should the campaign use?');
  if (!suggestions.length) questions.push('Use explicit product/capability labels or the detailed form. Reference wins and qualification information still need your review.');
  return { summary: `${suggestions.length} explicit field suggestions extracted locally.`, suggestions, questions,
    caveats: ['Local extraction supports territory, OEM motion, employee ranges, explicit NAICS/SIC codes, excluded domains, and explicitly labeled commercial, product and business-specific capability inputs.', 'Extraction confidence describes matching your words, not verification of an account, specification, price or buying intent. Accepted capability values remain Unconfirmed.'] };
}
