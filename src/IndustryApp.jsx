import React, { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, BookOpen, Check, ChevronDown, ChevronRight, CircleCheck, CircleHelp, Compass, Download, FileCheck2, GitBranch, Layers3, LayoutDashboard, Link2, Mail, Menu, Network, RotateCcw, ShieldCheck, Target, Users, X, BarChart3, Wallet } from 'lucide-react';
import ModuleOne from './ModuleOne';
import Billing from './Billing';
import { api, connect, profileOf } from './api';
import { Discovery, KnowledgeGraph, Outreach, Pipeline, Integrations } from './Workflow';
import { activeBusinessKey, businesses, businessById, businessStorageKey, createResearchBrief, initialBusinessState, missingResearchFields } from './businesses';
import { modules } from './data';

const icons = [Target, Compass, Network, Mail, BarChart3];
const views = ['overview', ...modules.map(m => m.id), 'billing'];
const viewLabel = view => view === 'overview' ? 'Overview' : view === 'billing' ? 'Billing & credits' : modules.find(m => m.id === view)?.short;

export function loadBusiness(id) {
  const base = initialBusinessState(id);
  try {
    const saved = JSON.parse(localStorage.getItem(businessStorageKey(id)));
    if ([1, 2].includes(saved?.version) && saved.businessId === id && saved.company && saved.icp && Array.isArray(saved.productFamilies)) {
      return { ...base, ...saved, company: { ...base.company, ...saved.company }, icp: { ...base.icp, ...saved.icp }, commercial: { ...base.commercial, ...saved.commercial }, capabilities: { ...base.capabilities, ...saved.capabilities } };
    }
  } catch { /* Keep the workspace usable when browser storage is unavailable. */ }
  return base;
}

function initialWorkspace() {
  let id = 'allco';
  try {
    const saved = localStorage.getItem(activeBusinessKey);
    if (businesses.some(b => b.id === saved)) id = saved;
  } catch { /* Use the user-selected first business. */ }
  return loadBusiness(id);
}

