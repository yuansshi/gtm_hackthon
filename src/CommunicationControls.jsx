import React, { useId, useRef, useState } from 'react';
import { Ban, ChevronDown, ShieldCheck } from 'lucide-react';
import { communicationTarget } from './communication-targets.js';
import './communication-controls.css';

const reasonLabels = { opt_out: 'Opt-out request', bounce: 'Bounced address', complaint: 'Complaint', manual_hold: 'Manual hold', permission_updated: 'Permission updated', recorded_in_error: 'Recorded in error' };
const localTime = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const time = value => new Date(value).toLocaleString();
export default function CommunicationControls({ state, act, busy, account }) {
  const id = useId();
  const [kind, setKind] = useState('account'), [target, setTarget] = useState(account?.domain || '');
  const [reason, setReason] = useState('opt_out'), [reportedAt, setReportedAt] = useState(localTime), [note, setNote] = useState(''), [ack, setAck] = useState(false);
  const [release, setRelease] = useState(null), [releaseReason, setReleaseReason] = useState('permission_updated'), [releaseNote, setReleaseNote] = useState(''), [releaseAck, setReleaseAck] = useState(false);
  const [saved, setSaved] = useState('');
  const request = useRef(null);
  const records = state.communicationRestrictions || [], active = records.filter(item => item.status === 'active');
  let canonical = '', targetError = '';
  try { canonical = communicationTarget(kind, target); } catch (error) { if (target) targetError = error.message; }
  const changed = setter => event => { setter(event.target.value); setAck(false); setSaved(''); };
  const submit = async (path, values) => {
    const key = JSON.stringify({ path, ...values });
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    const result = await act(path, { ...values, requestId: request.current.id, revision: state.revision });
    if (result) request.current = null;
    return result;
  };
  const add = async event => {
    event.preventDefault();
    const at = new Date(reportedAt);
    if (!canonical || !Number.isFinite(at.getTime())) return;
    if (await submit('/communication/holds', { kind, target: canonical, reason, reportedAt: at.toISOString(), note, acknowledged: ack })) {
      setTarget(''); setNote(''); setAck(false); setSaved('Hold recorded. Affected approvals and recipients were cleared.');
    }
  };
  const remove = async event => {
    event.preventDefault();
    if (await submit('/communication/releases', { restrictionId: release.id, expectedVersion: release.version, reason: releaseReason, note: releaseNote, acknowledged: releaseAck })) { setRelease(null); setSaved('Hold released. Shortlist selections, recipients and approvals must be reviewed again.'); }
  };
  return <details className="panel communication-controls" open={account ? true : undefined}>
    <summary><span className="communication-icon"><Ban size={19} /></span><span><strong>Communication preferences</strong><small>Record opt-outs and do-not-contact decisions</small></span><span className={`communication-count ${active.length ? 'has-holds' : ''}`}>{active.length} active {active.length === 1 ? 'hold' : 'holds'}</span><ChevronDown size={16} /></summary>
    <div className="communication-body">
      <p>Applies only to <strong>{state.company.name}</strong>. Holds survive campaign resets. Public company research and existing delivery history remain available.</p>
      {account?.communicationStatus?.account?.blocked && <div className="communication-warning"><Ban size={16} /><span>This account is on hold. Targeted contact processing and all outreach channels are paused.</span></div>}
      {saved && <p className="communication-saved" role="status"><ShieldCheck size={16} />{saved}</p>}
      <form onSubmit={add} className="communication-form">
        <h3>Record a do-not-contact hold</h3>
        <div className="communication-grid"><label htmlFor={`${id}-kind`}>Scope<select id={`${id}-kind`} value={kind} onChange={event => { setKind(event.target.value); setTarget(event.target.value === 'account' ? account?.domain || '' : event.target.value === 'email' ? account?.contact?.email || '' : account?.contact?.linkedIn || ''); setAck(false); }}><option value="account">Whole account · all channels</option><option value="email">One email address</option><option value="linkedin">One LinkedIn profile</option></select></label><label htmlFor={`${id}-target`}>{kind === 'account' ? 'Company domain or website' : kind === 'email' ? 'Email to hold' : 'LinkedIn profile to hold'}<input id={`${id}-target`} value={target} required maxLength={2000} onChange={changed(setTarget)} placeholder={kind === 'account' ? 'company.com' : kind === 'email' ? 'person@company.com' : 'https://www.linkedin.com/in/name'} /></label><label>Reason<select value={reason} onChange={changed(setReason)}>{['opt_out', 'bounce', 'complaint', 'manual_hold'].map(value => <option value={value} key={value}>{reasonLabels[value]}</option>)}</select></label><label>Request received<input type="datetime-local" required value={reportedAt} onInput={changed(setReportedAt)} onChange={changed(setReportedAt)} /></label></div>
        {canonical && <p className="communication-scope">Will hold: <strong>{canonical}</strong>{kind === 'account' ? ' and its subdomains. Blocks targeted contact processing and all email/LinkedIn outreach for matching accounts.' : ` across this business’s accounts. The other channel remains available unless separately held.`}</p>}
        {targetError && <p className="communication-warning" role="alert">{targetError}</p>}
        <label>Internal note · optional<textarea rows={2} value={note} maxLength={500} onChange={changed(setNote)} placeholder="Record the request or reason for this decision." /></label>
        <label className="communication-ack"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} /><span>I reviewed the target and scope. This is a user-reported decision; affected editable recipients and approvals will be cleared.</span></label>
        <button className="button secondary" disabled={busy || !canonical || !reportedAt || !ack} type="submit"><Ban size={15} />Record hold · free</button>
      </form>
      <div className="communication-records"><h3>Recorded preferences <span>{records.length}</span></h3>{!records.length && <p>No manual holds recorded. Provider processing restrictions are enforced separately.</p>}{records.map(record => <article key={record.id} className={record.status === 'active' ? 'communication-record active' : 'communication-record'}><div className="communication-record-heading"><div><strong>{record.display}</strong><small>{record.kind === 'account' ? 'Whole account · all channels' : record.kind === 'email' ? 'Email only' : 'LinkedIn only'} · {reasonLabels[record.reason]}</small></div><span>{record.status === 'active' ? 'On hold' : 'Released'} · v{record.version}</span></div><small>Request received {time(record.reportedAt)} · recorded {time(record.recordedAt)}</small>{record.note && <p>{record.note}</p>}{record.release && <p>Released {time(record.release.at)} · {reasonLabels[record.release.reason]}. {record.release.note}</p>}{record.status === 'active' && release?.id !== record.id && <button type="button" className="text-button" disabled={busy} onClick={() => { setRelease(record); setReleaseNote(''); setReleaseAck(false); setReleaseReason('permission_updated'); }}>Review release</button>}{release?.id === record.id && record.status === 'active' && <form className="communication-release" onSubmit={remove}><h4>Release this hold?</h4><p>A release needs a new recorded decision. Previous approvals, recipients and shortlist selections will stay cleared.</p><label>Release reason<select value={releaseReason} onChange={event => { setReleaseReason(event.target.value); setReleaseAck(false); }}><option value="permission_updated">Permission updated</option><option value="recorded_in_error">Recorded in error</option></select></label><label>Decision note<textarea required rows={2} maxLength={500} value={releaseNote} onChange={event => { setReleaseNote(event.target.value); setReleaseAck(false); }} /></label><label className="communication-ack"><input type="checkbox" checked={releaseAck} onChange={event => setReleaseAck(event.target.checked)} /><span>I reviewed version {release.version} and the basis for release.</span></label><div className="communication-actions"><button type="submit" className="button secondary" disabled={busy || !releaseAck || !releaseNote.trim() || release.version !== record.version}>Release reviewed hold</button><button type="button" className="text-button" onClick={() => setRelease(null)}>Keep hold</button></div></form>}<details className="communication-history"><summary>Decision history</summary>{(state.communicationOperations || []).filter(item => item.restrictionId === record.id).map(item => <p key={item.id}>v{item.version} · {item.action === 'hold' ? 'Hold recorded' : 'Released'} · {time(item.at)}{item.decision?.reason ? ` · ${reasonLabels[item.decision.reason]}` : ''}{item.decision?.note ? ` · ${item.decision.note}` : ''}</p>)}</details></article>)}</div>
      <p className="communication-footnote">Email matching ignores letter case. LinkedIn URL tracking parameters are ignored for matching; profile ownership remains unverified. Manual release cannot remove a provider restriction. These controls record preferences; they do not establish consent or erase existing research.</p>
    </div>
  </details>;
}
