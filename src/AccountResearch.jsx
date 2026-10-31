import React, { Suspense, lazy, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, ArrowRight, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, ExternalLink, FileSearch, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import './accounts.css';
import { WebsiteIntake, WebsiteQueue } from './WebsiteIntake.jsx';
import { ContactResearch, contactMailboxLabel } from './ContactResearch.jsx';
import { ProspectSearch, ProspectSearchSummary } from './ProspectSearch.jsx';
import { MarketSignals } from './MarketSignals.jsx';
import { signalHold } from './market-signals.js';
import { CompanyResearch } from './CompanyResearch.jsx';
import { PeopleResearch } from './PeopleResearch.jsx';
import { companyHoldReasons } from './company-evidence.js';
const CompetitiveLandscape = lazy(() => import('./CompetitorResearch.jsx')); 

const formatDate = value => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not checked';
};
const words = value => String(value || 'Unknown').replaceAll('_', ' ');
const sourceUrl = value => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url : null; } catch { return null; }
};
const domainOf = value => sourceUrl(value)?.hostname.replace(/^www\./, '') || '';

function SourceLink({ url, children, className = '' }) {
  const valid = sourceUrl(url);
  return valid ? <a className={`ar-source ${className}`} href={valid.href} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}><BookOpen size={13} /><span>{children || domainOf(url)}</span><ExternalLink size={11} /></a> : <span className="ar-muted">No public source established</span>;
}

