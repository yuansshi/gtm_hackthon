import { defaultMessageBrief, assessMessageBrief } from './message-brief.js';
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, CheckCircle2, ExternalLink, FileText, LockKeyhole, Mail, ShieldCheck, UserRound, X } from 'lucide-react';
import { profileOf } from './api';
import { contactMailboxLabel } from './ContactResearch.jsx';
import { MessageSignalEvidence } from './MarketSignals.jsx';
import { signalFresh } from './market-signals.js';
import { CompanyProfileContext } from './CompanyResearch.jsx';
import { companyHoldReasons, draftCompanyEvidenceCurrent } from './company-evidence.js';

const MessageBriefControls = lazy(() => import('./MessageBrief.jsx').then(module => ({ default: module.MessageBriefControls })));
const MessageBriefReview = lazy(() => import('./MessageBrief.jsx').then(module => ({ default: module.MessageBriefReview })));
const BandTeam = lazy(() => import('./BandTeam.jsx'));
const BandPacket = lazy(() => import('./BandTeam.jsx').then(module => ({ default: module.BandPacket })));
const CommunicationControls = lazy(() => import('./CommunicationControls.jsx'));
const EmailDelivery = lazy(() => import('./EmailDelivery.jsx'));
const LiveEmailDetails = lazy(() => import('./EmailDelivery.jsx').then(module => ({ default: module.LiveEmailDetails })));
const completedStatuses = ['simulated', 'accepted', 'dispatching', 'delivery_unknown'];
const needsReview = draft => ['draft', 'rejected'].includes(draft.status);
const firstDraft = drafts => drafts.find(needsReview)?.id || drafts[0]?.id || '';
const date = value => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const profileMatches = (draft, state) => state.approved && draft.profileHash === state.approvedProfileHash;
const statusLabel = (draft, state) => {
  const receipt = { simulated: 'Dry run recorded', accepted: 'Provider accepted', dispatching: 'Dispatch in progress', delivery_unknown: 'Delivery needs investigation' }[draft.status];
  if (receipt) return receipt;
  if (draft.communicationStatus?.blocked) return draft.communicationStatus.code === 'invalid_recipient' ? 'Recipient needs review' : 'Do not contact';
  if (!profileMatches(draft, state)) return 'Profile review needed';
  return draft.status === 'approved' ? 'Human approved' : draft.status === 'rejected' ? 'Changes requested' : 'Needs human review';
};

