import React, { useEffect, useRef, useState } from 'react';
import { Activity, Check, ChevronDown, ChevronRight, CircleCheck, CircleHelp, Compass, GitBranch, LayoutDashboard, Link2, Menu, Network, RotateCcw, ShieldCheck, Target, X, BarChart3, Wallet, Search } from 'lucide-react';
import ModuleOne from './ModuleOne';
import Billing from './Billing';
import WorkspaceOverview from './WorkspaceOverview';
import WorkspaceSearch from './WorkspaceSearch';
import { api, connect, profileOf } from './api';
import { Discovery, KnowledgeGraph, Outreach, Pipeline, Integrations } from './Workflow';
import { activeBusinessKey, businesses, businessById, businessStorageKey, createResearchBrief, initialBusinessState, missingResearchFields } from './businesses';
import { modules } from './data';

const icons = [Target, Compass, Network, ShieldCheck, BarChart3];
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountFocus, setAccountFocus] = useState('');
  const [accountViewRequest, setAccountViewRequest] = useState(null);
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
    if (!connected || dirty || !(state.jobs?.some(j => j.status === 'running') || state.assistantRuns?.some(r => r.status === 'running') || state.enrichmentRuns?.some(r => r.status === 'running') || state.flexprice?.pendingCount > 0)) return;
    const id = state.businessId; const timer = setInterval(async () => {
      try { const next = await api(`/businesses/${id}`); if (activeBusiness.current === id && !dirtyRef.current) setState(current => current.businessId === id && next.revision >= current.revision ? next : current); } catch (e) { if (activeBusiness.current === id) setConnectionError(e.message); }
    }, 1500); return () => clearInterval(timer);
  }, [connected, dirty, state.businessId, state.jobs, state.assistantRuns, state.enrichmentRuns, state.flexprice]);
  useEffect(() => {
    if (!connected || dirty || view !== 'graph') return;
    const id = state.businessId;
    const timer = setInterval(async () => {
      try { const next = await api(`/businesses/${id}`); if (activeBusiness.current === id && !dirtyRef.current) setState(current => current.businessId === id && next.revision >= current.revision ? next : current); }
      catch (error) { if (activeBusiness.current === id) setConnectionError(error.message); }
    }, 60000);
    return () => clearInterval(timer);
  }, [connected, dirty, view, state.businessId]);
  const perform = async (task, onError) => {
    const id = state.businessId; setBusy(true);
    try { return await task(id); } catch (e) { setToast(e.message); onError?.(e); return null; } finally { setBusy(false); }
  };
  const act = (path, body = {}, method = 'POST', returnsState = true, onError) => perform(async id => {
    if (!connected) throw new Error('Start the local server and reconnect first.');
    if (dirty) throw new Error('Save your profile edits before continuing.');
    const next = await api(`/businesses/${id}${path}`, method, method === 'GET' ? undefined : body);
    const snapshot = returnsState && next.businessId ? next : await api(`/businesses/${id}`);
    if (activeBusiness.current === id) setState(snapshot);
    return next;
  }, onError);

  useEffect(() => {
    try { localStorage.setItem(businessStorageKey(state.businessId), JSON.stringify(state)); localStorage.setItem(activeBusinessKey, state.businessId); }
    catch { setStorageWarning(true); }
  }, [state]);
  useEffect(() => { const sync = () => setView(views.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview'); addEventListener('hashchange', sync); return () => removeEventListener('hashchange', sync); }, []);
  useEffect(() => { document.title = `${business.name} / ${viewLabel(view)} — GTM Engine`; document.getElementById('main-content')?.focus({ preventScroll: true }); }, [view, business.id]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 4000); return () => clearTimeout(timer); } }, [toast]);

  useEffect(() => {
    const searchShortcut = event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(open => !open); } };
    addEventListener('keydown', searchShortcut);
    return () => removeEventListener('keydown', searchShortcut);
  }, []);
  const go = (next, options = {}) => {
    if (options.accountId) setAccountFocus(options.accountId);
    if (options.accountsView) setAccountViewRequest({ view: options.accountsView, requestId: Date.now() });
    setView(next); location.hash = next; setMobileOpen(false); window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const change = updater => { dirtyRef.current = true; setDirty(true); setState(s => ({ ...updater(s), approved: false, approvedAt: null })); };
  const switchBusiness = async id => {
    if (id === state.businessId || busy) return;
    if (dirty && !await saveDraft()) return;
    dirtyRef.current = false;
    setState(loadBusiness(id)); setDirty(false); setConnected(false); setActivityOpen(false); setResetOpen(false); setMobileOpen(false); setIntegrationOpen(false); setSearchOpen(false); setAccountFocus(''); setAccountViewRequest(null);
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
      <nav aria-label="Main navigation"><button className={`nav-item ${view === 'overview' ? 'active' : ''}`} onClick={() => go('overview')} aria-current={view === 'overview' ? 'page' : undefined}><LayoutDashboard size={18} /><span>Overview</span></button><div className="nav-label">Workspace<span>5 modules</span></div>{modules.map((m, i) => { const Icon = icons[i]; return <button key={m.id} className={`nav-item ${view === m.id ? 'active' : ''}`} aria-current={view === m.id ? 'page' : undefined} onClick={() => go(m.id)}><Icon size={18} /><span>{m.short}</span>{m.id === 'outreach' && state.drafts?.some(d => ['draft', 'rejected'].includes(d.status)) ? <span className="hitl-nav-count" aria-label={`${state.drafts.filter(d => ['draft', 'rejected'].includes(d.status)).length} messages need human review`}>{state.drafts.filter(d => ['draft', 'rejected'].includes(d.status)).length}</span> : i === 0 && state.approved ? <Check className="nav-check" size={13} /> : <span className="nav-number">{i + 1}</span>}</button>; })}<div className="nav-label billing-nav-label">Account</div><button className={`nav-item ${view === 'billing' ? 'active' : ''}`} onClick={() => go('billing')} aria-current={view === 'billing' ? 'page' : undefined}><Wallet size={18} /><span>Billing & credits</span></button><button className="nav-item" onClick={() => setIntegrationOpen(true)}><Link2 size={18} /><span>Connections</span></button></nav>
      <div className="sidebar-bottom"><div className="workspace-progress"><div><span>Profile readiness</span><strong>{state.approved ? 'Approved' : 'Draft'}</strong></div><div className="progress-track"><span style={{ width: state.approved ? '100%' : `${Math.max(8, (9 - missingResearchFields(state).length) / 9 * 90)}%` }} /></div><p>{state.approved ? 'Ready for account research' : 'Review products and customer criteria'}</p></div><button className="sidebar-help" onClick={() => { go('product'); setToast('Start with products, review capabilities, then choose ideal customers.'); }}><CircleHelp size={16} />Review business profile<ChevronRight size={13} /></button><div className="sidebar-foot"><span className="mini-brand">G</span><span>Business data stays separate</span><span className="version">v0.3</span></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="business-navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><span>{business.name}</span><ChevronRight size={14} /><strong>{viewLabel(view)}</strong></div><div className="topbar-actions"><button className="workspace-search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search workspace, Command or Control K"><Search size={15} /><span>Search workspace</span><kbd>⌘ K</kbd></button><button className={`header-credit ${state.billing?.lowBalance ? 'low' : ''}`} aria-label="Open billing and reload credits" onClick={() => go('billing')}><Wallet size={15} /><strong>{(state.wallet?.credits ?? 0).toLocaleString()}</strong><span>credits</span></button><span className="demo-label"><i />Demo mode</span><span className="top-divider" /><button className="activity-button" aria-label="Activity" onClick={() => setActivityOpen(true)}><Activity size={17} /><span>Activity</span></button><span className="user-avatar">YS</span></div></header>
      <main id="main-content" tabIndex={-1}>{storageWarning && <div className="notice warning">Browser storage is unavailable. Export your brief to retain your work.</div>}
        {connectionError && <div className="notice warning" role="alert"><span>{connectionError} Start the server with npm start.</span><button className="button secondary" onClick={() => loadServer(state.businessId)}>Reconnect</button></div>}
        {connectionError?.includes('access token') && <form className="portal-login" onSubmit={async e => { e.preventDefault(); try { await connect(accessToken); setAccessToken(''); loadServer(state.businessId); } catch (error) { setConnectionError(error.message); } }}><label>Project access token<input type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)} autoComplete="off" /></label><button className="button primary">Connect</button></form>}
        {dirty && <div className="notice warning"><span>Profile edits have not been saved to the server. Save before running downstream workflows.</span><button disabled={busy || !connected} className="button secondary" onClick={saveDraft}>Save profile</button></div>}
        <div className="runtime-status"><span><i className={connected ? 'online' : ''} />{busy ? 'Working…' : connected ? dirty ? 'Profile edits pending' : 'All changes saved' : 'Connecting to local server…'}</span><button onClick={() => setIntegrationOpen(true)}>Service connections</button></div>
        {state.flexprice?.enabled && state.flexprice.pendingCount > 0 && view !== 'billing' && <div className="notice warning" role="status"><Wallet size={17}/><span>A project operation is in progress or its usage needs reconciliation before another credit-consuming action.</span><button className="button secondary" onClick={() => go('billing')}>Review billing status</button></div>}
        {view === 'overview' && <WorkspaceOverview business={business} state={state} go={go} exportBrief={exportBrief} />}
        {view === 'product' && <fieldset className="workflow-fieldset" disabled={busy || !connected}><ModuleOne key={state.businessId} business={business} state={state} change={change} approve={approve} saveDraft={saveDraft} exportBrief={exportBrief} go={go} act={act} busy={busy} /></fieldset>}
        {view === 'discovery' && <Discovery key={state.businessId} state={state} act={act} busy={busy || !connected || dirty} go={go} focusAccountId={accountFocus} onFocusHandled={() => setAccountFocus('')} viewRequest={accountViewRequest} />}
        {view === 'graph' && <KnowledgeGraph key={state.businessId} state={state} act={act} busy={busy || !connected || dirty} go={go} />}
        {view === 'outreach' && <Outreach key={state.businessId} state={state} act={act} busy={busy || !connected || dirty} go={go} />}
        {view === 'pipeline' && <Pipeline key={state.businessId} state={state} act={act} busy={busy || !connected || dirty} />}
        {view === 'billing' && <Billing key={state.businessId} state={state} act={act} busy={busy || !connected || dirty} />}
        <footer className="page-footer"><span><span className="footer-dot" />Public evidence research · Demo outreach only</span><button onClick={() => setResetOpen(true)}><RotateCcw size={13} />Reset {business.name}</button></footer>
      </main>
    </div>
    {searchOpen && <WorkspaceSearch state={state} close={() => setSearchOpen(false)} go={go} />}
    {toast && <div className="toast" role="status"><CircleCheck size={18} />{toast}</div>}
    {activityOpen && <Dialog title={`${business.name} activity`} drawer close={() => setActivityOpen(false)}><div className="activity-list">{state.activity.map(item => <div className="activity-item" key={item.id}><span className="activity-point"><Check size={13} /></span><div><strong>{item.title}</strong><p>{item.detail}</p><span>{item.actor} · {new Date(item.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div></div>)}</div></Dialog>}
    {integrationOpen && <Dialog title="Service connections" drawer close={() => setIntegrationOpen(false)}><Integrations state={state} go={next => { setIntegrationOpen(false); go(next); }} /></Dialog>}
    {resetOpen && <Dialog title={`Reset ${business.name}?`} close={() => setResetOpen(false)}><p>This resets {business.name}’s profile, research, drafts, activity, and pipeline. Credit balances, billing receipts, and provider processing restrictions are retained.</p><div className="modal-actions"><button className="button secondary" onClick={() => setResetOpen(false)}>Keep working</button><button disabled={busy || !connected || dirty} className="button primary" onClick={async () => { const result = await act('/reset'); if (result) { setResetOpen(false); go('product'); setToast(`${business.name} reset to its website-based draft.`); } }}>Reset this business</button></div></Dialog>}
  </div>;
}