function AccountPreview({ account, state, open, close, move, position, total, context, busy, act, tab, setTab }) {
  const dialogRef = useRef(null);
  const id = useId();
  const tabs = ['Overview', 'Company', 'Contacts', 'Signals', 'Evidence', 'Activity'];
  const contact = account.contact || {};
  const companyHold=companyHoldReasons(account,state).join(' ');
  const eligible = !account.excludedReason && !companyHold && (!account.businessId || account.businessId === state.businessId);
  const guarded = busy || !state.approved || !eligible;
  const relatedActivity = (state.activity || []).filter(event => event.detail?.includes(account.name));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const handleTabKey = event => {
    const index = tabs.indexOf(tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); setTab(tabs[next]);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
  };

  return <dialog ref={dialogRef} className="ar-preview" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="ar-preview-inner">
      <div className="ar-preview-nav"><span>{position + 1} of {total} {context}</span><div><button className="ar-icon-button" aria-label="Previous account" disabled={position <= 0} onClick={() => move(-1)}><ChevronLeft size={18} /></button><button className="ar-icon-button" aria-label="Next account" disabled={position >= total - 1} onClick={() => move(1)}><ChevronRight size={18} /></button><span className="ar-nav-divider" /><button className="ar-icon-button" aria-label="Close account preview" onClick={close} autoFocus><X size={19} /></button></div></div>
      <header className="ar-preview-heading"><div className="ar-account-mark">{account.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('')}</div><div><h2 id={`${id}-title`}>{account.name}</h2><p>{account.industry} <span aria-hidden="true">/</span> {account.tier}</p><SourceLink url={account.source}>{account.domain || domainOf(account.source)}</SourceLink></div></header>
      <div className="ar-preview-actions"><span className={`ar-badge ${account.excludedReason ? 'ar-badge-review' : account.selected ? 'ar-badge-healthy' : ''}`}>{account.evidenceNeedsReview ? 'Evidence needs review' : signalHold(account) ? 'Market signal hold' : companyHoldReasons(account,state).length ? 'Company qualification hold' : account.excludedReason ? 'Excluded by profile' : account.selected ? 'Shortlisted' : 'Researched'}</span><span className="ar-muted">{account.stage || 'Stage not recorded'}</span><button className={`ar-button ${account.selected ? 'ar-button-selected' : 'ar-button-primary'}`} disabled={guarded} aria-pressed={!!account.selected} onClick={() => act(`/leads/${account.id}/selection`, { selected: !account.selected }, 'PATCH')}>{account.selected && <Check size={14} />}{signalHold(account) || companyHoldReasons(account,state).length ? 'On hold' : account.excludedReason ? 'Excluded' : account.selected ? 'Remove from shortlist' : 'Shortlist account'}</button></div>
      {(account.excludedReason||companyHold) && <div className="ar-drawer-notice">{account.excludedReason||companyHold}</div>}
      {!state.approved && <div className="ar-drawer-notice">Approve the current business profile to shortlist accounts or check contacts.</div>}
      <div className="ar-preview-tabs" role="tablist" aria-label="Account details">{tabs.map(label => <button key={label} id={`${id}-tab-${label}`} role="tab" aria-selected={tab === label} aria-controls={`${id}-panel`} tabIndex={tab === label ? 0 : -1} onClick={() => setTab(label)} onKeyDown={handleTabKey}>{label}</button>)}</div>
      <div className="ar-preview-body" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} tabIndex={0}>
        {tab === 'Overview' && <>
          <section className="ar-detail-section"><h3>Potential application</h3><p className="ar-application-detail">{account.application}</p><p>{account.reason}</p><dl className="ar-record-facts"><div><dt>Location</dt><dd>{account.location || 'Unknown'}</dd></div><div><dt>Account owner</dt><dd>{account.owner || 'Not assigned'}</dd></div><div><dt>Company size</dt><dd>{account.fit?.companySize || 'Unknown'}</dd></div><div><dt>Technical fit</dt><dd>{account.fit?.technicalFit || 'Requires engineering review'}</dd></div></dl></section>
          <section className="ar-detail-section"><div className="ar-detail-title"><h3>Explainable research fit</h3><span className="ar-fit-total">{account.fit?.score ?? '—'}<small>/100</small><span className="ar-badge">{account.fit?.tier || 'Unrated'}</span></span></div><p>Profile and public-source relevance. This score does not establish buying intent, an RFQ, or engineering compatibility.</p><div className="ar-fit-breakdown">{(account.fit?.breakdown || []).map((part, index) => <div key={`${part.label}-${index}`}><div><span>{part.label}</span><strong>{part.value}/{part.maximum}</strong></div><div className="ar-fit-track" aria-hidden="true"><span style={{ width: `${part.maximum ? Math.min(100, Math.max(0, part.value / part.maximum * 100)) : 0}%` }} /></div>{part.evidence ? <SourceLink url={part.evidence}>Supporting source</SourceLink> : <small className="ar-muted">No supporting evidence established</small>}</div>)}</div></section>
          <section className="ar-detail-section"><div className="ar-detail-title"><h3>Contact research</h3><span className={`ar-badge ${contactMailboxLabel(contact) === 'Hunter valid' ? 'ar-badge-healthy' : 'ar-badge-review'}`}>{contactMailboxLabel(contact)}</span></div><p className="ar-contact-email">{contact.email || 'No public email established'}</p><p>{contact.emailKind || 'Address type unknown'}</p>{contact.provenance === 'hunter_reviewed' && <p>{contact.name || 'Company mailbox'}{contact.role ? ` · ${contact.role}` : ''}. Hunter verification: {contact.verification?.verificationDate || 'date unknown'}.</p>}<dl className="ar-record-facts"><div><dt>Mail routing (MX)</dt><dd>{contact.mxStatus === 'found' ? 'MX records found' : words(contact.mxStatus || 'not_checked')}</dd></div><div><dt>Buying responsibility</dt><dd>{contact.roleMatch || 'Not independently confirmed'}</dd></div><div><dt>Last contact check</dt><dd>{formatDate(contact.checkedAt)}</dd></div></dl><SourceLink url={contact.source}>{contact.provenance === 'hunter_reviewed' ? 'Vendor-returned source' : 'Contact source'}</SourceLink><p className="ar-contact-caveat">{contact.enrichmentNote || 'A public address and DNS mail routing do not verify mailbox deliverability or identify a purchasing decision-maker.'}</p><button className="ar-button ar-button-secondary ar-enrich" disabled={guarded} onClick={() => act(`/leads/${account.id}/enrich`)}><RefreshCw size={14} />Check public contact & MX<span>5 credits</span></button><button className="ar-text-button" disabled={busy} onClick={() => setTab('Contacts')}>Research contacts with Hunter<ChevronRight size={13} /></button></section>
        </>}
        {tab === 'Company' && <CompanyResearch key={account.id} account={account} state={state} act={act} busy={busy} />}
        {tab === 'Signals' && <MarketSignals key={account.id} account={account} state={state} act={act} busy={busy} />}
        {tab === 'Contacts' && <><ContactResearch key={account.id} account={account} state={state} act={act} busy={busy} /><PeopleResearch key={`people:${account.id}`} account={account} state={state} act={act} busy={busy} /></>}
        {tab === 'Evidence' && <>
          {account.customEvidence && <section className="ar-detail-section wi-provenance"><strong>{account.evidenceNeedsReview ? 'A fresh quoted-source review is required' : 'Owner-reviewed website evidence'}</strong><p>Exact source passages were reviewed by you before account admission. Their interpretation is a research hypothesis; buyer authority and intent remain unverified.</p><small>Reviewed {formatDate(account.evidenceReviewedAt)} · {account.sourceEvidenceState === 'needs_review' ? 'Quotes or published contact changed or could not be retrieved' : 'Supporting quotes retained'}</small></section>}
          <section className="ar-detail-section"><h3>Published company context</h3><ul className="ar-fact-list">{(account.facts || []).map((fact, index) => <li key={`${fact}-${index}`}><p>{fact}</p><SourceLink url={account.factEvidence?.[index]?.url || (index === 1 ? account.contactSource : account.source)}>Evidence source</SourceLink></li>)}</ul>{!account.facts?.length && <p>No published company facts are recorded.</p>}</section>
          <section className="ar-detail-section"><h3>Research signal</h3><p className="ar-application-detail">{account.signal?.title || 'No signal established'}</p><p>{account.signal?.intent || 'Buying intent is not confirmed.'}</p><SourceLink url={account.signal?.source}>Signal source</SourceLink></section>
          <section className="ar-detail-section"><div className="ar-detail-title"><h3>People & role evidence</h3><span className="ar-muted">{account.people?.length || 0} recorded</span></div>{account.people?.length ? account.people.map((person, index) => <article className="ar-person" key={`${person.name}-${index}`}><strong>{person.name}</strong><span>{person.role}</span><p>{person.relevance}</p><SourceLink url={person.source}>{person.provenance === 'hunter_reviewed' ? 'Vendor-returned source · role unverified' : 'Published role'}</SourceLink></article>) : <p>No named decision-maker established. Buying responsibility remains unverified.</p>}</section>
          <section className="ar-detail-section"><h3>Latest source checks</h3><p>Fetch status confirms retrieval only. Published context still needs qualification.</p>{account.sourceReviews?.length ? <div className="ar-source-reviews">{account.sourceReviews.map((review, index) => <article key={`${review.url}-${index}`}><div><SourceLink url={review.url}>{review.title || domainOf(review.url) || 'Source'}</SourceLink><span className={`ar-badge ${review.fetchStatus === 'reachable' ? 'ar-badge-healthy' : 'ar-badge-review'}`}>{review.fetchStatus === 'reachable' ? 'Fetched' : 'Fetch failed'}</span></div><small>{formatDate(review.checkedAt)}{review.error ? ` / ${words(review.error)}` : ''}</small>{review.preview && <p>{review.preview}</p>}</article>)}</div> : <p>No source checks recorded.</p>}</section>
        </>}
        {tab === 'Activity' && <>
          <section className="ar-detail-section"><h3>Research record</h3><dl className="ar-record-facts"><div><dt>Research updated</dt><dd>{formatDate(account.researchedAt)}</dd></div><div><dt>Contact checked</dt><dd>{formatDate(contact.checkedAt)}</dd></div><div><dt>Evidence status</dt><dd>{account.evidenceStatus || 'Not recorded'}</dd></div></dl></section>
          <section className="ar-detail-section"><h3>Recorded stage history</h3>{account.events?.length ? <ol className="ar-activity-list">{[...account.events].reverse().map((event, index) => <li key={`${event.at}-${index}`}><Clock3 size={14} /><div><strong>{event.stage}</strong><p>{event.actor || 'Actor not recorded'}{event.mode ? ` / ${event.mode}` : ''}</p><time dateTime={event.at}>{formatDate(event.at)}</time></div></li>)}</ol> : <p>No stage changes recorded.</p>}</section>
          <section className="ar-detail-section"><h3>Related workspace activity</h3>{relatedActivity.length ? <ol className="ar-activity-list">{relatedActivity.map((event, index) => <li key={event.id || index}><Clock3 size={14} /><div><strong>{event.title}</strong><p>{event.detail}</p><time dateTime={event.at}>{event.actor || 'Actor not recorded'} / {formatDate(event.at)}</time></div></li>)}</ol> : <p>No additional activity mentioning this account is recorded.</p>}</section>
        </>}
      </div>
      <footer className="ar-preview-footer"><ShieldCheck size={14} /><span>Research for {state.company?.name}. Qualification requires human review.</span></footer>
    </div>
  </dialog>;
}

