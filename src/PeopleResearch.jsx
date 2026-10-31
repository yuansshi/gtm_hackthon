import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { ArrowRight, ExternalLink, GitBranch, Users } from 'lucide-react';
import { personReviewCurrent, relationshipLabels } from './people-evidence.js';
import './people-research.css';

const EducationEvidence = lazy(() => import('./EducationEvidence.jsx'));
const date = value => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const link = (url, label) => <a href={url} target="_blank" rel="noreferrer">{label}<ExternalLink size={11}/></a>;
function useDecision(act) {
  const pending = useRef(new Map());
  return async (path, body, onError) => {
    const { revision, ...intent } = body; const key = JSON.stringify([path, intent]);
    if (!pending.current.has(key)) pending.current.set(key, crypto.randomUUID());
    const result = await act(path, { ...body, requestId: pending.current.get(key) }, 'POST', true, onError);
    if (result) pending.current.delete(key);
    return result;
  };
}

function PersonRecord({ review, account, state, act, busy }) {
  const connection = (state.knownConnections || []).find(item => item.reviewId === review.id && item.status === 'active');
  const [relationship, setRelationship] = useState('worked_together'), [note, setNote] = useState(''), [ack, setAck] = useState(false), [removeAck, setRemoveAck] = useState(false), [error, setError] = useState('');
  const decide = useDecision(act); const current = personReviewCurrent(review, account); const base = `/leads/${account.id}`;
  const save = async event => {
    event.preventDefault(); setError('');
    const result = await decide(base + '/connections', { reviewId: review.id, relationship, note, acknowledged: ack, revision: state.revision }, e => setError(e.message));
    if (result) { setAck(false); setNote(''); }
  };
  const remove = async action => {
    setError('');
    const body = action === 'withdraw' ? { reviewId: review.id } : { connectionId: connection.id };
    const result = await decide(base + (action === 'withdraw' ? '/people/withdraw' : '/connections/revoke'), { ...body, acknowledged: removeAck, revision: state.revision }, e => setError(e.message));
    if (result) setRemoveAck(false);
  };
  return <article className="pe-person">
    <div className="pe-person-heading"><div><h4>{review.name}</h4><p>{review.role}</p></div><span className={`ar-badge ${current ? 'ar-badge-healthy' : 'ar-badge-review'}`}>{current ? 'Reviewed publication' : review.status === 'reviewed' ? 'Fresh review needed' : review.status}</span></div>
    <small>Reviewed by {review.reviewedBy} · {date(review.reviewedAt)}. Current employment and authority unverified.</small>
    <details><summary>Published role and employment evidence</summary><blockquote>{review.roleQuote}</blockquote>{link(review.source, 'Account-owned role source')}<small>Fetched {date(review.checkedAt)}</small>{review.formerEmployer && <><h5>Former employer: {review.formerEmployer.name}</h5><blockquote>{review.formerEmployer.quote}</blockquote><p>{review.formerEmployer.domain}</p><blockquote>{review.formerEmployer.identityQuote}</blockquote>{link(review.formerEmployer.identitySource, 'Employer-owned identity source')}<small>Employment dates and overlap are unknown.</small></>}</details>
    <Suspense fallback={<p>Loading education evidence…</p>}><EducationEvidence person={review} account={account} state={state} act={act} busy={busy}/></Suspense>
    {['reviewed', 'needs_review'].includes(review.status) && <>
      {connection ? <div className="pe-attestation"><strong>Your local connection attestation</strong><p>{relationshipLabels[connection.relationship]} · {date(connection.attestedAt)}</p>{connection.note && <p>{connection.note}</p>}<small>Self-reported; introduction willingness is unconfirmed. {current ? '' : 'This evidence no longer supports warm paths.'}</small></div> : <details><summary>I know this person</summary><form onSubmit={save}>
        <label>Relationship<select value={relationship} onChange={event => { setRelationship(event.target.value); setAck(false); }}>{Object.entries(relationshipLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Local relationship note (optional)<textarea value={note} maxLength={500} onChange={event => { setNote(event.target.value); setAck(false); }} rows={2}/></label>
        <p>Notes stay in this workspace and do not enter model requests or graph projection.</p>
        <label className="pe-check"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)}/>I confirm this relationship from my own knowledge. No introduction is sent.</label>
        <button className="ar-button ar-button-secondary" disabled={busy || !!account.communicationStatus?.account?.blocked || !current || !ack}>Save local connection</button>
      </form></details>}
      <details><summary>Withdraw evidence or connection</summary><label className="pe-check"><input type="checkbox" checked={removeAck} onChange={event => setRemoveAck(event.target.checked)}/>Remove this support for future introduction paths.</label><div className="pe-actions">{connection && <button className="ar-button ar-button-secondary" disabled={busy || !removeAck} onClick={() => remove('revoke')}>Revoke connection</button>}<button className="ar-button ar-button-secondary" disabled={busy || !removeAck} onClick={() => remove('withdraw')}>Withdraw person review</button></div></details>
    </>}
    {error && <p className="pe-error" role="alert">{error}</p>}
  </article>;
}

