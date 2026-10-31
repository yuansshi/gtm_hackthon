import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, GitBranch } from 'lucide-react';
import { buyingKinds, buyingLinkStatus, buyingSignalKey, buyingProfileKey } from './buying-evidence.js';
import { signalFresh } from './market-signals.js';
import { competitiveReferences } from './competitor-evidence.js';
import './buying-signals.css';

const statusLabel = { active: 'Published window active', upcoming: 'Upcoming window', expired: 'Window ended', needs_review: 'Fresh link review needed', withdrawn: 'Withdrawn', superseded: 'Superseded' };
const link = (url, label) => <a href={url} target="_blank" rel="noreferrer">{label}<ExternalLink size={11}/></a>;
function useDecision(act) {
  const pending = useRef(new Map());
  return async (path, input, onError) => {
    const { revision, ...values } = input; const key = JSON.stringify([path, values]);
    if (!pending.current.has(key)) pending.current.set(key, crypto.randomUUID());
    const result = await act(path, { ...input, requestId: pending.current.get(key) }, 'POST', true, onError);
    if (result) pending.current.delete(key); return result;
  };
}
function BuyingRecord({ record, state, account, act, busy }) {
  const [ack, setAck] = useState(false), [error, setError] = useState(''); const decide = useDecision(act);
  const status = buyingLinkStatus(record, state, account);
  const withdraw = async () => { setError(''); const result = await decide(`/leads/${account.id}/buying-links/withdraw`, { revision: state.revision, acknowledged: ack, linkId: record.id }, error => setError(error.message)); if (result) setAck(false); };
  return <article className="bs-record"><header><h4>{record.kind === 'evaluation' ? record.jobTitle : record.competitorName}</h4><span className={`ar-badge ${status === 'active' ? 'ar-badge-healthy' : 'ar-badge-review'}`}>{statusLabel[status] || status}</span></header><p>{buyingKinds[record.kind]} · {record.startDate} to {record.endDate} (UTC days)</p><p>Owner-linked relevance. Buying intent, causal connection and willingness to switch remain unconfirmed.</p><details><summary>Inspect linked publications</summary><blockquote>{record.windowQuote}</blockquote>{link(record.source, 'Company window source')}{record.kind === 'evaluation' ? <><blockquote>{record.jobQuote}</blockquote>{link(record.jobSource, 'Job requisition source')}</> : <><blockquote>{record.competitorIdentityQuote}</blockquote>{link(record.competitorSource, 'Reviewed competitor identity')}</>}</details>{['reviewed', 'needs_review'].includes(record.status) && <details><summary>Withdraw this association</summary><label className="bs-check"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)}/>Remove this link from future buying-window paths.</label><button className="ar-button ar-button-secondary" disabled={busy || !ack} onClick={withdraw}>Withdraw buying link</button></details>}{error && <p className="bs-error" role="alert">{error}</p>}</article>;
}
export default function BuyingSignals({ state, account, act, busy }) {
  const [open, setOpen] = useState(false), [kind, setKind] = useState('evaluation'), [signalId, setSignal] = useState(''), [jobSignalId, setJob] = useState(''), [competitorId, setCompetitor] = useState(''), [startDate, setStart] = useState(''), [endDate, setEnd] = useState(''), [windowQuote, setWindow] = useState(''), [jobTitle, setTitle] = useState(''), [jobQuote, setJobQuote] = useState(''), [ack, setAck] = useState(false), [history, setHistory] = useState(false), [error, setError] = useState('');
  const decide = useDecision(act); const signals = (account.marketSignals || []).filter(signal => signal.acceptedAt && signalFresh(signal));
  const primary = signals.find(signal => signal.id === signalId), job = signals.find(signal => signal.id === jobSignalId);
  const references = competitiveReferences(state).filter(item => item.current), competitor = references.find(item => item.id === competitorId);
  const page = account.signalMonitor?.pages?.find(page => page.url === primary?.source), jobPage = account.signalMonitor?.pages?.find(page => page.url === job?.source);
  const records = (state.buyingLinks || []).filter(item => item.leadId === account.id && (history || ['reviewed', 'needs_review'].includes(item.status)));
  const profileKey = buyingProfileKey(state), primaryKey = buyingSignalKey(primary), jobKey = buyingSignalKey(job);
  useEffect(() => { setAck(false); }, [kind, signalId, jobSignalId, competitorId, startDate, endDate, windowQuote, jobTitle, jobQuote, profileKey, primaryKey, jobKey, primary?.sourceHash, job?.sourceHash, competitor?.review?.id, state.approved]);
  const save = async event => {
    event.preventDefault(); setError('');
    const result = await decide(`/leads/${account.id}/buying-links`, { revision: state.revision, acknowledged: ack, kind, signalId, jobSignalId: kind === 'evaluation' ? jobSignalId : null, competitorId: kind === 'displacement' ? competitorId : null, startDate, endDate, windowQuote, jobTitle: kind === 'evaluation' ? jobTitle : '', jobQuote: kind === 'evaluation' ? jobQuote : '' }, error => setError(error.message));
    if (result) { setAck(false); setOpen(false); }
  };
  return <section className="bs-panel" aria-label="Buying windows and supplier changes"><header><div><h3><GitBranch size={15}/>Buying windows & supplier changes</h3><p>Link reviewed publications to a dated evaluation or supplier-review window. Hiring alone does not establish a buying cycle.</p></div><button className="ar-button ar-button-secondary" disabled={busy || !state.approved} aria-expanded={open} onClick={() => setOpen(!open)}>Link buying evidence</button></header>
    {state.buyingFixture && <p className="bs-warning">Test fixture only · synthetic buying-window publications</p>}
    {open && <form className="bs-form" onSubmit={save}>
      <label>Link type<select value={kind} onChange={event => { setKind(event.target.value); setSignal(''); setWindow(''); }}><option value="evaluation">Job → published evaluation</option><option value="displacement">Supplier renewal / churn</option></select></label>
      <label>{kind === 'evaluation' ? 'Reviewed procurement evaluation' : 'Reviewed renewal or churn notice'}<select required value={signalId} onChange={event => { setSignal(event.target.value); setWindow(signals.find(signal => signal.id === event.target.value)?.quote || ''); }}><option value="">Choose accepted company evidence</option>{signals.filter(signal => kind === 'evaluation' ? signal.kind === 'evaluation' : ['renewal', 'churn'].includes(signal.kind)).map(signal => <option key={signal.id} value={signal.id}>{signal.title} · {signal.eventDate} · {signal.quote.slice(0, 95)}</option>)}</select></label>
      <p>First accept the dated company publication in the evidence feed above. Fresh snapshots, retrieved within 24 hours, are required to create a link.</p>
      {page && <details className="bs-source"><summary>Retained window source</summary>{link(page.url, 'Company publication')}<pre>{page.text}</pre></details>}
      <div className="bs-field-pair"><label>Published window opens<input required type="date" value={startDate} onInput={event => setStart(event.currentTarget.value)} onChange={event => setStart(event.target.value)}/></label><label>Published window closes<input required type="date" value={endDate} onInput={event => setEnd(event.currentTarget.value)} onChange={event => setEnd(event.target.value)}/></label></div>
      <label>Exact window passage<textarea required rows={4} maxLength={2000} value={windowQuote} onChange={event => setWindow(event.target.value)}/><small>Include both dates in ISO or English month/day/year form and the selected signal’s context. Dates must describe the procurement or supplier-review window, not a copyright year, job deadline or contract term. Maximum window: 366 days.</small></label>
      {kind === 'evaluation' ? <><label>Reviewed job requisition<select required value={jobSignalId} onChange={event => { setJob(event.target.value); setJobQuote(signals.find(signal => signal.id === event.target.value)?.quote || ''); }}><option value="">Choose an accepted job requisition</option>{signals.filter(signal => signal.kind === 'job_requisition').map(signal => <option key={signal.id} value={signal.id}>{signal.eventDate} · {signal.quote.slice(0, 115)}</option>)}</select></label>{jobPage && <details className="bs-source"><summary>Retained job source</summary>{link(jobPage.url, 'Job publication')}<pre>{jobPage.text}</pre></details>}<label>Published job title<input required maxLength={200} value={jobTitle} onChange={event => setTitle(event.target.value)}/></label><label>Exact job passage<textarea required rows={3} maxLength={2000} value={jobQuote} onChange={event => setJobQuote(event.target.value)}/></label></> : <><label>Reviewed competitor named in the window<select required value={competitorId} onChange={event => setCompetitor(event.target.value)}><option value="">Choose a current reviewed competitor</option>{references.map(item => <option key={item.id} value={item.id}>{item.review.name}</option>)}</select></label><p>Review competitor identity in Accounts → Competitive landscape first. The exact published name must appear in the window passage.</p></>}
      <label className="bs-check"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)}/>I checked the linked publications and exact window dates. Relevance is my assessment; this does not confirm buying intent or authorize outreach.</label><button className="ar-button ar-button-primary" disabled={busy || !ack || !state.approved || !primary || !startDate || !endDate || !windowQuote.trim() || (kind === 'evaluation' ? !job || !jobTitle.trim() || !jobQuote.trim() : !competitor)}>Save reviewed buying link</button>{error && <p className="bs-error" role="alert">{error}</p>}
    </form>}
    <label className="bs-check bs-history"><input type="checkbox" checked={history} onChange={event => setHistory(event.target.checked)}/>Show withdrawn and superseded links</label>
    {records.length ? records.map(record => <BuyingRecord key={record.id} record={record} state={state} account={account} act={act} busy={busy}/>) : <p className="bs-empty">No buying-window links recorded. Review an explicit procurement or supplier-change publication before linking evidence.</p>}
    {(state.buyingOperations || []).some(item => item.leadId === account.id && item.graphStatus !== 'synced') && <p className="bs-warning">The decision is saved; Query graph can repair its pending projection without repeating the review.</p>}
  </section>;
}
