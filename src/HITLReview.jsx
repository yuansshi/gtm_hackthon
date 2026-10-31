import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, CheckCircle2, ExternalLink, FileText, LockKeyhole, Mail, ShieldCheck, UserRound, X } from 'lucide-react';
import { profileOf } from './api';

const completedStatuses = ['simulated', 'accepted', 'dispatching', 'delivery_unknown'];
const needsReview = draft => ['draft', 'rejected'].includes(draft.status);
const firstDraft = drafts => drafts.find(needsReview)?.id || drafts[0]?.id || '';
const date = value => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const profileMatches = (draft, state) => state.approved && draft.profileHash === state.approvedProfileHash;
const statusLabel = (draft, state) => ({
  simulated: 'Dry run recorded', accepted: 'Delivery accepted', dispatching: 'Dispatch in progress', delivery_unknown: 'Delivery needs investigation',
}[draft.status] || (!profileMatches(draft, state) ? 'Profile review needed' : draft.status === 'approved' ? 'Human approved' : draft.status === 'rejected' ? 'Changes requested' : 'Needs human review'));

function ReviewFlow({ current, editing, state }) {
  const recorded = current?.status === 'simulated';
  const approved = current?.status === 'approved' && profileMatches(current, state) && !editing;
  const stage = recorded ? 3 : approved ? 2 : current ? 1 : 0;
  const labels = ['Prepare draft', 'HITL review', 'Approved for dry run', 'Dry run recorded'];
  return <ol className="hitl-flow" aria-label="Outreach approval stages">{labels.map((label, index) => <li key={label} className={`${index < stage ? 'complete' : ''} ${index === stage ? 'current' : ''} ${index === 1 ? 'human-stage' : ''}`} aria-current={index === stage ? 'step' : undefined}>
    <span className="hitl-step-icon">{index < stage ? <Check size={16} /> : index === 1 ? <UserRound size={17} /> : index + 1}</span>
    <div><strong>{label}</strong><small>{index < stage ? 'Complete' : index === stage ? index === 1 ? 'Your decision required' : recorded ? 'Complete · demo only' : 'Current stage' : 'Up next'}</small></div>
    {index < labels.length - 1 && <ArrowRight className="hitl-step-arrow" size={16} />}
  </li>)}</ol>;
}

