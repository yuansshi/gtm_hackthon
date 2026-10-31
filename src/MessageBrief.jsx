import React from 'react';
import { audiences, tones, callsToAction, valuePropositions, wordLimits, defaultMessageBrief, assessMessageBrief } from './message-brief.js';
import './message-brief.css';

export function MessageBriefControls({ value = defaultMessageBrief, onChange, disabled, prefix = 'Draft' }) {
  const update = key => event => onChange({ ...value, [key]: key === 'maxWords' ? Number(event.target.value) : event.target.value });
  return <fieldset className="message-brief-controls" disabled={disabled}><legend>Message brief</legend><div className="message-brief-grid">
    <label className="message-brief-value">{prefix} value proposition<select aria-label={`${prefix} value proposition`} aria-describedby={`${prefix.toLowerCase()}-value-proposition-help`} value={value.valueProposition || ''} onChange={update('valueProposition')}>{!value.valueProposition && <option value="" disabled>Unrecorded · existing brief</option>}{Object.entries(valuePropositions).map(([key,option]) => <option key={key} value={key}>{option.label}</option>)}</select><small id={`${prefix.toLowerCase()}-value-proposition-help`}>A messaging hypothesis. Check the focus in the final copy; it does not establish a supplier advantage.</small></label>
    <label>{prefix} audience<select value={value.audience} onChange={update('audience')}>{Object.entries(audiences).map(([key, option]) => <option key={key} value={key}>{option.label}</option>)}</select></label>
    <label>{prefix} tone<select value={value.tone} onChange={update('tone')}>{Object.entries(tones).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label>{prefix} word limit<select value={value.maxWords} onChange={update('maxWords')}>{wordLimits.map(limit => <option key={limit} value={limit}>{limit} words maximum</option>)}</select></label>
    <label>{prefix} call to action<select value={value.cta} onChange={update('cta')}>{Object.entries(callsToAction).map(([key, option]) => <option key={key} value={key}>{option.label}</option>)}</select></label>
  </div><p className="message-brief-cta">{callsToAction[value.cta]?.text}</p><small>Audience guides the writing; it does not verify this recipient’s role. Word limits exclude source URLs, citation numbers and the delivery footer. Tone and relevance need human review.</small></fieldset>;
}
export function MessageBriefReview({ draft, displayed, locked, busy, onChange }) {
  if (!draft.messageBrief) return <p className="message-brief-legacy">Existing draft · no saved message brief. Its original approval rules still apply.</p>;
  const value = displayed?.messageBrief || draft.messageBrief;
  // Count the original message, not the separately appended live delivery footer.
  const result = assessMessageBrief({ ...draft, ...displayed, body: locked ? draft.body : displayed.body, messageBrief: value });
  return <section className="message-brief-review" aria-label="Saved message brief"><div className="message-brief-summary"><strong>{audiences[value.audience]?.label} · {tones[value.tone]}</strong><span className={!result.valid ? 'over-limit' : ''}>{result.words} / {value.maxWords} words</span></div><p className="message-brief-value-label"><strong>Value proposition:</strong> {valuePropositions[value.valueProposition]?.label || 'Unrecorded · existing brief'}</p><p>{callsToAction[value.cta]?.text}</p><small>Audience, tone and value proposition are writing choices. Review the final copy and contact evidence; a recorded focus is not proof of a supplier advantage.</small>{!!result.issues.length && <ul className="message-brief-issues" aria-label="Message brief issues">{result.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}{!locked && <details><summary>Edit message brief</summary><MessageBriefControls value={value} onChange={onChange} disabled={busy} prefix="Message"/><small>Changing the brief creates unsaved edits. Save, update the body if needed, and review the new version.</small></details>}</section>;
}
