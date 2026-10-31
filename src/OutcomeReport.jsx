import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ClipboardCheck, ExternalLink, Info, RefreshCw, X } from 'lucide-react';
import './outcomes.css';

const stages = ['Contacted', 'Replied', 'Meeting booked', 'RFQ received', 'Engineering review', 'Quote sent', 'Trial / qualification', 'Closed won', 'Closed lost'];
const localMinute = (date = new Date()) => { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const date = value => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const messageLabel = draft => `${draft.status === 'simulated' ? 'Demo dry run' : 'Provider accepted'} · ${draft.channel} ${draft.variant} · day ${draft.suggestedDay ?? [0, 3, 7][draft.sequenceStep]} · ${date(draft.sentAt)}`;

export function OutcomeReport({ state, act, busy, initialLeadId, close, saved }) {
  const dialog = useRef(null);
  const requestId = useRef(crypto.randomUUID());
  const openedAt = useRef(new Date());
  const [timeEdited, setTimeEdited] = useState(false);
  const [leadId, setLeadId] = useState(initialLeadId || state.leads[0]?.id || '');
  const [kind, setKind] = useState('user_reported');
  const [stage, setStage] = useState('Replied');
  const [occurredAt, setOccurredAt] = useState(() => localMinute(openedAt.current));
  const [note, setNote] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [draftId, setDraftId] = useState('');
  const [respondentIndex, setRespondentIndex] = useState('');
  const [updateStage, setUpdateStage] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const account = state.leads.find(lead => lead.id === leadId);
  const outbound = state.drafts.filter(draft => draft.leadId === leadId && draft.status === (kind === 'demo' ? 'simulated' : 'accepted'));
  const changeAccount = id => { setLeadId(id); setDraftId(''); setRespondentIndex(''); setAcknowledged(false); };
  useEffect(() => { dialog.current.showModal(); }, []);
  const submit = async event => {
    event.preventDefault(); if (busy || !acknowledged) return;
    setError('');
    const person = respondentIndex === '' ? null : account?.people?.[Number(respondentIndex)];
    const payload = { requestId: requestId.current, revision: state.revision, kind, stage, occurredAt: timeEdited ? new Date(occurredAt).toISOString() : openedAt.current.toISOString(), note, evidenceUrl, draftId: draftId || null, respondent: person ? { name: person.name, source: person.source } : null, updateStage, acknowledged };
    const result = await act(`/leads/${leadId}/outcomes`, payload, 'POST', true, failure => setError(failure.message));
    if (result) { saved(result); close(); }
  };
  return <dialog ref={dialog} className="outcome-dialog" aria-labelledby="outcome-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }} onClick={event => { if (event.target === event.currentTarget && !busy) close(); }}>
    <header className="outcome-dialog-heading"><span><ClipboardCheck size={21} /></span><div><h2 id="outcome-dialog-title">Record an outcome</h2><p>Keep the result, evidence, and attribution together.</p></div><button className="icon-button" disabled={busy} aria-label="Close outcome report" onClick={close}><X size={19} /></button></header>
    <form onSubmit={submit}><fieldset disabled={busy} className="outcome-form"><div className="outcome-form-grid"><label>Account<select aria-label="Outcome account" value={leadId} onChange={event => changeAccount(event.target.value)} required autoFocus>{state.leads.map(lead => <option key={lead.id} value={lead.id}>{lead.name}</option>)}</select></label><label>Record type<select aria-label="Outcome record type" value={kind} onChange={event => { setKind(event.target.value); setDraftId(''); setAcknowledged(false); }}><option value="user_reported">Actual outcome · user-reported</option><option value="demo">Demo outcome · simulated</option></select></label><label>Milestone<select aria-label="Outcome milestone" value={stage} onChange={event => { setStage(event.target.value); setAcknowledged(false); }}>{stages.map(stage => <option key={stage}>{stage}</option>)}</select></label><label>When it happened<input aria-label="Outcome occurrence time" type="datetime-local" required value={occurredAt} max={localMinute()} onInput={event => { setOccurredAt(event.currentTarget.value); setTimeEdited(true); setAcknowledged(false); }} onChange={event => { setOccurredAt(event.target.value); setTimeEdited(true); setAcknowledged(false); }} /></label></div>
      <p className={`outcome-context ${kind === 'demo' ? 'demo' : ''}`}><Info size={15} /><span>{kind === 'demo' ? 'Demo observations do not establish customer responses. Linked messages are local dry runs.' : 'This records your report. It does not verify a response with an email or CRM provider.'}</span></p>
      <label>Outcome notes<textarea aria-label="Outcome notes" required rows={3} maxLength={2000} placeholder="Summarize what happened and the evidence you reviewed." value={note} onChange={event => { setNote(event.target.value); setAcknowledged(false); }} /></label>
      <details className="outcome-attribution" open={kind === 'demo' ? true : undefined}><summary>References & message attribution<small>Optional · link a recorded message for variant analysis</small></summary>
      <label>Reference link <small>Optional · stored without fetching</small><input aria-label="Outcome reference link" type="url" pattern="https://.*" placeholder="https://…" maxLength={1000} value={evidenceUrl} onChange={event => { setEvidenceUrl(event.target.value); setAcknowledged(false); }} /></label>
      <label>Link an outbound message <small>Optional · required for message attribution</small><select aria-label="Link outcome to outbound message" value={draftId} onChange={event => { setDraftId(event.target.value); setAcknowledged(false); }}><option value="">No message attribution</option>{outbound.map(draft => <option key={draft.id} value={draft.id}>{messageLabel(draft)}</option>)}</select></label>
      {!outbound.length && <p className="outcome-field-help">{kind === 'demo' ? 'No recorded dry run is available for this account.' : 'No provider-accepted message is available. Existing local dry runs can only be linked in Demo mode.'}</p>}
      <label>Reported respondent <small>Optional · existing published people only</small><select aria-label="Reported outcome respondent" value={respondentIndex} onChange={event => { setRespondentIndex(event.target.value); setAcknowledged(false); }}><option value="">Unknown / not recorded</option>{(account?.people || []).map((person, index) => <option key={`${person.name}-${person.source}`} value={index}>{person.name} · {person.role}</option>)}</select></label>
      </details>
      <label className="outcome-checkbox"><input type="checkbox" checked={updateStage} onChange={event => { setUpdateStage(event.target.checked); setAcknowledged(false); }} /><span>Update the current pipeline stage<small>Uncheck to add backdated history without changing the current stage.</small></span></label>
      <p className="outcome-field-help">Recording new account context clears unsent message approvals and requires a fresh version review.</p>
      <label className={`outcome-checkbox outcome-ack ${kind === 'demo' ? 'demo' : ''}`}><input aria-label="Confirm outcome report" type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>{kind === 'demo' ? 'I confirm this is a demo observation. It does not establish a real customer response.' : 'I confirm this is a manually reported outcome. The message and respondent attribution reflect my evidence.'}</span></label>
      {error && <div className="outcome-error" role="alert"><p>{error}</p><button className="text-button" type="button" onClick={() => act('', {}, 'GET', true, failure => setError(failure.message))}><RefreshCw size={13} />Refresh workspace</button></div>}
      <div className="outcome-form-actions"><span>No credits charged · no external message</span><button className="button secondary" type="button" onClick={close}>Cancel</button><button className="button primary" type="submit" disabled={!acknowledged || !note.trim() || !account}><ClipboardCheck size={15} />{busy ? 'Saving…' : 'Record outcome'}</button></div>
    </fieldset></form>
  </dialog>;
}

export function OutcomeHistory({ state, act, busy, receipt }) {
  const [pending, setPending] = useState(null);
  const rows = state.leads.flatMap(lead => (lead.events || []).filter(event => event.recordType === 'outcome').map(event => ({ lead, event }))).sort((a, b) => Date.parse(b.event.recordedAt) - Date.parse(a.event.recordedAt)).slice(0, 30);
  const retry = async (lead, event) => {
    setPending(event.id);
    await act(`/leads/${lead.id}/outcomes`, { requestId: event.requestId, revision: state.revision, kind: event.mode === 'dry_run' ? 'demo' : 'user_reported', stage: event.stage, occurredAt: event.at, note: event.note, evidenceUrl: event.evidenceUrl, draftId: event.draftId, respondent: event.respondent ? { name: event.respondent.name, source: event.respondent.source } : null, updateStage: event.updateStage, acknowledged: true });
    setPending(null);
  };
  if (!rows.length) return null;
  return <details className="outcome-history" open={receipt ? true : undefined}><summary><span>Outcome reports<small>{rows.length} recent {rows.length === 1 ? 'report' : 'reports'} · user-reported and demo records stay labeled</small></span></summary><div>{rows.map(({ lead, event }) => { const draft = state.drafts.find(draft => draft.id === event.draftId); return <article key={event.id} className="outcome-history-item"><div className="outcome-history-title"><div><strong>{lead.name}</strong><span>{event.stage}</span></div><span className={`outcome-type ${event.mode === 'dry_run' ? 'demo' : ''}`}>{event.mode === 'dry_run' ? 'Demo observation' : 'User-reported'}</span></div><p>{event.note}</p><div className="outcome-history-meta"><span>Occurred {date(event.at)}</span><span>Recorded by {event.actor} · {date(event.recordedAt)}</span><span>{event.updateStage ? 'Stage updated when recorded' : 'History only'}</span></div>{draft && <div className="outcome-message-link">Linked: {messageLabel(draft)}</div>}{event.respondent && <div className="outcome-message-link">Reported respondent: {event.respondent.name}. Attribution is {event.mode === 'dry_run' ? 'simulated' : 'user-reported'}.</div>}{event.evidenceUrl && <a href={event.evidenceUrl} target="_blank" rel="noreferrer">User-provided reference (unverified)<ExternalLink size={11} /></a>}<div className="outcome-projection">{event.graphStatus === 'synced' ? <><CheckCircle2 size={13} />Graph updated</> : <><Info size={13} />Saved · graph refresh pending<button disabled={busy || pending === event.id} onClick={() => retry(lead, event)}><RefreshCw size={12} />Retry graph refresh</button></>}</div></article>; })}</div></details>;
}
