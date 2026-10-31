import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, ArrowRight, Check, Sparkles, ChevronDown } from 'lucide-react';
import { profileConfidence,businessById,businesses } from './businesses';
import { profileOf } from './api';
import {commercialPlanningFields} from './commercial-planning.js';
import {productIntakeFields,isProductIntakeField} from './product-intake.js';

const names = { industries: 'Industries & applications', regions: 'Target territory', segments: 'Buyer segments', roles: 'Buyer roles', motion: 'Sales motion', naics: 'NAICS / SIC targets', headcount: 'Employee range', revenue: 'Revenue range', triggers: 'Buying signals', referenceWins: 'Reference customers', exclusions: 'Qualification boundaries', excludedDomains: 'Excluded domains' };
for(const {key,label}of commercialPlanningFields)names['commercial.'+key]=label;
for(const business of businesses)for(const {field,label}of productIntakeFields(business))names[field]=label;
const display = value => Array.isArray(value) ? value.join(', ') : value;
const motions = { oem: 'New equipment / OEM', replacement: 'Replacement / maintenance', channel: 'Distributor / channel' };

export default function GuidedIntake({ state, act, busy }) {
  const productFields=productIntakeFields(businessById(state.businessId));
  const [input, setInput] = useState(''); const [mode, setMode] = useState('local');
  const [externalAck, setExternalAck] = useState(false); const [ack, setAck] = useState(false);
  const [runId, setRunId] = useState(''); const [decisions, setDecisions] = useState({});
  const pending = useRef(null);
  const runs = (state.assistantRuns || []).filter(r => r.kind === 'intake');
  const run = runs.find(r => r.id === runId) || runs[0];
  const suggestions = run?.result?.suggestions || [];
  useEffect(() => { setAck(false); setDecisions(Object.fromEntries(suggestions.map(s => [s.field, { field: s.field, decision: 'accepted', value: s.value }]))); }, [run?.id]);
  const propose = async e => {
    e?.preventDefault();
    const key = JSON.stringify({ input, mode, profile: profileOf(state) });
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    const result = await act('/assistant/intake', { message: input, mode, requestId: pending.current.id, acknowledgedExternalProcessing: externalAck, revision: state.revision });
    if (result) { setRunId(result.activeAssistantRunId); setAck(false); }
  };
  const decide = (field, key, value) => { setAck(false); setDecisions(d => ({ ...d, [field]: { ...d[field], [key]: value } })); };
  const review = async () => {
    const result = await act(`/assistant/intake/${run.id}/review`, { decisions: Object.values(decisions), acknowledged: ack, revision: state.revision });
    if (result) { setAck(false); pending.current = null; }
  };
  return <section className="panel guided-intake"><div><MessageSquare size={18} /><h2>Describe your first campaign</h2><span className="pill">{mode === 'local' ? 'Local extraction' : 'Project AI model'}</span></div>
    <p>Describe your products, technical constraints, buyers and internal commercial plans. Review every proposed change before it becomes part of this business’s draft profile.</p>
    <details className="commercial-input-help"><summary>Product input format</summary><p>Use these labels for local extraction. Keep units, ranges and qualifications in your own words; each supplied capability stays Unconfirmed until a separate technical review.</p><code>{productFields.map(f=>f.label+': …').join(';\n')}</code></details>
    <details className="commercial-input-help"><summary>Commercial input format</summary><p>For local extraction, put each supplied value after its label, separated by a new line or semicolon:</p><code>Monetization model: …; Pricing framework: …; Target contract value: …</code><p>Keep currency, range and per-order or program basis in your own words. Leave unknowns blank.</p></details>
    <form onSubmit={propose}><label className="sr-only" htmlFor="intake-chat">Campaign description</label><textarea id="intake-chat" rows={2} value={input} onChange={e => { setInput(e.target.value); pending.current = null; }} placeholder="Target US equipment OEMs. Pricing framework: your supplied quotation structure…" maxLength={5000} /><label className="sr-only" htmlFor="intake-mode">Intake method</label><select id="intake-mode" value={mode} onChange={e => { setMode(e.target.value); setExternalAck(false); pending.current = null; }}><option value="local">Local extraction · free</option><option value="model" disabled={!state.assistant?.configured}>AI model · 2 demo credits</option></select><button className="button secondary" disabled={busy || !input.trim() || (mode === 'model' && !externalAck)}>Suggest fields<ArrowRight size={14} /></button></form>
    {mode === 'model' ? <label className="assistant-consent"><input type="checkbox" checked={externalAck} onChange={e => setExternalAck(e.target.checked)} />Send this description and this business’s product, commercial and ICP research brief to the configured OpenAI project model. This does not authorize outreach.</label> : <p className="assistant-method">{state.assistant?.configured ? state.assistant.status : 'AI is not configured. Local extraction makes no external requests.'} Confidence describes extraction or a model hypothesis; it is not purchase intent or technical approval.</p>}
    {run && <details key={run.id} open={!run.reviewedAt} className="intake-review"><summary className="intake-review-heading"><div><h3>{run.reviewedAt ? 'Reviewed field proposal' : 'Review proposed fields'}</h3><p>{run.reviewedAt ? `${run.acceptedFields?.length || 0} accepted or adjusted / ${run.decisions?.filter(d => d.decision === 'dismissed').length || 0} dismissed. Open to inspect the review.` : run.result?.summary || run.error || 'Processing proposal…'}</p></div><span className={`pill ${run.reviewedAt ? 'green' : 'blue'}`}>{run.mode === 'model' ? 'AI suggestion' : 'Local extraction'}</span><ChevronDown size={15} className="intake-chevron" /></summary>
      {runs.length > 1 && <label className="proposal-history">Proposal history<select aria-label="Choose intake proposal" value={run.id} onChange={e => setRunId(e.target.value)}>{runs.map(r => <option value={r.id} key={r.id}>{new Date(r.startedAt).toLocaleString()} / {r.mode} / {r.reviewedAt ? 'reviewed' : r.status}</option>)}</select></label>}
      {!run.applicable && !run.reviewedAt && <p className="assistant-stale" role="status">The profile has changed since this proposal. Request new suggestions before applying fields.</p>}
      {run.status === 'failed' && <button className="button secondary" disabled={busy || !input.trim() || (mode === 'model' && !externalAck)} onClick={() => { pending.current = null; propose(); }}>Start a new proposal{mode === 'model' ? ' · 2 demo credits' : ''}</button>}
      {suggestions.map(s => { const decision = decisions[s.field] || { field: s.field, decision: 'accepted', value: s.value }; return <article className="suggestion-row" key={s.field}><div className="suggestion-label"><strong>{names[s.field]}</strong><span>Confidence {s.confidence.toFixed(2)}</span></div><div className="suggestion-value"><p>{s.field === 'motion' ? motions[s.value] : display(s.value)}</p><select aria-label={`Review ${names[s.field]}`} disabled={busy || !!run.reviewedAt || !run.applicable} value={run.reviewedAt ? run.decisions?.find(d => d.field === s.field)?.decision || 'dismissed' : decision.decision} onChange={e => decide(s.field, 'decision', e.target.value)}><option value="accepted">Accept</option><option value="adjusted">Adjust</option><option value="dismissed">Dismiss</option></select></div>{decision.decision === 'adjusted' && !run.reviewedAt && (s.field === 'motion' ? <select aria-label="Adjusted Sales motion" value={decision.value} onChange={e => decide(s.field, 'value', e.target.value)}>{Object.entries(motions).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select> : isProductIntakeField(s.field) ? <textarea rows={2} maxLength={3000} aria-label={`Adjusted ${names[s.field]}`} value={decision.value} onChange={e=>decide(s.field,'value',e.target.value)} /> : <input aria-label={`Adjusted ${names[s.field]}`} value={display(decision.value)} onChange={e => decide(s.field, 'value', Array.isArray(s.value) ? e.target.value.split(',').map(v => v.trim()).filter(Boolean) : e.target.value)} />)}
        <small>{s.basis === 'user_input' ? `Your input: “${s.evidence}”` : 'Catalog hypothesis; verification required.'}</small>{s.basis === 'catalog_hypothesis' && <a className="source-link" href={s.evidence} target="_blank" rel="noreferrer">Catalog evidence</a>}</article>; })}
      {!!run.result?.questions.length && <div className="assistant-questions"><h4>Questions to resolve</h4><ul>{run.result.questions.map(q => <li key={q}>{q}</li>)}</ul></div>}
      {run.result && !run.reviewedAt && <><label className="assistant-consent"><input type="checkbox" checked={ack} disabled={busy || !run.applicable} onChange={e => setAck(e.target.checked)} />I reviewed each field. Apply only my accepted or adjusted values to the draft; research and message approvals remain separate.</label><button className="button primary" disabled={busy || !ack || !run.applicable} onClick={review}><Check size={14} />Finish field review</button></>}
      {run.reviewedAt && <p className="assistant-reviewed"><Check size={14} />{run.acceptedFields?.length || 0} fields accepted or adjusted. Check the profile form before research approval.</p>}
      {run.metadata?.usage && <p className="assistant-method"><Sparkles size={12} />{run.metadata.model} / {run.metadata.usage.inputTokens} input tokens / {run.metadata.usage.outputTokens} output tokens. Actual provider response; model confidence is uncalibrated.</p>}
    </details>}
  </section>;
}
export function ConfidencePanel({ state }) {
  const fields=profileConfidence(state),products=fields.filter(f=>isProductIntakeField(f.field));
  const row=f=><div key={f.field}><span>{f.label||f.field}</span><strong>{f.confidence.toFixed(2)}</strong><small>{f.basis}{f.runId ? ' / reviewed proposal' : ''}</small></div>;
  return <section className="confidence-panel"><h3>Field confidence / evidence coverage</h3><p>Visible heuristics and reviewed suggestions from 0 to 1. These are not calibrated probabilities or proof of technical qualification.</p>{fields.filter(f=>!isProductIntakeField(f.field)).map(row)}<details className="product-confidence"><summary>Product & capability inputs · {products.filter(f=>f.confidence>0).length}/{products.length}</summary>{products.map(row)}</details></section>;
}
