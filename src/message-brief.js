export const audiences = {
  team: { label: 'Engineering & sourcing team', greeting: 'engineering and sourcing team', focus: 'application and qualification requirements' },
  engineering: { label: 'Engineering', greeting: 'engineering team', focus: 'load cases, interfaces and operating conditions' },
  procurement: { label: 'Procurement / sourcing', greeting: 'sourcing team', focus: 'supplier qualification, quantities and supply requirements' },
  operations: { label: 'Operations / maintenance', greeting: 'operations team', focus: 'duty cycle, service access and maintenance requirements' },
  leadership: { label: 'Business leadership', greeting: 'management team', focus: 'scope, qualification effort and commercial requirements' },
};
export const tones = { consultative: 'Consultative', direct: 'Direct', technical: 'Technical' };
export const valuePropositions = {
  application_fit: { label: 'Application fit', focus: 'Assess application fit before proposing a component.' },
  supplier_qualification: { label: 'Supplier qualification', focus: 'Explore the requirements for qualifying an additional supplier.' },
  engineering_collaboration: { label: 'Engineering collaboration', focus: 'Review drawings and requirements together before proposing a component.' },
};
// A writing hypothesis, never an inferred capability or a retrospective attribution.
export const recordedValueProposition = draft => Object.hasOwn(valuePropositions, draft?.messageBrief?.valueProposition) ? draft.messageBrief.valueProposition : null;
export const callsToAction = {
  technical_review: { label: 'Review technical requirements', text: 'Could we review the application requirements and a drawing to assess fit?' },
  supplier_process: { label: 'Understand supplier qualification', text: 'What does your process for qualifying an additional supplier require?' },
  right_contact: { label: 'Find the right team', text: 'Who handles supplier qualification for this equipment category?' },
  fit_call: { label: 'Request a short fit discussion', text: 'Would a 15-minute technical fit discussion be useful?' },
};
export const wordLimits = [80, 120, 180, 240];
export const defaultMessageBrief = { audience: 'team', tone: 'consultative', maxWords: 180, cta: 'technical_review', valueProposition: 'application_fit' };
export const validMessageBrief = brief => !!brief && typeof brief === 'object' && !Array.isArray(brief) && ['audience,cta,maxWords,tone','audience,cta,maxWords,tone,valueProposition'].includes(Object.keys(brief).sort().join(',')) && Object.hasOwn(audiences, brief.audience) && Object.hasOwn(tones, brief.tone) && wordLimits.includes(brief.maxWords) && Object.hasOwn(callsToAction, brief.cta) && (!Object.hasOwn(brief,'valueProposition') || Object.hasOwn(valuePropositions,brief.valueProposition));
// Count body words, excluding URLs and bracketed citation numbers. Delivery footers are separate.
export const bodyWordCount = body => (String(body || '').replace(/https?:\/\/[^\s<>]+/g, '').replace(/\[\d+\]/g, '').match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || []).length;
export function assessMessageBrief(draft) {
  const brief = draft?.messageBrief;
  if (!brief) return { legacy: true, valid: true, words: bodyWordCount(draft?.body), issues: [] };
  if (!validMessageBrief(brief)) return { valid: false, words: bodyWordCount(draft.body), issues: ['The saved message brief is invalid.'] };
  const words = bodyWordCount(draft.body), cta = callsToAction[brief.cta].text;
  const occurrences = String(draft.body || '').split(cta).length - 1;
  const issues = [];
  if (words > brief.maxWords) issues.push(`Body has ${words} words; the selected limit is ${brief.maxWords}.`);
  if (occurrences !== 1) issues.push('Include the selected call to action exactly once.');
  if ((draft.subject || '').length > 120) issues.push('Keep the subject within 120 characters.');
  return { valid: !issues.length, words, cta, issues };
}