function ReviewFlow({ current, editing, state, deliveryMode }) {
  const recorded = current?.status === 'simulated';
  const account=(state.leads || []).find(lead=>lead.id===current?.leadId);
  const evidenceCurrent=(current?.linkedSignalIds||[]).every(id=>signalFresh(account?.marketSignals?.find(signal=>signal.id===id)||{}));
  const approved = current?.status === 'approved' && profileMatches(current, state) && !editing && evidenceCurrent && !account?.excludedReason && !current?.communicationStatus?.blocked && !companyHoldReasons(account||{},state).length && draftCompanyEvidenceCurrent(current,account);
  const submitted = completedStatuses.includes(current?.status);
  const live = deliveryMode === 'live';
  const stage = submitted ? 3 : approved ? 2 : current ? 1 : 0;
  const labels = ['Prepare draft', 'HITL review', live ? 'Approved for live email' : 'Approved for dry run', live ? current?.status === 'delivery_unknown' ? 'Acceptance unknown' : current?.status === 'accepted' ? 'Provider accepted' : 'Provider outcome' : 'Dry run recorded'];
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
  const [bandPlan, setBandPlan] = useState(null), [bandAck, setBandAck] = useState(false);
  const usesBand = generation.startsWith('band_'), usesModel = generation === 'model' || generation === 'band_model';
  const bandRunning = state.band?.runs?.some(run => ['planning','waiting_builder','building','waiting_reviewer','reviewing','waiting_security','security_review','waiting_planner'].includes(run.status));
  const [messageBrief, setMessageBrief] = useState({ ...defaultMessageBrief });
  const [editing, setEditing] = useState(null);
  const [ack, setAck] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState('dry_run'), [sendAck, setSendAck] = useState(false);
  const sendRequest = useRef(null);
  const generationRequest = useRef(null);
  const decisionRef = useRef(null);
  const current = drafts.find(draft => draft.id === activeId);
  const currentAccount = (state.leads || []).find(lead => lead.id === current?.leadId);
  const currentOutcomes = ((state.leads || []).find(lead => lead.id === current?.leadId)?.events || []).filter(event => event.recordType === 'outcome').sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt)).slice(0, 3);
  const value = editing || (completedStatuses.includes(current?.status) && current?.approvedDeliveryMode === 'live' ? { ...current, body: current.approvedLiveMessage.body } : current);
  const locked = completedStatuses.includes(current?.status);
  const briefAssessment = assessMessageBrief(locked ? current : value);
  const changeBrief = brief => { setAck(false); setSendAck(false); setEditing(previous => ({ ...(previous || { recipient: current.recipient, subject: current.subject, body: current.body }), messageBrief: brief })); };
  const validProfile = current && profileMatches(current, state);
  const accountHold=current?.communicationStatus?.blocked ? current.communicationStatus.message : currentAccount?.excludedReason||companyHoldReasons(currentAccount||{},state).join(' ');
  const companyEvidenceCurrent=draftCompanyEvidenceCurrent(current,currentAccount);
  const signalEvidenceCurrent=(current?.linkedSignalIds||[]).every(id=>signalFresh(currentAccount?.marketSignals?.find(signal=>signal.id===id)||{}));
  const approved = current?.status === 'approved' && validProfile && !editing && signalEvidenceCurrent && !accountHold && companyEvidenceCurrent && briefAssessment.valid;
  const recorded = current?.status === 'simulated';
  const providerAccepted = current?.status === 'accepted';
  const livePreview = current?.approvedDeliveryMode === 'live' && ['approved', ...completedStatuses].includes(current?.status) ? current.approvedLiveMessage : current?.livePreview;
  const live = current?.status === 'approved' || locked ? current?.approvedDeliveryMode === 'live' : deliveryMode === 'live';
  const reviewLabel = editing ? 'Unsaved changes' : !locked && accountHold ? 'Account on hold' : !locked && !companyEvidenceCurrent ? 'Company review needed' : !locked && !signalEvidenceCurrent ? 'Signal review needed' : !locked && !briefAssessment.valid ? 'Message brief needs attention' : current ? statusLabel(current, state) : 'Waiting for a draft';
  const queue = [...drafts].sort((a, b) => Number(needsReview(b)) - Number(needsReview(a)));
  useEffect(() => { setAck(false); setSendAck(false); setDeliveryMode(current?.approvedDeliveryMode || 'dry_run'); }, [current?.id, current?.version, current?.status, current?.approvedDeliveryMode, state.approvedProfileHash]);

  useEffect(() => { setModelAck(false); generationRequest.current = null; }, [leadId, channel, variant, sequenceStep, messageBrief, state.approvedProfileHash]);
  useEffect(() => { if (!leads.some(lead => lead.id === leadId)) setLeadId(leads[0]?.id || ''); }, [leads, leadId]);
  useEffect(() => {
    if (!drafts.some(draft => draft.id === activeId)) { setActiveId(firstDraft(drafts)); setEditing(null); setAck(false); }
  }, [state.drafts, activeId]);

  const activate = id => { setActiveId(id); setEditing(null); setAck(false); };
  const prepareDraft = async () => {
    const key = JSON.stringify({ leadId, channel, variant, sequenceStep, messageBrief, generation, preview: usesBand ? bandPlan?.previewHash : null, profile: profileOf(state) });
    if (generationRequest.current?.key !== key) generationRequest.current = { key, id: crypto.randomUUID() };
    const result = usesBand ? await act('/band/runs', { leadId, channel, variant, sequenceStep, generation: usesModel ? 'model' : 'template', messageBrief, requestId: generationRequest.current.id, revision: Math.max(state.revision, bandPlan.revision), previewHash: bandPlan.previewHash, acknowledged: bandAck, acknowledgedModelProcessing: modelAck }) : await act(`/leads/${leadId}/drafts`, { channel, variant, sequenceStep, generation, messageBrief, ...(usesModel ? { requestId: generationRequest.current.id, acknowledgedExternalProcessing: modelAck, revision: state.revision } : {}) });
    if (result?.activeDraftId) activate(result.activeDraftId); if (result && usesBand) { setBandAck(false); setModelAck(false); generationRequest.current = null; }
  };
  const edit = key => event => {
    setAck(false);
    setEditing(previous => ({ ...(previous || { recipient: current.recipient, subject: current.subject, body: current.body, ...(current.messageBrief ? { messageBrief: current.messageBrief } : {}) }), [key]: event.target.value }));
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
  const dispatchLive = async () => {
    const key = JSON.stringify({ draftId: current.id, version: current.version, hash: current.approvedHash });
    if (sendRequest.current?.key !== key) sendRequest.current = { key, id: crypto.randomUUID() };
    const result = await act(`/drafts/${current.id}/send`, { requestId: sendRequest.current.id, version: current.version, acknowledged: sendAck });
    if (result) setSendAck(false);
  };
  const sources = current?.sources || [];

  return <div className="hitl-workspace">
    <div className="page-heading"><div><div className="eyebrow">Module 04 / HITL review & outreach</div><h1>Review before outreach.</h1><p>Prepare a relevant introduction. A person reviews and approves the exact version.</p></div><div className="heading-actions"><button className="button secondary" onClick={() => go('pipeline')}>View pipeline<ArrowRight size={15} /></button></div></div>

    <section className={`hitl-checkpoint ${pending.length ? 'awaiting' : ''}`} aria-labelledby="hitl-checkpoint-title">
      <span className="hitl-checkpoint-icon"><ShieldCheck size={29} /></span>
      <div className="hitl-checkpoint-copy"><div className="eyebrow">Required human-in-the-loop checkpoint</div><h2 id="hitl-checkpoint-title">HITL review</h2><p>Check the recipient, message, and sources. Approve this exact version before the selected dry run or live email can proceed.</p></div>
      <div className="hitl-checkpoint-action"><span><strong>{pending.length}</strong> {pending.length === 1 ? 'message needs' : 'messages need'} human review</span><button className="button hitl-primary" disabled={!pending.length || !!editing} onClick={openReview}><UserRound size={16} />Review next message<ArrowRight size={15} /></button></div>
    </section>
    {(state.signalFixture||state.companyFixture)&&<div className="notice">Test fixture only · synthetic research evidence. No external message is sent.</div>}
    <ReviewFlow current={current} editing={editing} state={state} deliveryMode={live ? 'live' : 'dry_run'} />
    <Suspense fallback={<p>Loading communication preferences…</p>}><CommunicationControls state={state} act={act} busy={busy} /></Suspense>
    <Suspense fallback={<p>Loading project email…</p>}><EmailDelivery state={state} act={act} busy={busy}/></Suspense>
    <Suspense fallback={<p>Loading project agents…</p>}><BandTeam state={state} act={act} busy={busy} onReviewDraft={id => { activate(id); decisionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}/></Suspense>

    {!leads.length ? drafts.length ? <div className="hitl-prepare-note"><FileText size={16} /><span>Shortlist an account to prepare another draft. Existing messages remain available for review.</span><button className="text-button" onClick={() => go('discovery')}>Open discovery<ArrowRight size={14} /></button></div> : <section className="panel workflow-empty"><Mail size={28} /><h2>Prepare the first message for review</h2><p>Shortlist an account in discovery, then prepare a source-grounded draft. Human approval comes next.</p><button className="button primary" onClick={() => go('discovery')}>Open discovery<ArrowRight size={15} /></button></section> : <details className="panel hitl-composer" open={drafts.length === 0 ? true : undefined}>
      <summary><Mail size={17} /><strong>Prepare a {drafts.length ? 'new' : 'source-grounded'} draft</strong><span>Every new version requires human review</span></summary>
      <div className="compose-controls"><label>Shortlisted account<select value={leadId} onChange={event => setLeadId(event.target.value)}>{leads.map(lead => <option key={lead.id} value={lead.id}>{lead.name}</option>)}</select></label><label>Channel<select value={channel} onChange={event => setChannel(event.target.value)}><option value="email">Email</option><option value="linkedin">LinkedIn</option></select></label><label>Variant<select value={variant} onChange={event => setVariant(event.target.value)}><option>A</option><option>B</option></select></label><label>Sequence<select value={sequenceStep} onChange={event => setSequenceStep(Number(event.target.value))}><option value={0}>Introduction / day 0</option><option value={1}>Follow-up / day 3</option><option value={2}>Follow-up / day 7</option></select></label><label>Draft method<select value={generation} onChange={event => { setGeneration(event.target.value); setModelAck(false); generationRequest.current = null; }}><option value="template">Source template · free</option><option value="model" disabled={!state.assistant?.configured}>AI model · 2 credits</option><option value="band_template" disabled={!state.band?.connected || state.band?.requiresInvestigation}>Band team · source template</option><option value="band_model" disabled={!state.band?.connected || state.band?.requiresInvestigation || !state.assistant?.configured}>Band team · AI model · 2 credits</option></select></label><button className="button primary" disabled={busy || !!editing || !state.approved || !leadId || !!leads.find(lead=>lead.id===leadId)?.communicationStatus?.[channel]?.blocked || (usesModel && !modelAck) || (usesBand && (!bandPlan || !bandAck || !state.band?.connected || state.band?.requiresInvestigation || bandRunning))} onClick={prepareDraft}><Mail size={15} />Prepare draft</button></div>
      <Suspense fallback={<p>Loading message brief…</p>}><MessageBriefControls value={messageBrief} disabled={busy || !!editing} onChange={brief => { setMessageBrief(brief); setModelAck(false); generationRequest.current = null; }}/></Suspense>
      {usesBand && <Suspense fallback={<p>Loading public Band packet…</p>}><BandPacket state={state} options={{ leadId, channel, variant, sequenceStep, generation: usesModel ? 'model' : 'template', messageBrief }} onPlan={setBandPlan} acknowledged={bandAck} onAcknowledge={setBandAck}/></Suspense>}
      {usesModel && <label className="assistant-consent draft-model-consent"><input type="checkbox" checked={modelAck} onChange={event => setModelAck(event.target.checked)} />Send this business’s supplier brief and this account’s public evidence to the configured OpenAI project model. A generated draft still requires exact-message approval.</label>}
    </details>}

    {!!drafts.length && <div className="outreach-layout hitl-review-layout">
      <aside className="panel draft-list"><div className="section-heading"><div><h2>Review queue</h2><p>{pending.length} awaiting a decision</p></div></div>{queue.map(draft => <button className={draft.id === activeId ? 'active' : ''} key={draft.id} aria-pressed={draft.id === activeId} onClick={() => activate(draft.id)}><strong>{(state.leads || []).find(lead => lead.id === draft.leadId)?.name || 'Account'}</strong><span>{draft.channel} / {draft.variant} / day {draft.suggestedDay}</span><small className={`hitl-queue-status ${needsReview(draft) ? 'pending' : ''}`}><span aria-hidden="true">{draft.status === 'simulated' ? '✓' : needsReview(draft) ? '●' : '✓'}</span>{statusLabel(draft, state)}</small><span className="hitl-queue-version">Version {draft.version}</span></button>)}</aside>

      <section className="panel message-review" aria-label="Exact message and sources">{current ? <><div className="section-heading"><div><h2>{(state.leads || []).find(lead => lead.id === current.leadId)?.name || 'Message'} introduction</h2><p>Version {current.version} / {current.channel} / variant {current.variant}</p></div><FileText size={19} /></div><div className="review-fields"><p className="hitl-generation">{current.generation}</p>{['account_contact_changed', 'contact_processing_restricted', 'communication_restricted'].includes(current.reviewReason) && <div className="hitl-outcome-context"><h3>{current.reviewReason === 'account_contact_changed' ? 'Selected contact changed' : current.reviewReason === 'communication_restricted' ? 'Communication preferences changed' : 'Contact processing restricted'}</h3><p>Editable recipients and message versions changed. Review the contact evidence and exact recipient before approving again.</p><a className="source-link" href="#discovery">Review account contacts</a></div>}{current.reviewReason === 'account_source_changed' && <div className="hitl-outcome-context"><h3>Account source evidence changed</h3><p>Review the current account evidence and revise this message before approving its new version.</p><a className="source-link" href="#discovery">Review account research</a></div>}{currentOutcomes.length > 0 && <section className="hitl-outcome-context"><h3>Reported account context</h3>{current.reviewReason === 'account_outcome_changed' && <p>New outcome context requires this message version to be reviewed again.</p>}{currentOutcomes.map(event => <details key={event.id}><summary>{event.stage} · {event.mode === 'dry_run' ? 'Demo observation' : 'User-reported'} · {date(event.at)}</summary><p>{event.note}</p>{event.evidenceUrl && <a className="source-link" href={event.evidenceUrl} target="_blank" rel="noreferrer">User-provided reference (unverified)<ExternalLink size={11} /></a>}</details>)}</section>}<MessageSignalEvidence draft={current} account={currentAccount}/><CompanyProfileContext account={currentAccount} state={state}/>{!companyEvidenceCurrent&&<div className="hitl-edit-notice"><strong>Company evidence changed or expired</strong><p>Prepare a fresh draft from current reviewed HQ evidence before approval or dispatch.</p></div>}<Suspense fallback={<p>Loading saved brief…</p>}><MessageBriefReview draft={current} displayed={value} locked={locked} busy={busy} onChange={changeBrief}/></Suspense><label>Recipient<input aria-label="Outreach recipient" disabled={locked || busy} value={value.recipient} onChange={edit('recipient')} placeholder={current.channel === 'email' ? 'Published address, when available' : 'Known LinkedIn profile URL'} /></label><small>Review the selected contact’s source and dated verification. Buying authority remains unverified. Do not invent contact details.</small>{currentAccount?.contact?.provenance === 'hunter_reviewed' && <div className="hitl-outcome-context"><h3>Selected contact evidence</h3><p>{currentAccount.contact.name || 'Company mailbox'}{currentAccount.contact.role ? ` · ${currentAccount.contact.role}` : ''}</p><p>{contactMailboxLabel(currentAccount.contact)} · Provider date {currentAccount.contact.verification?.verificationDate || 'unknown'}. Buying authority is unverified.</p>{current.recipient !== (current.channel === 'email' ? currentAccount.contact.email : currentAccount.contact.linkedIn || '') && <p>This message’s recipient differs from the currently selected contact.</p>}</div>}<label>Subject<input aria-label="Outreach subject" disabled={locked || busy} value={value.subject} onChange={edit('subject')} /></label><label>Message<textarea aria-label="Outreach message" rows={16} disabled={locked || busy} value={value.body} onChange={edit('body')} /></label><div className="message-sources"><h3><BookOpen size={15} />Evidence to review</h3>{sources.map((url, index) => <a className="source-link" key={url} href={url} target="_blank" rel="noreferrer"><BookOpen size={13} />Source {index + 1}<ExternalLink size={11} /></a>)}</div>{current.claims && <div className="model-claims"><h3>Model-proposed claims to verify</h3><p>Source URLs are checked against this account’s evidence. Factual correctness still requires your review.</p>{current.claims.map((claim, index) => <div key={index}><span>{claim.text}</span><a className="source-link" href={claim.sourceUrl} target="_blank" rel="noreferrer">Primary source<ExternalLink size={11} /></a></div>)}<small>{current.modelMetadata?.model} / {current.modelMetadata?.usage?.inputTokens ?? '—'} input tokens / {current.modelMetadata?.usage?.outputTokens ?? '—'} output tokens</small></div>}{(live || current.approvedDeliveryMode === 'live') && <Suspense fallback={<p>Loading live preview…</p>}><LiveEmailDetails message={livePreview} originalBody={current.body} locked={locked}/></Suspense>}</div></> : <div className="inline-empty">Choose a message from the review queue.</div>}</section>

      <aside className={`hitl-decision ${approved || recorded || providerAccepted ? 'approved' : ''}`} aria-labelledby="hitl-decision-title" tabIndex={-1} ref={decisionRef}>
        <div className="hitl-decision-heading"><span className="hitl-decision-icon">{approved || recorded || providerAccepted ? <CheckCircle2 size={23} /> : <UserRound size={23} />}</span><div><span className="eyebrow">Human decision</span><h2 id="hitl-decision-title">HITL review</h2></div></div>
        <div className="hitl-decision-content" aria-live="polite"><span className={`hitl-status ${approved || recorded || providerAccepted ? 'approved' : ''}`}>{reviewLabel}</span>
          {current && <><p className="hitl-review-context">{(state.leads || []).find(lead => lead.id === current.leadId)?.name} · Version {current.version}</p>
            {!locked&&accountHold&&<div className="hitl-edit-notice"><strong>Account on hold</strong><p>{accountHold}</p><a href="#discovery">Review account evidence</a></div>}{locked ? <div className="hitl-approved-receipt"><CheckCircle2 size={25} /><strong>{recorded ? 'Human review completed' : reviewLabel}</strong><p>{recorded ? `Dry run recorded ${date(current.sentAt)}.` : providerAccepted ? `Provider accepted ${date(current.providerAcceptedAt)}. Delivery status: ${current.deliveryStatus || 'awaiting event'}. No reply is inferred.` : 'Acceptance is unresolved. This message is locked and will not replay; inspect Project email delivery receipts.'}</p>{current.approvedAt && <small>Approved by you · {date(current.approvedAt)}</small>}{current.deliveryId && <small>Receipt: {current.deliveryId}</small>}</div> : <>
              {approved ? <div className="hitl-approved-receipt"><CheckCircle2 size={25} /><strong>You approved version {current.version}</strong><p>{date(current.approvedAt)}. This exact recipient and message are approved for {live ? 'live email, including sender and footer' : 'a demo dry run'}.</p></div> : <><div className="mail-review-mode"><label>Approval mode<select aria-label="Approval mode" value={deliveryMode} disabled={busy || !!editing} onChange={event => { setDeliveryMode(event.target.value); setAck(false); setSendAck(false); }}><option value="dry_run">Dry run · no external message</option><option value="live" disabled={current.channel !== 'email' || !state.delivery?.available}>Live email · SendGrid</option></select></label><small>{live ? 'Review the exact sender, reply address, body and unsubscribe footer. A separate send confirmation follows approval.' : 'This approval records only a local dry run.'}</small></div><p>Review these details before you approve:</p><ul className="hitl-checklist"><li><Mail size={15} /><span>Correct recipient and channel</span></li><li><FileText size={15} /><span>Relevant audience, tone, call to action and qualified claims</span></li><li><BookOpen size={15} /><span>Supporting public sources</span></li></ul></>}
              {editing ? <div className="hitl-edit-notice"><strong>New edits need a new review.</strong><p>Save your changes first. Saving creates a new version and clears its previous approval.</p><button className="button hitl-primary" disabled={busy} onClick={saveEdits}>Save edits & clear approval</button></div> : !validProfile ? <div className="hitl-edit-notice"><strong>Profile review needed</strong><p>{state.approved ? 'The supplier profile changed. Prepare a new draft using the current approved profile.' : 'Approve the supplier profile before reviewing outreach.'}</p><button className="button secondary" onClick={() => go('product')}>Review business profile<ArrowRight size={14} /></button></div> : !approved && <label className="hitl-ack"><input type="checkbox" checked={ack} disabled={busy} onChange={event => setAck(event.target.checked)} /><span>I reviewed the recipient, message, account context, sources, version {current.version}{current.messageBrief ? ', saved message brief' : ''}{live ? ', live sender and unsubscribe footer' : ', dry run only'}.</span></label>}
              {!briefAssessment.valid && <div className="hitl-edit-notice" role="status"><strong>Message brief needs attention</strong><p>{briefAssessment.issues.join(' ')}</p></div>}{!approved && <button className="button hitl-primary hitl-approve" disabled={busy || !!editing || !ack || !validProfile || !signalEvidenceCurrent || !companyEvidenceCurrent || !briefAssessment.valid || !!accountHold || (live && !livePreview)} onClick={() => act(`/drafts/${current.id}/approve`, { acknowledged: ack, version: current.version, deliveryMode })}><ShieldCheck size={17} />Approve exact version</button>}
              <button className="button hitl-reject" disabled={busy || !!editing || current.status === 'rejected'} onClick={async () => { const result = await act(`/drafts/${current.id}/reject`); if (result) setAck(false); }}><X size={15} />{approved ? 'Revoke approval' : 'Request changes'}</button>
              <p className="hitl-version-note">Technical and commercial claims still require separate qualification. Saved edits require approval again.</p>
              <div className="hitl-next-action"><span><LockKeyhole size={14} />{approved ? live ? 'Next: send approved email' : 'Next: demo outreach' : 'Outreach waits for approval'}</span>{live ? <><label className="mail-send-check"><input type="checkbox" checked={sendAck} disabled={busy || !approved} onChange={event => setSendAck(event.target.checked)}/><span>Send this exact approved email now using the reviewed sender and unsubscribe group.</span></label><button className="button primary" disabled={busy || !approved || !sendAck || !state.delivery?.available} onClick={dispatchLive}>Send email · 1 credit<ArrowRight size={15}/></button>{!state.delivery?.available && <small>Check and confirm the sender again in Project email delivery before sending.</small>}</> : <button className="button primary" disabled={busy || !approved || !current.recipient.trim()} onClick={async () => { const result = await act(`/drafts/${current.id}/simulate`); if (result) setAck(false); }}>Record dry run · 1 credit<ArrowRight size={15}/></button>}{approved && !current.recipient.trim() && <small>Add a recipient, save, and approve the new version.</small>}</div>
            </>}
          </>}
        </div>
        <div className="hitl-demo-note"><ShieldCheck size={15} /><span>{state.delivery?.fixture ? 'Synthetic provider fixture. No external email is sent.' : live ? 'Live email requires this exact approval and your separate send confirmation. LinkedIn stays a dry run.' : 'Dry run only. No email or LinkedIn message leaves this portal.'}</span></div>
      </aside>
    </div>}
  </div>;
}
