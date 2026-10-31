import { z } from 'zod';
import { AppError } from './store.js';
import { audiences, tones, callsToAction, valuePropositions, wordLimits, validMessageBrief, assessMessageBrief } from '../src/message-brief.js';
import { signalKinds } from '../src/market-signals.js';

export const messageBriefSchema = z.object({ audience: z.enum(Object.keys(audiences)), tone: z.enum(Object.keys(tones)), maxWords: z.number().int().refine(value => wordLimits.includes(value)), cta: z.enum(Object.keys(callsToAction)), valueProposition: z.enum(Object.keys(valuePropositions)).optional() }).strict();
export function checkedMessageBrief(brief) {
  if (brief === undefined) return undefined;
  if (!validMessageBrief(brief)) throw new AppError(400, 'Choose a supported audience, tone, word limit, call to action and value proposition.', 'invalid_message_brief');
  return { audience: brief.audience, tone: brief.tone, maxWords: brief.maxWords, cta: brief.cta, ...(Object.hasOwn(brief,'valueProposition') ? { valueProposition: brief.valueProposition } : {}) };
}
export function requireMessageBrief(draft, model = false) {
  const result = assessMessageBrief(draft);
  if (!result.valid) throw new AppError(model ? 502 : 409, result.issues.join(' ') + (model ? ' No model draft was created.' : ' Edit the message or brief before approval.'), 'message_brief_not_met');
  return result;
}
export function messageBriefInstructions(brief) {
  if (!brief) return null;
  return { ...brief, audience: audiences[brief.audience].label, audienceFocus: audiences[brief.audience].focus, tone: tones[brief.tone], callToAction: callsToAction[brief.cta].text, ...(brief.valueProposition ? { valuePropositionLabel:valuePropositions[brief.valueProposition].label, valuePropositionFocus:valuePropositions[brief.valueProposition].focus } : {}), constraints: 'Audience and value proposition are writing choices, not verified recipient roles or proven supplier advantages. Include callToAction exactly once, unchanged. Body word count excludes source URLs and bracketed citation numbers; the delivery footer is added separately. Subject must be at most 120 characters. Do not claim previous contact or a meeting occurred.' };
}
export function briefTemplate({ state, lead, channel, variant, sequenceStep, signals, brief, product }) {
  const audience = audiences[brief.audience], cta = callsToAction[brief.cta].text;
  const sources = `[1] ${lead.source}\n[2] ${state.company.website}${signals.map((signal,index) => `\n[${index+3}] ${signal.source}`).join('')}`;
  const trigger = signals.map((signal,index) => `I noted your published ${signalKinds[signal.kind]?.toLowerCase() || 'company event'} dated ${signal.eventDate} [${index+3}]. Current sourcing demand is unconfirmed.`).join('\n\n');
  const value = variant === 'A' ? `Your ${lead.application.toLowerCase()} portfolio [1] prompted this supplier-fit inquiry. ${state.company.name} supplies ${product} [2].` : `${state.company.name} supplies ${product} [2]. Your ${lead.application.toLowerCase()} portfolio [1] is the basis for this supplier-fit inquiry.`;
  const focus = brief.tone === 'technical' ? `Review focus: ${audience.focus}.` : brief.tone === 'direct' ? `The next step would be a review of ${audience.focus}.` : `If there is a fit, we could start with ${audience.focus}.`;
  const step = sequenceStep === 1 ? 'Additional qualification context:' : sequenceStep === 2 ? 'For a future supplier review:' : '';
  const blocks = [step, value, trigger, brief.valueProposition ? valuePropositions[brief.valueProposition].focus : '', focus, 'Compatibility, pricing and delivery remain subject to technical review.', cta, sources].filter(Boolean);
  const body = `${channel === 'linkedin' ? 'Hi' : 'Hello'} ${lead.name} ${audience.greeting},\n\n${blocks.join('\n\n')}`;
  const subject = `${sequenceStep ? 'Qualification: ' : ''}${product} — supplier fit`;
  // Keep every source and qualification statement. Never trim evidence to force a short limit.
  requireMessageBrief({ messageBrief: brief, subject, body });
  return { subject, body };
}