export function PeopleResearch({ account, state, act, busy }) {
  const runs = (state.peopleResearch || []).filter(run => run.leadId === account.id);
  const reviews = (state.personReviews || []).filter(review => review.leadId === account.id);
  const [sourceUrl, setSourceUrl] = useState(''), [employerUrl, setEmployerUrl] = useState(''), [runId, setRunId] = useState(runs[0]?.id || ''), [name, setName] = useState(''), [role, setRole] = useState(''), [roleQuote, setRoleQuote] = useState(''), [history, setHistory] = useState(false), [employer, setEmployer] = useState(''), [historyQuote, setHistoryQuote] = useState(''), [identityQuote, setIdentityQuote] = useState(''), [ack, setAck] = useState(false), [error, setError] = useState('');
  const decide = useDecision(act); const base = `/leads/${account.id}`;
  const run = runs.find(item => item.id === runId) || runs[0];
  useEffect(() => { setAck(false); }, [name, role, roleQuote, history, employer, historyQuote, identityQuote, run?.id]);
  const fetchSources = async event => {
    event.preventDefault(); setError('');
    const result = await decide(base + '/people-research', { sourceUrl, employerUrl: employerUrl || null, revision: state.revision }, e => setError(e.message));
    if (result) { setRunId(result.activePeopleResearchId); setAck(false); }
  };
  const save = async event => {
    event.preventDefault(); setError('');
    const result = await decide(base + `/people-research/${run.id}/review`, { revision: state.revision, acknowledged: ack, name, role, roleQuote, formerEmployer: history ? { name: employer, quote: historyQuote, identityQuote } : null }, e => setError(e.message));
    if (result) { setAck(false); setName(''); setRole(''); setRoleQuote(''); setHistory(false); setEmployer(''); setHistoryQuote(''); setIdentityQuote(''); }
  };
  const dismiss = async () => {
    const result = await act(base + `/people-research/${run.id}/dismiss`, { revision: state.revision }, 'POST', true, e => setError(e.message));
    if (result) setAck(false);
  };
  return <section className="pe-panel ar-detail-section">
    <div className="ar-detail-title"><h3><Users size={15}/>Published people & introductions</h3><span className="ar-badge">{reviews.filter(review => personReviewCurrent(review, account)).length} current reviews</span></div>
    <p>Review a published role and optional education, then attest a person you know. Shared employers or institutions can suggest an introduction. Mailbox selection and outreach stay separate.</p>
    {state.peopleFixture && <p className="pe-warning">Test fixture only · synthetic people and employment evidence</p>}
    <details className="pe-research"><summary>Research a published person</summary>
      <form onSubmit={fetchSources}>
        <label>Account-owned role or news page<input type="url" required value={sourceUrl} placeholder={`https://${account.domain}/…`} onChange={event => setSourceUrl(event.target.value)} maxLength={2000}/></label>
        <label>Former employer’s identity page (optional)<input type="url" value={employerUrl} placeholder="https://employer.example/about" onChange={event => setEmployerUrl(event.target.value)} maxLength={2000}/></label>
        <p>Two local credits retrieve up to two public pages. Page instructions are treated as source text; no model is called.</p>
        <button className="ar-button ar-button-primary" disabled={busy || !!account.communicationStatus?.account?.blocked || !state.approved || account.evidenceNeedsReview || state.wallet.credits < 2 || state.jobs.some(job => job.status === 'running')}>Fetch people sources<span>2 credits</span></button>
      </form>
      {runs.length > 0 && <label>Research run<select value={run?.id || ''} onChange={event => { setRunId(event.target.value); setAck(false); }}>{runs.map(item => <option key={item.id} value={item.id}>{date(item.startedAt)} · {item.status}</option>)}</select></label>}
      {run?.status === 'running' && <p role="status">Fetching public source text…</p>}
      {run?.status === 'failed' && <p className="pe-error" role="alert">{run.error}</p>}
      {run?.status === 'ready' && <>
        {run.pages.map((page, index) => <details className="pe-source" key={page.url} open={index === 0}><summary>{page.url === run.sourceUrl ? 'Role source snapshot' : 'Employer identity snapshot'}</summary>{link(page.url, page.title)}<small>Fetched {date(page.checkedAt)} · review within 24 hours</small><pre>{page.text}</pre></details>)}
        <form className="pe-review" onSubmit={save}>
          <h4>Review exact published evidence</h4><p>Copy the full name and role as written. Each passage must be contiguous source text containing the names it supports.</p>
          <label>Published full name<input value={name} required maxLength={200} onChange={event => setName(event.target.value)}/></label>
          <label>Published role<input value={role} required maxLength={200} onChange={event => setRole(event.target.value)}/></label>
          <label>Exact role passage (full name and role)<textarea value={roleQuote} required minLength={12} maxLength={2000} rows={4} onChange={event => setRoleQuote(event.target.value)}/></label>
          {run.employerUrl && <label className="pe-check"><input type="checkbox" checked={history} onChange={event => setHistory(event.target.checked)}/>Review former-employer evidence too</label>}
          {history && <><label>Former employer name<input required value={employer} maxLength={200} onChange={event => setEmployer(event.target.value)}/></label><label>Exact former-employment passage (full person and employer names)<textarea required value={historyQuote} minLength={12} maxLength={2000} rows={4} onChange={event => setHistoryQuote(event.target.value)}/></label><label>Exact employer identity passage (organization name)<textarea required value={identityQuote} minLength={12} maxLength={600} rows={3} onChange={event => setIdentityQuote(event.target.value)}/></label></>}
          <label className="pe-check"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)}/>I reviewed the identity, role and any former employment. Dates, present employment and buying authority remain unverified.</label>
          <div className="pe-actions"><button className="ar-button ar-button-primary" disabled={busy || !!account.communicationStatus?.account?.blocked || !ack || !state.approved}>Save published person</button><button type="button" className="ar-button ar-button-secondary" onClick={dismiss} disabled={busy}>Dismiss source run</button></div>
        </form>
      </>}
    </details>
    {error && <p className="pe-error" role="alert">{error}</p>}
    {reviews.length ? reviews.map(review => <PersonRecord key={review.id} review={review} account={account} state={state} act={act} busy={busy}/>) : <p className="pe-empty">No reviewed person yet. Fetch a company publication to establish the first evidence-backed role.</p>}
  </section>;
}

