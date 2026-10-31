import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, GraduationCap, RefreshCw, ShieldCheck } from 'lucide-react';
import { educationLabels, educationReviewCurrent } from './education-evidence.js';
import { personReviewCurrent } from './people-evidence.js';
import './education.css';

const date = value => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const link = (url, label) => <a className="source-link" href={url} target="_blank" rel="noreferrer">{label}<ExternalLink size={11}/></a>;
export default function EducationEvidence({ person, account, state, act, busy }) {
  const runs = (state.educationResearch || []).filter(run => run.leadId === account.id && run.personReviewId === person.id);
  const records = (state.educationReviews || []).filter(review => review.leadId === account.id && review.personReviewId === person.id);
  const [identityUrl, setIdentityUrl] = useState(''), [runId, setRunId] = useState(runs[0]?.id || '');
  const [name, setName] = useState(''), [kind, setKind] = useState('attended'), [educationQuote, setEducationQuote] = useState(''), [identityQuote, setIdentityQuote] = useState('');
  const [ack, setAck] = useState(false), [withdrawId, setWithdrawId] = useState(''), [error, setError] = useState('');
  const requests = useRef(new Map());
  const run = runs.find(item => item.id === runId) || runs[0];
  const allowed = state.approved && personReviewCurrent(person, account) && !account.communicationStatus?.account?.blocked;
  const base = `/leads/${account.id}`;
  useEffect(() => { setAck(false); }, [run?.id, name, kind, educationQuote, identityQuote, person.status, state.approved]);
  const decide = async (path, values) => {
    setError(''); const key = JSON.stringify([path, values]);
    if (!requests.current.has(key)) requests.current.set(key, crypto.randomUUID());
    const result = await act(path, { ...values, revision: state.revision, requestId: requests.current.get(key) }, 'POST', true, error => setError(error.message));
    if (result) requests.current.delete(key);
    return result;
  };
  const fetchSources = async event => {
    event.preventDefault();
    const result = await decide(base + '/education-research', { personReviewId: person.id, identityUrl });
    if (result) { setRunId(result.activeEducationResearchId); setAck(false); setName(''); setEducationQuote(''); setIdentityQuote(''); }
  };
  const save = async event => { event.preventDefault(); if (await decide(base + `/education-research/${run.id}/review`, { institutionName: name, kind, educationQuote, identityQuote, acknowledged: ack })) setAck(false); };
  const withdraw = async record => { if (await decide(base + '/education/withdraw', { reviewId: record.id, acknowledged: withdrawId === record.id })) setWithdrawId(''); };
  const biography = run?.pages?.find(page => page.url === run.sourceUrl), identity = run?.pages?.find(page => page.url === run.identityUrl);
  return <details className="ed-workbench">
    <summary><GraduationCap size={17}/><strong>Education evidence</strong><span>{records.filter(record => educationReviewCurrent(record, state, account)).length} current</span></summary>
    <div className="ed-body"><p>Review a published study or degree claim for <strong>{person.name}</strong>. A shared school can suggest an introduction route; it does not establish overlap or acquaintance.</p>
      <form onSubmit={fetchSources} className="ed-fetch"><h5>1. Fetch two sources</h5><p>The company biography is fixed to this person’s reviewed role source.</p>{link(person.source, 'Company biography')}<label>Institution-owned identity page<input type="url" required value={identityUrl} onChange={event => setIdentityUrl(event.target.value)} maxLength={2000} placeholder="https://university.edu/about"/></label><p>Choose an official institution page, then inspect its identity passage. Names alone do not match schools.</p><button className="ar-button ar-button-secondary" disabled={busy || !allowed || state.jobs?.some(job => job.status === 'running') || state.wallet.credits < 2}><RefreshCw size={13}/>Fetch education sources<span>2 credits</span></button>{!allowed && <p className="ed-warning">Current profile/person review and communication eligibility are required before new research.</p>}</form>
      {runs.length > 1 && <label>Education source run<select value={run?.id || ''} onChange={event => setRunId(event.target.value)}>{runs.map(item => <option value={item.id} key={item.id}>{date(item.startedAt)} · {item.status}</option>)}</select></label>}
      {run && <div className="ed-run" role="status"><strong>{run.status === 'running' ? 'Retrieving education sources…' : run.status === 'ready' ? 'Sources ready for your review' : `Source run ${run.status}`}</strong>{run.error && <p>{run.error}</p>}<small>{date(run.startedAt)} · no automatic retry</small></div>}
      {run?.status === 'ready' && <form onSubmit={save} className="ed-review"><h5>2. Review exact public passages</h5><details className="ed-source"><summary>Company biography text</summary><p>{biography?.text}</p>{link(run.sourceUrl, 'Biography publication')}</details><details className="ed-source"><summary>Institution identity text</summary><p>{identity?.text}</p>{link(run.identityUrl, 'Institution reference')}</details><label>Full institution name<input value={name} required maxLength={200} onChange={event => setName(event.target.value)} placeholder="Use the same full name in both passages"/></label><label>Published claim<select value={kind} onChange={event => setKind(event.target.value)}>{Object.entries(educationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Exact education passage · full person and institution names<textarea value={educationQuote} required minLength={12} maxLength={2000} rows={4} onChange={event => setEducationQuote(event.target.value)}/></label><label>Exact institution identity passage · institution name<textarea value={identityQuote} required minLength={12} maxLength={600} rows={3} onChange={event => setIdentityQuote(event.target.value)}/></label><label className="ed-check"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)}/><span>I reviewed the person and institution identity. The passage explicitly describes this person’s study or degree, not employment or a partnership. Dates, attendance and degree are not independently verified.</span></label><div className="ed-actions"><button className="ar-button ar-button-primary" disabled={busy || !allowed || !ack}><ShieldCheck size={14}/>Save reviewed education</button><button type="button" className="ar-button ar-button-secondary" disabled={busy} onClick={() => act(base + `/education-research/${run.id}/dismiss`, { revision: state.revision }, 'POST', true, error => setError(error.message))}>Dismiss sources</button></div></form>}
      {error && <p className="pe-error" role="alert">{error}</p>}
      {!!records.length && <div className="ed-records"><h5>3. Retained education evidence</h5>{records.map(record => <article className="ed-record" key={record.id}><div className="ed-record-title"><strong>{record.institution.name}</strong><span className="ar-badge">{educationReviewCurrent(record, state, account) ? 'Source-reviewed claim' : record.status === 'reviewed' ? 'Fresh review needed' : record.status.replaceAll('_', ' ')}</span></div><small>{educationLabels[record.kind]} · reviewed {date(record.reviewedAt)}</small><blockquote>{record.quote}</blockquote>{link(record.source, 'Education passage source')}<details><summary>Institution identity & matching</summary><p>{record.institution.domain} + {record.institution.name}. Exact reviewed name and hostname; aliases/campus equivalence are not inferred.</p><blockquote>{record.institution.identityQuote}</blockquote>{link(record.institution.identitySource, 'Institution identity source')}<small>Education fetched {date(record.checkedAt)} · identity fetched {date(record.institution.checkedAt)}</small></details>{['reviewed', 'needs_review'].includes(record.status) && <div className="ed-withdraw"><label className="ed-check"><input type="checkbox" checked={withdrawId === record.id} onChange={event => setWithdrawId(event.target.checked ? record.id : '')}/><span>Withdraw this education claim from future paths.</span></label><button type="button" className="ar-button ar-button-secondary" disabled={busy || withdrawId !== record.id} onClick={() => withdraw(record)}>Withdraw education</button></div>}</article>)}</div>}
      <p className="ed-footnote">These records do not select a mailbox or approve a message. Introduction paths also need another reviewed person at the same institution and an explicit connection attestation. Refresh the graph after a decision.</p>
    </div>
  </details>;
}