export function Discovery({ state, act, busy, go, focusAccountId, onFocusHandled, viewRequest }) {
  const [view, setView] = useState('all');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('fit');
  const [selection, setSelection] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [website, setWebsite] = useState(null);
  const [prospectSearch, setProspectSearch] = useState(null);
  const [tab, setTab] = useState('Overview');
  const handledFocus = useRef(null);
  const handledView = useRef(null);
  const previousBusiness = useRef(state.businessId);
  const accounts = useMemo(() => (state.leads || []).filter(account => !account.businessId || account.businessId === state.businessId), [state.leads, state.businessId]);
  const job = state.jobs?.find(item => !item.kind || item.kind === 'discovery');
  const running = state.jobs?.some(run => run.status === 'running');
  const shortlisted = accounts.filter(account => account.selected && !account.excludedReason);
  const excluded = accounts.filter(account => account.excludedReason);
  const runExclusions = (job?.excluded || []).filter(item => !excluded.some(account => account.name === item.name));
  const selectedId = selection?.businessId === state.businessId ? selection.id : null;
  const active = accounts.find(account => account.id === selectedId);
  const query = filter.trim().toLowerCase();

  useEffect(() => {
    if (previousBusiness.current === state.businessId) return;
    previousBusiness.current = state.businessId;
    setSelection(null); setPreviewOpen(false); setWebsite(null); setProspectSearch(null); setFilter(''); setView('all'); setTab('Overview');
    handledFocus.current = null; handledView.current = null;
  }, [state.businessId]);

  useEffect(() => {
    if (viewRequest?.requestId === undefined || !['all', 'shortlisted', 'excluded'].includes(viewRequest.view)) return;
    const key = `${state.businessId}:${viewRequest.requestId}`;
    if (handledView.current === key) return;
    handledView.current = key; setView(viewRequest.view); setFilter('');
  }, [state.businessId, viewRequest?.requestId, viewRequest?.view]);

  useEffect(() => {
    if (!focusAccountId) { handledFocus.current = null; return; }
    const key = `${state.businessId}:${focusAccountId}`;
    if (handledFocus.current === key || !accounts.some(account => account.id === focusAccountId)) return;
    handledFocus.current = key;
    setSelection({ businessId: state.businessId, id: focusAccountId }); setPreviewOpen(true); setTab('Overview'); setView('all'); setFilter('');
    onFocusHandled?.();
  }, [focusAccountId, accounts, state.businessId, onFocusHandled]);

  const sortedAccounts = useMemo(() => [...accounts].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'recent' ? (new Date(b.researchedAt || 0) - new Date(a.researchedAt || 0) || a.name.localeCompare(b.name)) : ((b.fit?.score || 0) - (a.fit?.score || 0) || a.name.localeCompare(b.name))), [accounts, sort]);
  const visible = sortedAccounts.filter(account => (view === 'all' || (view === 'shortlisted' ? account.selected && !account.excludedReason : account.excludedReason)) && `${account.name} ${account.domain || ''} ${account.industry || ''} ${account.application || ''} ${account.location || ''}`.toLowerCase().includes(query));
  const visibleExclusions = view === 'excluded' ? runExclusions.filter(item => `${item.name} ${item.reason}`.toLowerCase().includes(query)) : [];
  const navigation = visible.some(account => account.id === selectedId) ? visible : sortedAccounts;
  const position = navigation.findIndex(account => account.id === selectedId);
  const openAccount = account => { setSelection({ businessId: state.businessId, id: account.id }); setPreviewOpen(true); setTab('Overview'); };
  const move = direction => { const next = navigation[position + direction]; if (next) setSelection({ businessId: state.businessId, id: next.id }); };

  return <div className="ar-workspace">
    <header className="ar-page-heading"><div><h1>Account research</h1><p>Find relevant equipment makers and review the evidence before qualification.</p></div><div className="wi-page-actions"><button className="ar-button ar-button-primary" disabled={busy || !state.approved || running} onClick={() => setProspectSearch({ id: '' })}><Search size={15} />Search prospects</button><button className="ar-button ar-button-secondary" disabled={busy || !state.approved || running} onClick={() => setWebsite({ id: '' })}><FileSearch size={15} />Research a website</button><button className="ar-button ar-button-secondary" disabled={busy || !state.approved || running} onClick={() => act('/discovery')}><RefreshCw size={15} />{running ? 'Researching sources…' : accounts.length ? 'Refresh source research' : 'Run source research'}<span>2 credits</span></button></div></header>
    {!state.approved && <div className="ar-profile-notice"><ShieldCheck size={17} /><span>Approve this business’s customer profile before running research or checking contacts.</span><button className="ar-text-button" onClick={() => go('product')}>Review profile<ArrowRight size={13} /></button></div>}
    <section className="ar-scope" aria-label="Research scope"><div><strong>{state.icp?.regions || 'Choose a territory'}</strong><span>{state.icp?.segments?.join(', ') || 'Choose buyer segments'}</span></div><p>Curated and reviewer-admitted accounts with primary citations. ICP-driven web search is available with a project connection; buyer authority and buying intent remain unverified.</p><span className="ar-badge">{accounts.length} researched</span></section>
    {job && <details className="ar-run"><summary><span className="ar-run-title"><RefreshCw size={14} />Latest research run<span className={`ar-badge ${job.status === 'completed' ? 'ar-badge-healthy' : 'ar-badge-review'}`}>{words(job.status)}</span></span><span className="ar-run-date">{formatDate(job.startedAt)}<ChevronDown size={15} /></span></summary><div className="ar-run-content"><p>Local planner, builder, reviewer, and security handoffs. Band Desktop is not connected.</p><ol>{['Planner', 'Builder', 'Reviewer', 'Security reviewer'].map(role => { const step = job.steps?.find(item => item.actor === role); return <li key={role}><span className={step ? 'ar-step-complete' : ''}>{step ? <Check size={12} /> : <Clock3 size={12} />}</span><div><strong>{role}</strong><p>{step?.summary || 'Waiting for handoff.'}</p>{step?.at && <time dateTime={step.at}>{formatDate(step.at)}</time>}</div></li>; })}</ol>{job.error && <p role="alert" className="ar-run-error">{job.error}</p>}{!!job.excluded?.length && <div className="ar-run-excluded"><strong>{job.excluded.length} excluded by collection or profile rules</strong>{job.excluded.map((item, index) => <p key={`${item.name}-${index}`}>{item.name}: {item.reason}</p>)}</div>}</div></details>}
    <ProspectSearchSummary state={state} open={id => setProspectSearch({ id })} />
    <WebsiteQueue state={state} act={act} busy={busy} open={id => setWebsite({ id })} />
    <section className="ar-table-panel" aria-label="Researched accounts">
      <div className="ar-table-toolbar"><div className="ar-view-tabs" aria-label="Account views">{[['all', 'All accounts', accounts.length], ['shortlisted', 'Shortlisted', shortlisted.length], ['excluded', 'Excluded', excluded.length + runExclusions.length]].map(([key, label, count]) => <button key={key} className={view === key ? 'is-active' : ''} aria-pressed={view === key} onClick={() => setView(key)}>{label}<span>{count}</span></button>)}</div><label className="ar-search"><Search size={15} /><input aria-label="Search researched accounts" placeholder="Search accounts or applications" value={filter} onChange={event => setFilter(event.target.value)} />{filter && <button className="ar-icon-button" aria-label="Clear account search" onClick={() => setFilter('')}><X size={13} /></button>}</label><label className="ar-sort"><ArrowDownUp size={14} /><span className="ar-sr-only">Sort accounts</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="fit">Research fit</option><option value="name">Name A–Z</option><option value="recent">Recently researched</option></select></label></div>
      <div className="ar-table-scroll"><table className="ar-account-table"><thead><tr><th scope="col">Account</th><th scope="col">Potential application</th><th scope="col">Research fit</th><th scope="col">Contact evidence</th><th scope="col">Shortlist</th></tr></thead><tbody>{visible.map(account => <tr key={account.id} className={selectedId === account.id ? 'is-selected' : ''} onClick={() => openAccount(account)}><td><button className="ar-account-name" aria-label={`Open research for ${account.name}`} onClick={event => { event.stopPropagation(); openAccount(account); }}>{account.name}</button><span className="ar-cell-secondary">{account.location}</span><SourceLink url={account.source}>{account.domain || domainOf(account.source)}</SourceLink></td><td><span className="ar-application" title={account.application}>{account.application}</span><span className="ar-cell-secondary">{account.industry} / {account.tier}</span></td><td><span className="ar-fit-score">{account.fit?.score ?? '—'}<small>/100</small></span><span className="ar-cell-secondary">{account.fit?.tier || 'Unrated'}</span></td><td><span className="ar-contact-state">{account.contact?.email ? account.contact.provenance === 'hunter_reviewed' ? 'Selected vendor contact' : 'Published company email' : 'No public email established'}</span><span className={`ar-cell-secondary ${contactMailboxLabel(account.contact) === 'Hunter valid' ? 'cr-valid-text' : 'ar-review-text'}`}>{contactMailboxLabel(account.contact)}</span></td><td><button className={`ar-button ar-table-shortlist ${account.selected ? 'ar-button-selected' : 'ar-button-secondary'}`} disabled={busy || !state.approved || !!account.excludedReason} aria-pressed={!!account.selected} title={account.excludedReason || undefined} onClick={event => { event.stopPropagation(); act(`/leads/${account.id}/selection`, { selected: !account.selected }, 'PATCH'); }}>{account.selected && <Check size={13} />}{signalHold(account) || companyHoldReasons(account,state).length ? 'On hold' : account.excludedReason ? 'Excluded' : account.selected ? 'Shortlisted' : 'Shortlist'}</button><button className="ar-row-preview" onClick={event => { event.stopPropagation(); openAccount(account); }}>Review evidence<ChevronRight size={12} /></button></td></tr>)}</tbody></table></div>
      {!visible.length && <div className="ar-empty"><FileSearch size={25} /><h2>{query ? 'No accounts match your search' : view === 'shortlisted' ? 'No shortlisted accounts yet' : view === 'excluded' ? 'No excluded account records' : 'Start with source research'}</h2><p>{query ? 'Try another account name, location, or application.' : view === 'shortlisted' ? 'Review the research and shortlist accounts worth qualifying.' : view === 'excluded' ? 'Stored account records excluded by the current profile appear here.' : 'Approve the customer profile, then run research to populate this business’s account list.'}</p>{query && <button className="ar-text-button" onClick={() => setFilter('')}>Clear search</button>}</div>}
      {!!visibleExclusions.length && <div className="ar-exclusion-list"><h3>Excluded during the latest research run</h3><p>These candidates have no stored account detail for this run.</p>{visibleExclusions.map((item, index) => <div key={`${item.name}-${index}`}><strong>{item.name}</strong><span>{item.reason}</span></div>)}</div>}
      <footer className="ar-table-footer"><span>{visible.length} of {accounts.length} account records{query ? ' match the search' : ''}</span><span>Research fit is a hypothesis; buying intent is unconfirmed.</span></footer>
    </section>
    <Suspense fallback={<div className="ar-competitors">Loading competitive research…</div>}><CompetitiveLandscape state={state} act={act} busy={busy}/></Suspense>
    <footer className="ar-workflow-next"><span><Check size={15} />{shortlisted.length} accounts shortlisted for {state.company?.name}</span><button className="ar-button ar-button-secondary" onClick={() => go('graph')}>Explore relationships<ArrowRight size={14} /></button></footer>
    {prospectSearch && <ProspectSearch key={`${state.businessId}:${prospectSearch.id}`} state={state} act={act} busy={busy} initialRunId={prospectSearch.id} close={() => setProspectSearch(null)} reviewSources={id => { setProspectSearch(null); setWebsite({ id }); }} researchWebsite={urls => { setProspectSearch(null); setWebsite({ id: '', urls }); }} openAccount={id => { setProspectSearch(null); setSelection({ businessId: state.businessId, id }); setPreviewOpen(true); setTab('Evidence'); }} />}
    {website && <WebsiteIntake key={`${state.businessId}:${website.id}`} state={state} act={act} busy={busy} initialIntakeId={website.id} initialUrls={website.urls} close={() => setWebsite(null)} admitted={id => { setSelection({ businessId: state.businessId, id }); setPreviewOpen(true); setTab('Evidence'); setView('all'); setFilter(''); }} />}
    {active && <AccountPreview key={state.businessId} account={active} state={state} open={previewOpen} close={() => setPreviewOpen(false)} move={move} position={position} total={navigation.length} context={navigation === visible ? 'in this view' : 'accounts'} busy={busy} act={act} tab={tab} setTab={setTab} />}
  </div>;
}