export function WarmIntroductionPaths({ graph, go, fixture }) {
  return <section className="panel pe-paths"><div className="section-heading"><div><h2><GitBranch size={18}/>Warm introduction paths</h2><p>Native employer traversal with reviewed sources and a connection you explicitly attest.</p></div></div>
    {fixture && <p className="pe-warning">Test fixture only · synthetic people and employment evidence</p>}
    <p className="pe-warning">Possible routes only. Shared employment does not confirm overlap, acquaintance or willingness to introduce.</p>
    {graph.warmPaths?.length >= 100 && <p>Showing the first 100 possible paths from this graph snapshot.</p>}
    {graph.warmPaths?.length ? graph.warmPaths.map(path => <article key={path.id} className="pe-warm-path"><div className="pe-path-chain"><strong>You</strong><ArrowRight size={14}/><span>{path.anchor}</span><ArrowRight size={14}/><span>{path.employer}</span><ArrowRight size={14}/><strong>{path.person}</strong></div><p>{path.company} · {path.product}</p><small>Your attestation: {relationshipLabels[path.connection.relationship]} · {date(path.connection.attestedAt)}</small>
      <details><summary>Inspect the path and its evidence</summary><code>{path.relation}</code>{[path.anchorEvidence, path.targetEvidence].map((evidence, index) => <div className="pe-path-evidence" key={index}><strong>{evidence.name}</strong><p>{evidence.relationship === 'works_at' ? 'Published role at the shared company' : 'Published former-employment claim'}</p><blockquote>{evidence.quote}</blockquote>{link(evidence.source, 'Employment source')}<small>Fetched {date(evidence.checkedAt)}</small>{evidence.identitySource && <>{link(evidence.identitySource, 'Employer identity source')}<blockquote>{evidence.identityQuote}</blockquote></>}</div>)}<p>{path.interpretation}</p></details>
      <button className="text-button" onClick={() => go('discovery', { accountId: path.leadId })}>Open target account<ArrowRight size={14}/></button>
    </article>) : <div className="inline-empty">No eligible warm path established. In Accounts → Contacts, review two people with a shared employer and attest a connection to one. Refresh this graph after evidence or relationship changes.</div>}
  </section>;
}
