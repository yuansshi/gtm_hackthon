import React, { useRef, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, ChartNoAxesCombined, ClipboardCheck, Columns3, Info, List, Search, ShieldCheck, X } from 'lucide-react';
import './pipeline.css';
import PipelineAnalytics from './PipelineAnalytics';
import { OutcomeReport, OutcomeHistory } from './OutcomeReport';

// Keep the industrial lifecycle aligned with the existing stage PATCH contract.
const stages = ['Matched', 'Contacted', 'Replied', 'Meeting booked', 'RFQ received', 'Engineering review', 'Quote sent', 'Trial / qualification', 'Closed won', 'Closed lost'];
const activeStages = new Set(stages.slice(1, 8));
const scopeLabels = { all: 'All accounts', active: 'Active pipeline', selected: 'Selected accounts', won: 'Closed won' };
const inScope = (lead, scope) => scope === 'selected' ? Boolean(lead.selected) : scope === 'active' ? activeStages.has(lead.stage) : scope === 'won' ? lead.stage === 'Closed won' : true;
const latestEvent = lead => [...(lead.events || [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || Date.parse(a.recordedAt || a.at) - Date.parse(b.recordedAt || b.at)).at(-1);
const formatDate = value => {
  if (!value) return 'No activity recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const modeLabel = mode => ({ dry_run: 'Dry run', user_reported: 'User-reported', research: 'Research' }[mode] || (mode ? mode.replaceAll('_', ' ') : 'Not recorded'));
const count = value => Number.isFinite(value) ? value : 0;

function EventMode({ event }) {
  return <span className={`op-mode ${event?.mode === 'dry_run' ? 'op-mode-dry' : event?.mode === 'user_reported' ? 'op-mode-user' : ''}`}>{event?.recordType === 'outcome' && event.mode === 'dry_run' ? 'Demo outcome' : modeLabel(event?.mode)}</span>;
}

function StageSelect({ lead, act, busy }) {
  return <select className="op-stage-select" aria-label={`Stage for ${lead.name}`} title="Stage changes are recorded as user-reported" value={lead.stage} disabled={busy} onChange={event => act(`/leads/${lead.id}/stage`, { stage: event.target.value }, 'PATCH')}>
    {stages.map(stage => <option key={stage} value={stage}>{stage}</option>)}
  </select>;
}

export function Pipeline({ state, act, busy }) {
  const [view, setView] = useState('board');
  const [reportLead, setReportLead] = useState(null);
  const [outcomeReceipt, setOutcomeReceipt] = useState(null);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('all');
  const [stageFilter, setStageFilter] = useState('');
  const [industry, setIndustry] = useState('');
  const [tier, setTier] = useState('');
  const [analyticsDays, setAnalyticsDays] = useState(0);
  const [analyticsMode, setAnalyticsMode] = useState('all');
  const columns = useRef([]);
  const leads = state.leads || [];
  const metrics = state.metrics || {};
  const query = search.trim().toLowerCase();
  const accounts = leads.filter(lead => inScope(lead, scope)
    && (!stageFilter || lead.stage === stageFilter)
    && (!industry || (lead.industry || 'Unknown industry') === industry)
    && (!tier || (lead.fit?.tier || 'Unrated') === tier)
    && (!query || [lead.name, lead.domain, lead.industry, lead.application, lead.owner, lead.fit?.tier].filter(Boolean).join(' ').toLowerCase().includes(query)));
  const hasFilters = Boolean(query || stageFilter || industry || tier || scope !== 'all');
  const reached = stage => leads.filter(lead => lead.events?.some(event => event.stage === stage)).length;
  const operationalMetrics = [
    ['Dry-run messages', metrics.simulated ?? (state.drafts || []).filter(draft => draft.status === 'simulated').length, 'Local simulations'],
    ['Recorded reply accounts', metrics.replied ?? reached('Replied'), 'Recorded milestone'],
    ['RFQs received', metrics.qualifiedRfqs ?? reached('RFQ received'), 'User-reported milestone'],
    ['Provider acceptances', metrics.liveAccepted ?? (state.drafts || []).filter(draft => draft.status === 'accepted').length, 'Provider-accepted messages'],
  ];
  const summaries = [
    ['all', 'All accounts', leads.length, 'Researched accounts'],
    ['active', 'Active pipeline', leads.filter(lead => inScope(lead, 'active')).length, 'Contacted through qualification'],
    ['selected', 'Selected accounts', leads.filter(lead => inScope(lead, 'selected')).length, 'Chosen for qualification'],
    ['won', 'Closed won', leads.filter(lead => inScope(lead, 'won')).length, 'Current recorded stage'],
  ];
  const clearFilters = () => { setSearch(''); setScope('all'); setStageFilter(''); setIndustry(''); setTier(''); };
  const chooseStage = stage => {
    setStageFilter(stage);
    if (stage && view === 'board') columns.current[stages.indexOf(stage)]?.scrollIntoView({ block: 'nearest', inline: 'start' });
  };

  return <div className="op-pipeline">
    <header className="op-page-header"><div><span className="op-eyebrow">Revenue workspace</span><h1>Opportunity pipeline</h1><p>Move industrial accounts from first match to qualified opportunity.</p></div><div className="op-header-actions"><span className="op-recorded-badge"><ShieldCheck size={14} aria-hidden="true" />User-reported stages</span><button className="button primary" disabled={busy || !leads.length} onClick={() => setReportLead(accounts[0]?.id || leads[0]?.id)}><ClipboardCheck size={15} />Record outcome</button></div></header>
    {outcomeReceipt && <div className={`outcome-receipt ${outcomeReceipt.outcomeProjection !== 'synced' ? 'pending' : ''}`} role="status">{outcomeReceipt.outcomeProjection === 'synced' ? <CheckCircle2 size={17} /> : <Info size={17} />}<span>{outcomeReceipt.outcomeProjection === 'synced' ? 'Outcome saved and graph updated.' : 'Outcome saved. Graph refresh is pending; retry from outcome history.'} No credits charged.{outcomeReceipt.outcomeDraftsForReview > 0 && ` ${outcomeReceipt.outcomeDraftsForReview} unsent message(s) need a fresh version review.`}</span><button aria-label="Dismiss outcome receipt" onClick={() => setOutcomeReceipt(null)}><X size={15} /></button></div>}

    <div className="op-summaries" aria-label="Filter pipeline by account summary">
      {summaries.map(([key, label, total, description]) => <button type="button" className={`op-summary-card ${scope === key ? 'is-active' : ''}`} key={key} aria-pressed={scope === key} onClick={() => setScope(key)}><span className="op-summary-label">{label}{scope === key && <Check size={14} aria-hidden="true" />}</span><strong>{total}</strong><small>{description}</small></button>)}
    </div>

    <div className="op-operational" aria-label="Recorded activity across all accounts"><span className="op-operational-label">Recorded activity<span>All accounts · historical totals</span></span>{operationalMetrics.map(([label, value, description]) => <div key={label} title={description}><strong>{count(value)}</strong><span>{label}</span></div>)}</div>

    <section className="op-opportunities" aria-labelledby="op-opportunities-title" aria-busy={busy}>
      <div className="op-toolbar">
        <div className="op-view-heading"><h2 id="op-opportunities-title">Opportunities</h2><span className="op-total">{accounts.length}</span></div>
        <div className="op-view-toggle" role="group" aria-label="Pipeline view"><button type="button" className={view === 'board' ? 'is-active' : ''} aria-pressed={view === 'board'} onClick={() => setView('board')}><Columns3 size={15} aria-hidden="true" />Board</button><button type="button" className={view === 'list' ? 'is-active' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={15} aria-hidden="true" />List</button><button type="button" className={view === 'analytics' ? 'is-active' : ''} aria-pressed={view === 'analytics'} onClick={() => setView('analytics')}><ChartNoAxesCombined size={15} aria-hidden="true" />Analytics</button></div>
        <label className="op-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search pipeline accounts" placeholder="Search accounts, industries…" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <label className="op-stage-filter"><span>Stage</span><select aria-label="Filter pipeline by stage" value={stageFilter} onChange={event => chooseStage(event.target.value)}><option value="">All stages</option>{stages.map(stage => <option key={stage} value={stage}>{stage}</option>)}</select></label>
        <label className="op-cohort-filter"><span>Industry</span><select aria-label="Filter pipeline by industry" value={industry} onChange={event => setIndustry(event.target.value)}><option value="">All industries</option>{[...new Set(leads.map(lead => lead.industry || 'Unknown industry'))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="op-cohort-filter"><span>Tier</span><select aria-label="Filter pipeline by tier" value={tier} onChange={event => setTier(event.target.value)}><option value="">All tiers</option>{[...new Set(leads.map(lead => lead.fit?.tier || 'Unrated'))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      <div className="op-result-bar"><div aria-live="polite"><strong>{accounts.length}</strong> of {leads.length} accounts{scope !== 'all' && <span className="op-filter-chip">{scopeLabels[scope]}<button type="button" aria-label={`Clear ${scopeLabels[scope]} filter`} onClick={() => setScope('all')}><X size={12} aria-hidden="true" /></button></span>}{industry && <span className="op-filter-chip">{industry}<button type="button" aria-label="Clear industry filter" onClick={() => setIndustry('')}><X size={12} aria-hidden="true" /></button></span>}{tier && <span className="op-filter-chip">{tier}<button type="button" aria-label="Clear tier filter" onClick={() => setTier('')}><X size={12} aria-hidden="true" /></button></span>}{stageFilter && <span className="op-filter-chip">{stageFilter}<button type="button" aria-label="Clear stage filter" onClick={() => chooseStage('')}><X size={12} aria-hidden="true" /></button></span>}</div>{hasFilters ? <button type="button" className="op-clear" onClick={clearFilters}>Clear account filters</button> : <span className="op-cycle-note">{view === 'board' ? <>Scroll to follow all 10 stages<ArrowRight size={13} aria-hidden="true" /></> : view === 'analytics' ? 'Analytics uses these same account filters' : 'Stage changes include actor and timestamp'}</span>}</div>

      {view !== 'analytics' && !accounts.length && <div className="op-empty-state"><Search size={20} aria-hidden="true" /><div><strong>{leads.length ? 'No accounts match these filters' : 'Your pipeline is ready for accounts'}</strong><p>{leads.length ? 'Adjust the search, summary, or stage to see more accounts.' : 'Researched accounts will appear here at their recorded stage.'}</p></div>{hasFilters && <button type="button" onClick={clearFilters}>Clear account filters</button>}</div>}

      {view === 'analytics' ? <PipelineAnalytics state={state} accounts={accounts} days={analyticsDays} setDays={setAnalyticsDays} mode={analyticsMode} setMode={setAnalyticsMode} /> : view === 'board' ? <div className="op-board" role="region" aria-label="Opportunity board with ten industrial stages" tabIndex={0}>{stages.map((stage, index) => {
        const rows = accounts.filter(lead => lead.stage === stage);
        return <section className={`op-column ${stageFilter === stage ? 'is-filtered' : ''} ${index === 8 ? 'is-won' : ''} ${index === 9 ? 'is-lost' : ''}`} key={stage} ref={element => { columns.current[index] = element; }} aria-label={`${stage}, ${rows.length} accounts`}>
          <button type="button" className="op-column-heading" onClick={() => chooseStage(stageFilter === stage ? '' : stage)} aria-pressed={stageFilter === stage}><span className="op-stage-dot" /><h3>{stage}</h3><span className="op-column-count">{rows.length}</span></button>
          <div className="op-column-body">{rows.map(lead => {
            const event = latestEvent(lead);
            return <article className="op-card" key={lead.id}><div className="op-card-top"><span className="op-tier">{lead.fit?.tier || 'Not rated'}</span>{lead.selected && <span className="op-selected"><Check size={12} aria-hidden="true" />Selected</span>}</div><h4>{lead.name}</h4><span className="op-industry">{lead.industry || 'Industry not recorded'}</span><p>{lead.application || 'Application not recorded'}</p><div className="op-card-event"><span>{event?.actor || 'Actor not recorded'}<EventMode event={event} /></span><time dateTime={event?.at}>{formatDate(event?.at)}</time></div><label className="op-card-stage"><span>Stage</span><StageSelect lead={lead} act={act} busy={busy} /></label></article>;
          })}{!rows.length && <div className="op-column-empty">No accounts</div>}</div>
        </section>;
      })}</div> : <div className="op-table-scroll"><table className="op-account-table"><thead><tr><th scope="col">Account</th><th scope="col">Application</th><th scope="col">Tier</th><th scope="col">Current stage</th><th scope="col">Recent actor</th><th scope="col">Last activity</th><th scope="col">Mode</th></tr></thead><tbody>{accounts.map(lead => {
        const event = latestEvent(lead);
        return <tr key={lead.id}><td><div className="op-account-name"><span className="op-account-initial">{lead.name?.charAt(0) || '—'}</span><div><strong>{lead.name}</strong><small>{lead.industry || 'Industry not recorded'}{lead.selected && <span className="op-inline-selected"> · Selected</span>}</small></div></div></td><td className="op-application-cell">{lead.application || 'Not recorded'}</td><td><span className="op-tier">{lead.fit?.tier || 'Not rated'}</span></td><td><StageSelect lead={lead} act={act} busy={busy} /></td><td>{event?.actor || 'Not recorded'}</td><td><time dateTime={event?.at}>{formatDate(event?.at)}</time></td><td><EventMode event={event} /></td></tr>;
      })}{!accounts.length && <tr><td colSpan={7} className="op-no-data">No accounts to display.</td></tr>}</tbody></table></div>}

      <footer className="op-data-note"><ShieldCheck size={14} aria-hidden="true" /><span>Stage edits are recorded as user-reported. Dry runs simulate outreach; no external message is sent.</span>{busy && <strong role="status">Saving…</strong>}</footer>
    </section>

    <OutcomeHistory state={state} act={act} busy={busy} receipt={outcomeReceipt} />
    {reportLead && <OutcomeReport state={state} act={act} busy={busy} initialLeadId={reportLead} close={() => setReportLead(null)} saved={setOutcomeReceipt} />}
  </div>;
}