export function Outreach({ state, act, busy, go }) {
  const leads = (state.leads || []).filter(lead => lead.selected);
  const drafts = state.drafts || [];
  const pending = drafts.filter(needsReview);
  const [leadId, setLeadId] = useState(leads[0]?.id || '');
  const [channel, setChannel] = useState('email');
  const [variant, setVariant] = useState('A');
  const [sequenceStep, setSequenceStep] = useState(0);
  const [activeId, setActiveId] = useState(() => firstDraft(drafts));
  const [generation, setGeneration] = useState('template');
  const [modelAck, setModelAck] = useState(false);
  const [editing, setEditing] = useState(null);
  const [ack, setAck] = useState(false);
  const generationRequest = useRef(null);
  const decisionRef = useRef(null);
  const current = drafts.find(draft => draft.id === activeId);
  const currentOutcomes = (state.leads.find(lead => lead.id === current?.leadId)?.events || []).filter(event => event.recordType === 'outcome').sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt)).slice(0, 3);
  const value = editing || current;
  const locked = completedStatuses.includes(current?.status);
  const validProfile = current && profileMatches(current, state);
  const approved = current?.status === 'approved' && validProfile && !editing;
  const recorded = current?.status === 'simulated';
  const reviewLabel = editing ? 'Unsaved changes' : current ? statusLabel(current, state) : 'Waiting for a draft';
  const queue = [...drafts].sort((a, b) => Number(needsReview(b)) - Number(needsReview(a)));

  useEffect(() => { if (!leads.some(lead => lead.id === leadId)) setLeadId(leads[0]?.id || ''); }, [leads, leadId]);
  useEffect(() => {
    if (!drafts.some(draft => draft.id === activeId)) { setActiveId(firstDraft(drafts)); setEditing(null); setAck(false); }
  }, [state.drafts, activeId]);

  const activate = id => { setActiveId(id); setEditing(null); setAck(false); };
  const prepareDraft = async () => {
    const key = JSON.stringify({ leadId, channel, variant, sequenceStep, profile: profileOf(state) });
    if (generationRequest.current?.key !== key) generationRequest.current = { key, id: crypto.randomUUID() };
    const result = await act(`/leads/${leadId}/drafts`, { channel, variant, sequenceStep, generation, ...(generation === 'model' ? { requestId: generationRequest.current.id, acknowledgedExternalProcessing: modelAck, revision: state.revision } : {}) });
    if (result) activate(result.activeDraftId);
  };
  const edit = key => event => {
    setAck(false);
    setEditing(previous => ({ ...(previous || { recipient: current.recipient, subject: current.subject, body: current.body }), [key]: event.target.value }));
  };
  const saveEdits = async () => {
    const result = await act(`/drafts/${current.id}`, { ...editing, version: current.version }, 'PATCH');
    if (result) { setEditing(null); setAck(false); }
  };
  const openReview = () => {
    const next = pending.find(draft => draft.id === activeId) || pending[0];
    if (next && next.id !== activeId) activate(next.id);
    decisionRef.current?.focus({ preventScroll: true });
    decisionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const sources = current?.sources || [];

  return <div className="hitl-workspace">
    <div className="page-heading"><div><div className="eyebrow">Module 04 / HITL review & outreach</div><h1>Review before outreach.</h1><p>Prepare a relevant introduction. A person reviews and approves the exact version.</p></div><div className="heading-actions"><button className="button secondary" onClick={() => go('pipeline')}>View pipeline<ArrowRight size={15} /></button></div></div>

    <section className={`hitl-checkpoint ${pending.length ? 'awaiting' : ''}`} aria-labelledby="hitl-checkpoint-title">
      <span className="hitl-checkpoint-icon"><ShieldCheck size={29} /></span>
      <div className="hitl-checkpoint-copy"><div className="eyebrow">Required human-in-the-loop checkpoint</div><h2 id="hitl-checkpoint-title">HITL review</h2><p>Check the recipient, message, and sources. Approve this exact version before a dry run can proceed.</p></div>
      <div className="hitl-checkpoint-action"><span><strong>{pending.length}</strong> {pending.length === 1 ? 'message needs' : 'messages need'} human review</span><button className="button hitl-primary" disabled={!pending.length || !!editing} onClick={openReview}><UserRound size={16} />Review next message<ArrowRight size={15} /></button></div>
    </section>
    <ReviewFlow current={current} editing={editing} state={state} />

    {!leads.length ? drafts.length ? <div className="hitl-prepare-note"><FileText size={16} /><span>Shortlist an account to prepare another draft. Existing messages remain available for review.</span><button className="text-button" onClick={() => go('discovery')}>Open discovery<ArrowRight size={14} /></button></div> : <section className="panel workflow-empty"><Mail size={28} /><h2>Prepare the first message for review</h2><p>Shortlist an account in discovery, then prepare a source-grounded draft. Human approval comes next.</p><button className="button primary" onClick={() => go('discovery')}>Open discovery<ArrowRight size={15} /></button></section> : <details className="panel hitl-composer" open={drafts.length === 0 ? true : undefined}>
      <summary><Mail size={17} /><strong>Prepare a {drafts.length ? 'new' : 'source-grounded'} draft</strong><span>Every new version requires human review</span></summary>
      <div className="compose-controls"><label>Shortlisted account<select value={leadId} onChange={event => setLeadId(event.target.value)}>{leads.map(lead => <option key={lead.id} value={lead.id}>{lead.name}</option>)}</select></label><label>Channel<select value={channel} onChange={event => setChannel(event.target.value)}><option value="email">Email</option><option value="linkedin">LinkedIn</option></select></label><label>Variant<select value={variant} onChange={event => setVariant(event.target.value)}><option>A</option><option>B</option></select></label><label>Sequence<select value={sequenceStep} onChange={event => setSequenceStep(Number(event.target.value))}><option value={0}>Introduction / day 0</option><option value={1}>Follow-up / day 3</option><option value={2}>Follow-up / day 7</option></select></label><label>Draft method<select value={generation} onChange={event => { setGeneration(event.target.value); setModelAck(false); generationRequest.current = null; }}><option value="template">Source template · free</option><option value="model" disabled={!state.assistant?.configured}>AI model · 2 credits</option></select></label><button className="button primary" disabled={busy || !state.approved || !leadId || (generation === 'model' && !modelAck)} onClick={prepareDraft}><Mail size={15} />Prepare draft</button></div>
      {generation === 'model' && <label className="assistant-consent draft-model-consent"><input type="checkbox" checked={modelAck} onChange={event => setModelAck(event.target.checked)} />Send this business’s supplier brief and this account’s public evidence to the configured OpenAI project model. A generated draft still requires exact-message approval.</label>}
    </details>}

    {!!drafts.length && <div className="outreach-layout hitl-review-layout">
      <aside className="panel draft-list"><div className="section-heading"><div><h2>Review queue</h2><p>{pending.length} awaiting a decision</p></div></div>{queue.map(draft => <button className={draft.id === activeId ? 'active' : ''} key={draft.id} aria-pressed={draft.id === activeId} onClick={() => activate(draft.id)}><strong>{state.leads.find(lead => lead.id === draft.leadId)?.name || 'Account'}</strong><span>{draft.channel} / {draft.variant} / day {draft.suggestedDay}</span><small className={`hitl-queue-status ${needsReview(draft) ? 'pending' : ''}`}><span aria-hidden="true">{draft.status === 'simulated' ? '✓' : needsReview(draft) ? '●' : '✓'}</span>{statusLabel(draft, state)}</small><span className="hitl-queue-version">Version {draft.version}</span></button>)}</aside>

      <section className="panel message-review" aria-label="Exact message and sources">{current ? <><div className="section-heading"><div><h2>{state.leads.find(lead => lead.id === current.leadId)?.name || 'Message'} introduction</h2><p>Version {current.version} / {current.channel} / variant {current.variant}</p></div><FileText size={19} /></div><div className="review-fields"><p className="hitl-generation">{current.generation}</p>{currentOutcomes.length > 0 && <section className="hitl-outcome-context"><h3>Reported account context</h3>{current.reviewReason === 'account_outcome_changed' && <p>New outcome context requires this message version to be reviewed again.</p>}{currentOutcomes.map(event => <details key={event.id}><summary>{event.stage} · {event.mode === 'dry_run' ? 'Demo observation' : 'User-reported'} · {date(event.at)}</summary><p>{event.note}</p>{event.evidenceUrl && <a className="source-link" href={event.evidenceUrl} target="_blank" rel="noreferrer">User-provided reference (unverified)<ExternalLink size={11} /></a>}</details>)}</section>}<label>Recipient<input aria-label="Outreach recipient" disabled={locked || busy} value={value.recipient} onChange={edit('recipient')} placeholder={current.channel === 'email' ? 'Published address, when available' : 'Known LinkedIn profile URL'} /></label><small>Public company addresses are not verified decision-maker mailboxes. Do not invent contact details.</small><label>Subject<input aria-label="Outreach subject" disabled={locked || busy} value={value.subject} onChange={edit('subject')} /></label><label>Message<textarea aria-label="Outreach message" rows={16} disabled={locked || busy} value={value.body} onChange={edit('body')} /></label><div className="message-sources"><h3><BookOpen size={15} />Evidence to review</h3>{sources.map((url, index) => <a className="source-link" key={url} href={url} target="_blank" rel="noreferrer"><BookOpen size={13} />Source {index + 1}<ExternalLink size={11} /></a>)}</div>{current.claims && <div className="model-claims"><h3>Model-proposed claims to verify</h3><p>Source URLs are checked against this account’s evidence. Factual correctness still requires your review.</p>{current.claims.map((claim, index) => <div key={index}><span>{claim.text}</span><a className="source-link" href={claim.sourceUrl} target="_blank" rel="noreferrer">Primary source<ExternalLink size={11} /></a></div>)}<small>{current.modelMetadata?.model} / {current.modelMetadata?.usage?.inputTokens ?? '—'} input tokens / {current.modelMetadata?.usage?.outputTokens ?? '—'} output tokens</small></div>}</div></> : <div className="inline-empty">Choose a message from the review queue.</div>}</section>

      <aside className={`hitl-decision ${approved || recorded ? 'approved' : ''}`} aria-labelledby="hitl-decision-title" tabIndex={-1} ref={decisionRef}>
        <div className="hitl-decision-heading"><span className="hitl-decision-icon">{approved || recorded ? <CheckCircle2 size={23} /> : <UserRound size={23} />}</span><div><span className="eyebrow">Human decision</span><h2 id="hitl-decision-title">HITL review</h2></div></div>
        <div className="hitl-decision-content" aria-live="polite"><span className={`hitl-status ${approved || recorded ? 'approved' : ''}`}>{reviewLabel}</span>
          {current && <><p className="hitl-review-context">{state.leads.find(lead => lead.id === current.leadId)?.name} · Version {current.version}</p>
            {locked ? <div className="hitl-approved-receipt"><CheckCircle2 size={25} /><strong>{recorded ? 'Human review completed' : reviewLabel}</strong><p>{recorded ? `Dry run recorded ${date(current.sentAt)}.` : 'This message is locked. Inspect its delivery record before continuing.'}</p>{current.approvedAt && <small>Approved by you · {date(current.approvedAt)}</small>}{current.deliveryId && <small>Receipt: {current.deliveryId}</small>}</div> : <>
              {approved ? <div className="hitl-approved-receipt"><CheckCircle2 size={25} /><strong>You approved version {current.version}</strong><p>{date(current.approvedAt)}. This exact recipient and message are approved for a demo dry run.</p></div> : <><p>Review these details before you approve:</p><ul className="hitl-checklist"><li><Mail size={15} /><span>Correct recipient and channel</span></li><li><FileText size={15} /><span>Relevant message and qualified claims</span></li><li><BookOpen size={15} /><span>Supporting public sources</span></li></ul></>}
              {editing ? <div className="hitl-edit-notice"><strong>New edits need a new review.</strong><p>Save your changes first. Saving creates a new version and clears its previous approval.</p><button className="button hitl-primary" disabled={busy} onClick={saveEdits}>Save edits & clear approval</button></div> : !validProfile ? <div className="hitl-edit-notice"><strong>Profile review needed</strong><p>{state.approved ? 'The supplier profile changed. Prepare a new draft using the current approved profile.' : 'Approve the supplier profile before reviewing outreach.'}</p><button className="button secondary" onClick={() => go('product')}>Review business profile<ArrowRight size={14} /></button></div> : !approved && <label className="hitl-ack"><input type="checkbox" checked={ack} disabled={busy} onChange={event => setAck(event.target.checked)} /><span>I reviewed the recipient, message, account context, sources, and version {current.version}.</span></label>}
              {!approved && <button className="button hitl-primary hitl-approve" disabled={busy || !!editing || !ack || !validProfile} onClick={() => act(`/drafts/${current.id}/approve`, { acknowledged: ack, version: current.version })}><ShieldCheck size={17} />Approve exact version</button>}
              <button className="button hitl-reject" disabled={busy || !!editing || current.status === 'rejected'} onClick={async () => { const result = await act(`/drafts/${current.id}/reject`); if (result) setAck(false); }}><X size={15} />{approved ? 'Revoke approval' : 'Request changes'}</button>
              <p className="hitl-version-note">Technical and commercial claims still require separate qualification. Saved edits require approval again.</p>
              <div className="hitl-next-action"><span><LockKeyhole size={14} />{approved ? 'Next: demo outreach' : 'Outreach waits for approval'}</span><button className="button primary" disabled={busy || !approved || !current.recipient.trim()} onClick={async () => { const result = await act(`/drafts/${current.id}/simulate`); if (result) setAck(false); }}>Record dry run · 1 credit<ArrowRight size={15} /></button>{approved && !current.recipient.trim() && <small>Add a recipient, save, and approve the new version.</small>}</div>
            </>}
          </>}
        </div>
        <div className="hitl-demo-note"><ShieldCheck size={15} /><span>Demo only. No email or LinkedIn message leaves this portal.</span></div>
      </aside>
    </div>}
  </div>;
}
