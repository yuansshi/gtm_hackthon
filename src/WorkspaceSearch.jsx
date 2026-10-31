import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { modules } from './data';

export default function WorkspaceSearch({ state, close, go }) {
  const dialog = useRef(null);
  const [query, setQuery] = useState('');
  useEffect(() => { dialog.current.showModal(); }, []);
  const term = query.trim().toLowerCase();
  const pages = [{ id: 'overview', short: 'Overview', description: 'Campaign summary and next actions' }, ...modules, { id: 'billing', short: 'Billing & credits', description: 'Reload credits and inspect usage' }].filter(page => `${page.short} ${page.description}`.toLowerCase().includes(term));
  const accounts = (state.leads || []).filter(account => `${account.name} ${account.application}`.toLowerCase().includes(term)).slice(0, 6);
  const pick = (view, options) => { close(); go(view, options); };
  return <dialog ref={dialog} className="workspace-search-dialog" aria-label="Search this workspace" onCancel={close} onClick={event => { if (event.target === event.currentTarget) close(); }}><div className="workspace-search-input"><Search size={19} /><input aria-label="Search workspace" autoFocus placeholder="Search pages and researched accounts…" value={query} onChange={event => setQuery(event.target.value)} /><button className="icon-button" aria-label="Close search" onClick={close}><X size={17} /></button></div><div className="workspace-search-results"><p className="search-scope">Searching {state.company.name} only</p>{pages.length > 0 && <><h2>Pages</h2>{pages.map(page => <button key={page.id} onClick={() => pick(page.id)}><span><strong>{page.short}</strong><small>{page.description}</small></span><ArrowRight size={15} /></button>)}</>}{accounts.length > 0 && <><h2>Accounts</h2>{accounts.map(account => <button key={account.id} onClick={() => pick('discovery', { accountId: account.id })}><span><strong>{account.name}</strong><small>{account.application}</small></span><ArrowRight size={15} /></button>)}</>}{!pages.length && !accounts.length && <div className="search-empty">No pages or researched accounts match “{query}”.</div>}</div><div className="workspace-search-footer"><span>Use Tab to move between results</span><span>Esc to close</span></div></dialog>;
}