function Dialog({ title, children, close, drawer = false }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className={drawer ? 'drawer' : 'modal'} aria-label={title} onCancel={close} onClick={e => { if (drawer && e.target === e.currentTarget) close(); }}><div className={drawer ? 'drawer-header' : 'modal-title'}><div><h2>{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={19} /></button></div><div className={drawer ? 'drawer-content' : ''}>{children}</div></dialog>;
}

export default function IndustryApp() {
  const [state, setState] = useState(initialWorkspace);
  const [view, setView] = useState(() => views.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const activeBusiness = useRef(state.businessId);
  const dirtyRef = useRef(false);
  activeBusiness.current = state.businessId;
  const business = businessById(state.businessId);

  const loadServer = async id => {
    setConnected(false); setConnectionError('');
    try {
      let next = await api(`/businesses/${id}`);
      const cached = loadBusiness(id);
      let saved = false; try { saved = !!localStorage.getItem(businessStorageKey(id)); } catch {}
      if (!next.profileImported && saved) next = await api(`/businesses/${id}/profile`, 'PUT', { profile: profileOf(cached), revision: next.revision });
      if (activeBusiness.current === id) { setState(next); setDirty(false); setConnected(true); }
    } catch (e) { if (activeBusiness.current === id) setConnectionError(e.message); }
  };
  useEffect(() => { loadServer(state.businessId); }, [state.businessId]);
  useEffect(() => {
    if (!connected || dirty || !(state.jobs?.some(j => j.status === 'running') || state.assistantRuns?.some(r => r.status === 'running'))) return;
    const id = state.businessId; const timer = setInterval(async () => {
      try { const next = await api(`/businesses/${id}`); if (activeBusiness.current === id && !dirtyRef.current) setState(next); } catch (e) { setConnectionError(e.message); }
    }, 1500); return () => clearInterval(timer);
  }, [connected, dirty, state.businessId, state.jobs, state.assistantRuns]);
  const perform = async task => {
    const id = state.businessId; setBusy(true);
    try { return await task(id); } catch (e) { setToast(e.message); return null; } finally { setBusy(false); }
  };
  const act = (path, body = {}, method = 'POST', returnsState = true) => perform(async id => {
    if (!connected) throw new Error('Start the local server and reconnect first.');
    if (dirty) throw new Error('Save your profile edits before continuing.');
    const next = await api(`/businesses/${id}${path}`, method, method === 'GET' ? undefined : body);
    const snapshot = returnsState && next.businessId ? next : await api(`/businesses/${id}`);
    if (activeBusiness.current === id) setState(snapshot);
    return next;
  });

  useEffect(() => {
    try { localStorage.setItem(businessStorageKey(state.businessId), JSON.stringify(state)); localStorage.setItem(activeBusinessKey, state.businessId); }
    catch { setStorageWarning(true); }
  }, [state]);
  useEffect(() => { const sync = () => setView(views.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview'); addEventListener('hashchange', sync); return () => removeEventListener('hashchange', sync); }, []);
  useEffect(() => { document.title = `${business.name} / ${viewLabel(view)} — GTM Engine`; document.getElementById('main-content')?.focus({ preventScroll: true }); }, [view, business.id]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 4000); return () => clearTimeout(timer); } }, [toast]);

  const go = next => { setView(next); location.hash = next; setMobileOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }); };
  const change = updater => { dirtyRef.current = true; setDirty(true); setState(s => ({ ...updater(s), approved: false, approvedAt: null })); };
  const switchBusiness = async id => {
    if (id === state.businessId || busy) return;
    if (dirty && !await saveDraft()) return;
    dirtyRef.current = false;
    setState(loadBusiness(id)); setDirty(false); setConnected(false); setActivityOpen(false); setResetOpen(false); setMobileOpen(false); setIntegrationOpen(false);
    setToast(`Switched to ${businessById(id).name}.`);
  };
  const saveDraft = () => perform(async id => { const next = await api(`/businesses/${id}/profile`, 'PUT', { profile: profileOf(state), revision: state.revision }); if (activeBusiness.current === id) { setState(next); dirtyRef.current = false; setDirty(false); setToast(`${business.name} profile saved on the local server.`); } return next; });
  const approve = acknowledged => perform(async id => {
    if (!acknowledged || missingResearchFields(state).length) return;
    const saved = await api(`/businesses/${id}/profile`, 'PUT', { profile: profileOf(state), revision: state.revision });
    const next = await api(`/businesses/${id}/approve`, 'POST', { acknowledged, revision: saved.revision });
    if (activeBusiness.current === id) { setState(next); dirtyRef.current = false; setDirty(false); setToast(`${business.name} is ready for prospect research.`); go('discovery'); }
  });
  const exportBrief = () => {
    const blob = new Blob([JSON.stringify(createResearchBrief(state), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${business.id}-research-brief.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast(`${business.name} research brief exported.`);
  };

  return <div className="app-shell industry-app">
    <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside id="business-navigation" className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <a className="brand" href="#overview" onClick={() => go('overview')}><span className="brand-mark"><GitBranch size={25} /></span><span>GTM Engine<span className="brand-subtitle">Industrial sales workspace</span></span></a>
      <div className="business-picker"><span className={`business-stamp ${business.color}`}>{business.initials}</span><label><span>Business workspace</span><select aria-label="Choose business" value={business.id} onChange={e => switchBusiness(e.target.value)}>{businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><ChevronDown size={13} /></div>
      <nav aria-label="Main navigation"><button className={`nav-item ${view === 'overview' ? 'active' : ''}`} onClick={() => go('overview')} aria-current={view === 'overview' ? 'page' : undefined}><LayoutDashboard size={18} /><span>Overview</span></button><div className="nav-label">Your workflow<span>5 modules</span></div>{modules.map((m, i) => { const Icon = icons[i]; return <button key={m.id} className={`nav-item ${view === m.id ? 'active' : ''}`} aria-current={view === m.id ? 'page' : undefined} onClick={() => go(m.id)}><Icon size={18} /><span>{m.short}</span>{i === 0 && state.approved ? <Check className="nav-check" size={13} /> : <span className="nav-number">{i + 1}</span>}</button>; })}<div className="nav-label billing-nav-label">Account</div><button className={`nav-item ${view === 'billing' ? 'active' : ''}`} onClick={() => go('billing')} aria-current={view === 'billing' ? 'page' : undefined}><Wallet size={18} /><span>Billing & credits</span></button></nav>
      <div className="sidebar-bottom"><div className="workspace-progress"><div><span>Profile readiness</span><strong>{state.approved ? 'Approved' : 'Draft'}</strong></div><div className="progress-track"><span style={{ width: state.approved ? '100%' : `${Math.max(8, (9 - missingResearchFields(state).length) / 9 * 90)}%` }} /></div><p>Research approval is separate from engineering and quote approval.</p></div><button className="sidebar-help" onClick={() => { go('product'); setToast('Start with products, review capabilities, then choose ideal customers.'); }}><CircleHelp size={16} />Review this business’s profile<ChevronRight size={13} /></button><div className="sidebar-foot"><span className="mini-brand">G</span><span>Two separate businesses</span><span className="version">v0.3</span></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="business-navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><span>{business.name}</span><ChevronRight size={14} /><strong>{viewLabel(view)}</strong></div><div className="topbar-actions"><button className={`header-credit ${state.billing?.lowBalance ? 'low' : ''}`} aria-label="Open billing and reload credits" onClick={() => go('billing')}><Wallet size={15} /><strong>{(state.wallet?.credits ?? 0).toLocaleString()}</strong><span>credits</span></button><span className="demo-label"><i />Prototype</span><span className="top-divider" /><button className="activity-button" aria-label="Activity" onClick={() => setActivityOpen(true)}><Activity size={17} /><span>Activity</span></button><span className="user-avatar">YS</span></div></header>
      <main id="main-content" tabIndex={-1}>{storageWarning && <div className="notice warning">Browser storage is unavailable. Export your brief to retain your work.</div>}
        {connectionError && <div className="notice warning" role="alert"><span>{connectionError} Start the server with npm start.</span><button className="button secondary" onClick={() => loadServer(state.businessId)}>Reconnect</button></div>}
        {connectionError?.includes('access token') && <form className="portal-login" onSubmit={async e => { e.preventDefault(); try { await connect(accessToken); setAccessToken(''); loadServer(state.businessId); } catch (error) { setConnectionError(error.message); } }}><label>Project access token<input type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)} autoComplete="off" /></label><button className="button primary">Connect</button></form>}
        {dirty && <div className="notice warning"><span>Profile edits have not been saved to the server. Save before running downstream workflows.</span><button disabled={busy || !connected} className="button secondary" onClick={saveDraft}>Save profile</button></div>}
        <div className="runtime-status"><span><i className={connected ? 'online' : ''} />{busy ? 'Working…' : connected ? dirty ? 'Profile edits pending' : 'Saved on local server' : 'Connecting to local server…'}</span><button onClick={() => setIntegrationOpen(true)}>Service connections</button></div>
        {view === 'overview' && <BusinessOverview business={business} state={state} switchBusiness={switchBusiness} go={go} exportBrief={exportBrief} />}
        {view === 'product' && <fieldset className="workflow-fieldset" disabled={busy || !connected}><ModuleOne key={state.businessId} business={business} state={state} change={change} approve={approve} saveDraft={saveDraft} exportBrief={exportBrief} go={go} act={act} busy={busy} /></fieldset>}
        {view === 'discovery' && <Discovery key={state.businessId} state={state} act={act} busy={busy || !connected || dirty} go={go} />}
        {view === 'graph' && <KnowledgeGraph key={state.businessId} state={state} act={act} busy={busy || !connected || dirty} go={go} />}
        {view === 'outreach' && <Outreach key={state.businessId} state={state} act={act} busy={busy || !connected || dirty} go={go} />}
        {view === 'pipeline' && <Pipeline key={state.businessId} state={state} act={act} busy={busy || !connected || dirty} />}
        {view === 'billing' && <Billing key={state.businessId} state={state} act={act} busy={busy || !connected || dirty} />}
        <footer className="page-footer"><span><span className="footer-dot" />Public-source research / server persistence / demo outreach only</span><button onClick={() => setResetOpen(true)}><RotateCcw size={13} />Reset {business.name}</button></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><CircleCheck size={18} />{toast}</div>}
    {activityOpen && <Dialog title={`${business.name} activity`} drawer close={() => setActivityOpen(false)}><div className="activity-list">{state.activity.map(item => <div className="activity-item" key={item.id}><span className="activity-point"><Check size={13} /></span><div><strong>{item.title}</strong><p>{item.detail}</p><span>{item.actor} · {new Date(item.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div></div>)}</div></Dialog>}
    {integrationOpen && <Dialog title="Service connections" drawer close={() => setIntegrationOpen(false)}><Integrations state={state} go={next => { setIntegrationOpen(false); go(next); }} /></Dialog>}
    {resetOpen && <Dialog title={`Reset ${business.name}?`} close={() => setResetOpen(false)}><p>This resets {business.name}’s profile, research, drafts, activity, and pipeline. Credit balances and billing receipts are retained.</p><div className="modal-actions"><button className="button secondary" onClick={() => setResetOpen(false)}>Keep working</button><button disabled={busy || !connected || dirty} className="button primary" onClick={async () => { const result = await act('/reset'); if (result) { setResetOpen(false); go('product'); setToast(`${business.name} reset to its website-based draft.`); } }}>Reset this business</button></div></Dialog>}
  </div>;
}

function BusinessOverview({ business, state, switchBusiness, go, exportBrief }) {
  const reviewed = Object.values(state.capabilities).filter(c => c.status === 'reviewed' && c.value.trim()).length;
  return <><div className="page-heading"><div><div className="eyebrow">Business workspace / {business.tagline}</div><h1>{business.name} workspace.</h1><p>Keep this business’s products, customer criteria, and future opportunities together.</p></div><div className="heading-actions"><button className="button secondary" onClick={exportBrief}><Download size={15} />Export research brief</button><button className="button primary" onClick={() => go('product')}>Review products & ICP<ArrowRight size={15} /></button></div></div>
    <section className="workflow-section" aria-label="Five-module industrial workflow"><div className="flow-label"><span>Campaign flow</span><span><Link2 size={14} />One business at every handoff</span></div><div className="flow-cards">{modules.map((m, i) => { const Icon = icons[i]; return <button key={m.id} className={`flow-card ${i === 0 && state.approved ? 'done' : ''}`} onClick={() => go(m.id)}><div className="flow-top"><span className={`icon-box ${m.color}`}><Icon size={21} /></span><span className="step-number">{m.number}</span></div><h2>{m.short}</h2><p>{i === 0 ? 'Define products, supply capabilities, and the target buyer.' : i === 1 ? 'Find companies with a relevant industrial application.' : i === 2 ? 'Connect sites, equipment, parts, evidence, and people.' : i === 3 ? 'Reach the right buyer with a reviewed introduction.' : 'Track RFQs, technical review, quotations, and orders.'}</p><div className="flow-bottom"><span>{i === 0 ? state.approved ? 'Research profile approved' : 'Review your profile' : state.leads?.length ? 'Open workspace' : 'Ready to connect'}</span><ChevronRight size={15} /></div></button>; })}</div><div className="feedback-line"><GitBranch size={14} /><span>Trial results, purchase orders, and reorders inform the next targeting cycle.</span><Link2 size={14} /></div></section>
    <div className="metric-strip"><div className="metric"><div className="metric-label"><Layers3 size={16} />Product families in scope</div><strong>{state.productFamilies.length}</strong><span>Selected for this business</span></div><div className="metric"><div className="metric-label"><FileCheck2 size={16} />Capabilities reviewed</div><strong>{reviewed}<small> / {business.capabilities.length}</small></strong><span>Website statements need confirmation</span></div><div className="metric"><div className="metric-label"><Users size={16} />Target buyer segments</div><strong>{state.icp.segments.length || '—'}</strong><span>Choose a commercial direction</span></div><div className="metric"><div className="metric-label"><ShieldCheck size={16} />Research approval</div><strong className="metric-word">{state.approved ? 'Approved' : 'Pending'}</strong><span>Separate from technical qualification</span></div></div>
    <div className="business-overview-grid"><section className="panel"><div className="section-heading"><div><h2>Two businesses. Independent workspaces.</h2><p>Switch businesses without carrying over products, approvals, or campaign data.</p></div></div><div className="business-cards">{businesses.map(b => <button key={b.id} className={`business-card ${b.id === business.id ? 'selected' : ''}`} aria-pressed={b.id === business.id} onClick={() => switchBusiness(b.id)}><span className={`business-stamp ${b.color}`}>{b.initials}</span><div><strong>{b.name}</strong><span>{b.tagline}</span><small>{b.id === business.id ? 'Current workspace' : 'Open workspace'}</small></div>{b.id === business.id ? <CircleCheck size={18} /> : <ArrowRight size={17} />}</button>)}</div><div className="source-strip"><BookOpen size={16} /><span>The company profiles begin with public website information. Numerical limits, certification status, and delivery commitments still need confirmation.</span></div></section><aside className="next-panel"><span className="next-badge"><Target size={15} />Module 1 first</span><h2>Know what you can supply.</h2><p>Review the product catalog, capture verified capabilities, and choose your markets and buyer segments before discovery.</p><button className="button primary" onClick={() => go('product')}>Open product & ICP<ArrowRight size={15} /></button><div className="approval-note"><ShieldCheck size={20} /><div><strong>Two distinct approvals</strong><span>A customer profile can be ready for research while an individual application still needs engineering review.</span></div></div></aside></div>
  </>;
}

