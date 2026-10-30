// Deliberately bounded local extraction. No model or external service is used.
export const intakeFields = ['industries', 'regions', 'segments', 'roles', 'motion', 'naics', 'headcount', 'revenue', 'triggers', 'referenceWins', 'exclusions', 'excludedDomains'];
export const arrayFields = ['segments', 'roles'];
export function validIntakeValue(field, value) {
  if (!intakeFields.includes(field)) return false;
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
export function localIntake(message) {
  const suggestions = []; const questions = [];
  const add = (field, value, evidence) => suggestions.push({ field, value, confidence: 1, basis: 'user_input', evidence });
  const regions = [
    ['United States', /United States|\bUSA?\b|\bU\.S\.(?:A\.)?/g],
    ['Canada', /\bCanada\b/gi], ['Mexico', /\bMexico\b/gi],
  ].map(([value, regex]) => ({ value, match: positiveMatch(message, regex) })).filter(r => r.match);
  if (regions.length) add('regions', regions.map(r => r.value).join(', '), regions.map(r => r.match[0]).join(' / '));
  const oem = positiveMatch(message, /\bOEMs?\b|equipment manufacturers?/gi);
  if (oem) { add('segments', ['Equipment manufacturer (OEM)'], oem[0]); add('motion', 'oem', oem[0]); }
  const headcount = message.match(/\b(\d[\d,]*\s*(?:-|to|–)\s*\d[\d,]*)\s*(?:employees|people)\b/i);
  if (headcount) {
    const range = headcount[1].replaceAll(',', '').split(/\s*(?:-|to|–)\s*/).map(Number);
    if (range[0] <= range[1]) add('headcount', headcount[0], headcount[0]);
    else questions.push('The employee range is reversed. What are the minimum and maximum?');
  }
  const codes = message.match(/\b(?:NAICS|SIC)\s*(?:codes?\s*)?[:=]?\s*(\d{4,6}(?:\s*,\s*\d{4,6})*)\b/i);
  if (codes) add('naics', codes[0], codes[0]);
  const domains = message.match(/(?:exclude domains?|excluded domains?)\s*[:=]\s*([a-z0-9.,\-\s]+)/i);
  if (domains) {
    const values = domains[1].split(/[\s,]+/).filter(d => /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(d));
    if (values.length) add('excludedDomains', values.join(', '), domains[0]);
  }
  if (!regions.length) questions.push('Which countries should this campaign target?');
  if (!oem) questions.push('Which buyer segment and sales motion should the campaign use?');
  if (!suggestions.length) questions.push('Use the detailed form for product, reference-win, pricing, and qualification information.');
  return { summary: `${suggestions.length} explicit field suggestions extracted locally.`, suggestions, questions,
    caveats: ['Local extraction supports territory, OEM motion, employee ranges, explicit NAICS/SIC codes, and excluded domains.', 'Extraction confidence describes matching your words, not verification of an account or its buying intent.'] };
}
