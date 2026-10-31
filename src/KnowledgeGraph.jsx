import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Compass, ExternalLink, GitBranch, List, Network, Search, X } from 'lucide-react';
import { CompanyGraphEvidence } from './CompanyResearch.jsx';
import { WarmIntroductionPaths } from './PeopleResearch.jsx';
import { graphContextKey } from './graph-context.js';
import { CompetitorGraphEvidence } from './CompetitorEvidence.jsx';
import './knowledge-graph.css';

const types = ['Person', 'Company', 'Product', 'Competitor', 'Signal'];
const colors = { Product: '#315cba', Company: '#21847d', Person: '#8a61ab', Signal: '#9a5d0a', Competitor: '#667085' };
const relations = { matched_to: 'Application match', works_at: 'Published role', signal_for: 'Signal for', competes_with: 'Competitive context', previously_employed_at: 'Former employer', contacted_via: 'Outreach record', replied_to: 'Reported reply' };
const source = (url, label = 'Primary source') => url ? <a className="source-link" href={url} target="_blank" rel="noreferrer"><BookOpen size={13}/>{label}<ExternalLink size={11}/></a> : <span className="kg-muted">No public source established</span>;
const description = node => node.data.description || node.data.relevance || node.data.intent || node.data.focus || node.data.role || node.data.industry;
const date = value => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function GraphMap({ nodes, edges, selectedId, select }) {
  const columns = types.filter(type => nodes.some(node => node.type === type));
  const width = Math.max(420, columns.length * 220);
  const height = Math.max(320, ...columns.map(type => nodes.filter(node => node.type === type).length * 84 + 75));
  const layout = new Map();
  columns.forEach((type, column) => nodes.filter(node => node.type === type).forEach((node, row) => layout.set(node.id, { x: 110 + column * 220, y: 85 + row * 84 })));
  return <div className="kg-map-scroll" tabIndex={0} role="region" aria-label="Relationship map; scroll to explore">
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Selectable graph records">
      <defs><marker id="kg-arrow" markerWidth="7" markerHeight="7" refX="7" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="#9ba9bc"/></marker></defs>
      {columns.map((type, column) => <text key={type} x={column * 220 + 24} y={28} className="kg-column-label">{type}</text>)}
      {edges.map((edge, index) => {
        const a = layout.get(edge.source), b = layout.get(edge.target); if (!a || !b) return null;
        const active = edge.source === selectedId || edge.target === selectedId;
        const sameColumn = a.x === b.x;
        const startX = sameColumn ? a.x + 91 : a.x + (b.x > a.x ? 91 : -91);
        const endX = sameColumn ? b.x + 91 : b.x + (b.x > a.x ? -91 : 91);
        const curveX = sameColumn ? a.x + 108 : (startX + endX) / 2;
        return <path key={index} d={`M${startX},${a.y} C${curveX},${a.y} ${curveX},${b.y} ${endX},${b.y}`} fill="none" stroke={active ? '#315cba' : '#c6d1df'} strokeWidth={active ? 2 : 1.25} markerEnd="url(#kg-arrow)"><title>{relations[edge.type] || edge.type.replaceAll('_', ' ')}</title></path>;
      })}
      {columns.flatMap(type => nodes.filter(node => node.type === type)).map(node => {
        const position = layout.get(node.id); if (!position) return null;
        return <g key={node.id} className="kg-map-node" role="button" tabIndex={0} aria-label={`Inspect ${node.name}, ${node.type}`} aria-pressed={selectedId === node.id} onClick={() => select(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(node.id); } }}>
          <rect x={position.x - 91} y={position.y - 25} width="182" height="50" rx="6" fill={selectedId === node.id ? '#eef3ff' : '#fff'} stroke={selectedId === node.id ? '#315cba' : '#ced6e2'} strokeWidth={selectedId === node.id ? 2 : 1}/>
          <circle cx={position.x - 76} cy={position.y} r="4" fill={colors[node.type]}/>
          <text x={position.x - 63} y={position.y + 4}>{node.name.length > 22 ? node.name.slice(0, 21) + '…' : node.name}</text><title>{node.name}</title>
        </g>;
      })}
    </svg>
  </div>;
}

function NodeInspector({ node, graph, select, close, go }) {
  const panel = useRef(null);
  useEffect(() => { if (panel.current) panel.current.scrollTop = 0; }, [node.id]);
  const linked = graph.edges.filter(edge => edge.source === node.id || edge.target === node.id);
  const accountId = node.type === 'Company' && node.data.leadId;
  return <aside ref={panel} className="kg-inspector" aria-label="Selected graph record">
    <header><span className="kg-record-type"><i style={{ background: colors[node.type] }}/>{node.type}</span><button className="icon-button" aria-label="Close graph record" onClick={close}><X size={16}/></button></header>
    <h2>{node.name}</h2>
    {description(node) && <p>{description(node)}</p>}
    {source(node.data.source, node.data.provenance === 'user_reported' ? 'User-provided reference (unverified)' : node.data.provenance === 'hunter_reviewed' ? 'Vendor-returned source · role unverified' : 'Primary source')}
    <CompanyGraphEvidence profile={node.data.companyProfile}/>
    <CompetitorGraphEvidence review={node.data.competitiveReview}/>
    {accountId && <button className="kg-account-link" onClick={() => go('discovery', { accountId })}>Open account research<ArrowRight size={13}/></button>}
    <div className="kg-relationship-title"><h3>Relationships</h3><span>{linked.length}</span></div>
    <div className="kg-relationships">{linked.length ? linked.map((edge, index) => {
      const outgoing = edge.source === node.id;
      const other = graph.nodes.find(item => item.id === (outgoing ? edge.target : edge.source));
      if (!other) return null;
      return <article key={index}><small>{relations[edge.type] || edge.type.replaceAll('_', ' ')}</small><div className="kg-direction">{outgoing ? <><span>This record</span><ArrowRight size={12}/></> : null}<button onClick={() => select(other.id)}>{other.name}</button>{!outgoing ? <><ArrowRight size={12}/><span>This record</span></> : null}</div>{edge.evidence && (edge.evidence.startsWith('https:') ? source(edge.evidence, 'Relationship source') : <p>{edge.evidence}</p>)}</article>;
    }) : <p>No relationship established for this record.</p>}</div>
  </aside>;
}

export default function KnowledgeGraph({ state, act, busy, go }) {
  const [snapshot, setSnapshot] = useState(null), [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState(''), [type, setType] = useState('all'), [related, setRelated] = useState(false), [view, setView] = useState('map');
  const business = useRef(state.businessId); business.current = state.businessId;
  const contextKey = graphContextKey(state);
  const graph = snapshot && snapshot.businessId === state.businessId && (snapshot.contextKey ? snapshot.contextKey === contextKey : snapshot.contextRevision === state.revision) ? snapshot : null;
  useEffect(() => { if (snapshot && !graph) { setSnapshot(null); setSelectedId(null); } }, [snapshot, graph]);
  useEffect(() => { setQuery(''); setType('all'); setRelated(false); setSelectedId(null); }, [state.businessId]);
  const runQuery = async () => {
    const requestedBusiness = state.businessId;
    const result = await act('/graph/query', {}, 'POST', false);
    if (result && requestedBusiness === business.current) { setSnapshot(result); setSelectedId(null); setRelated(false); }
  };
  const nodes = graph?.nodes || [], edges = graph?.edges || [];
  const selected = nodes.find(node => node.id === selectedId);
  const connections = new Map(nodes.map(node => [node.id, 0]));
  edges.forEach(edge => { connections.set(edge.source, (connections.get(edge.source) || 0) + 1); if (edge.source !== edge.target) connections.set(edge.target, (connections.get(edge.target) || 0) + 1); });
  const neighborIds = new Set([selectedId]);
  if (related && selected) edges.forEach(edge => { if (edge.source === selectedId) neighborIds.add(edge.target); if (edge.target === selectedId) neighborIds.add(edge.source); });
  const shown = nodes.filter(node => (type === 'all' || node.type === type) && (!related || !selected || neighborIds.has(node.id)) && `${node.name} ${node.type}`.toLowerCase().includes(query.trim().toLowerCase()));
  const shownIds = new Set(shown.map(node => node.id));
  const shownEdges = edges.filter(edge => shownIds.has(edge.source) && shownIds.has(edge.target));
  const filtered = !!query || type !== 'all' || (related && !!selected);
  const clearFilters = () => { setQuery(''); setType('all'); setRelated(false); };
  const select = id => { setSelectedId(id); if (!shownIds.has(id)) clearFilters(); };
  const close = () => { setSelectedId(null); setRelated(false); };
  return <>
    <div className="page-heading"><div><div className="eyebrow">Module 03</div><h1>Knowledge graph</h1><p>Explore the evidence connecting people, accounts, products, and market signals.</p></div><div className="heading-actions"><button disabled={busy} className="button primary" onClick={runQuery}><Network size={15}/>{graph ? 'Refresh graph' : 'Query graph'} · 1 credit</button></div></div>
    <div className="notice"><GitBranch size={18}/><span>Scoped to {state.company.name}. Application matches do not establish buying intent.</span></div>
    {(state.signalFixture || state.companyFixture || state.peopleFixture || state.competitorFixture) && <div className="notice">Test fixture only · synthetic research evidence</div>}
    {!graph ? <section className="panel workflow-empty"><Compass size={28}/><h2>Explore this business’s relationships</h2><p>Query the graph after discovery, then select a record to inspect its sources and connections.</p></section> : <>
      <section className="panel kg-explorer" aria-label="Graph explorer">
        <div className="kg-toolbar"><label className="kg-search"><Search size={15}/><span className="sr-only">Search graph records</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search records…"/>{query && <button className="icon-button" aria-label="Clear graph search" onClick={() => setQuery('')}><X size={13}/></button>}</label><label className="kg-type-filter"><span>Type</span><select value={type} onChange={event => setType(event.target.value)} aria-label="Graph record type"><option value="all">All types ({nodes.length})</option>{types.map(item => <option key={item} value={item}>{item} ({nodes.filter(node => node.type === item).length})</option>)}</select></label><div className="kg-view-switch" role="group" aria-label="Graph view"><button aria-pressed={view === 'map'} onClick={() => setView('map')}><Network size={14}/>Map</button><button aria-pressed={view === 'records'} onClick={() => setView('records')}><List size={14}/>Records</button></div></div>
        <div className="kg-result-bar"><span role="status">{shown.length} of {nodes.length} records · {shownEdges.length} relationships shown</span>{selected && <label><input type="checkbox" checked={related} onChange={event => setRelated(event.target.checked)}/>Selected record & neighbors</label>}{filtered && <button onClick={clearFilters}>Clear filters</button>}</div>
        <div className={`kg-body ${selected ? 'kg-has-selection' : ''}`}>
          <div className="kg-main">
            {selected && !shownIds.has(selected.id) && <div className="kg-hidden-selection">Selected record is outside these filters.<button onClick={clearFilters}>Show record</button></div>}
            {!shown.length ? <div className="kg-empty"><Search size={24}/><h2>{nodes.length ? 'No matching records' : 'No graph records yet'}</h2><p>{nodes.length ? 'Adjust the search or type filter to find a record.' : 'Add account research to begin connecting evidence.'}</p>{nodes.length ? <button className="button secondary" onClick={clearFilters}>Clear filters</button> : <button className="button secondary" onClick={() => go('discovery')}>Open accounts</button>}</div> : view === 'map' ? <GraphMap nodes={shown} edges={shownEdges} selectedId={selectedId} select={select}/> : <div className="kg-record-scroll"><table className="kg-record-table"><thead><tr><th>Record</th><th>Type</th><th>Total connections</th></tr></thead><tbody>{shown.map(node => <tr className={selectedId === node.id ? 'kg-selected' : ''} key={node.id}><td><button aria-pressed={selectedId === node.id} onClick={() => select(node.id)}><i style={{ background: colors[node.type] }}/>{node.name}</button></td><td>{node.type}</td><td>{connections.get(node.id)}</td></tr>)}</tbody></table></div>}
            <footer className="kg-map-footer"><span>{view === 'map' ? 'Select a record to inspect its evidence. Scroll within the map to explore.' : 'Select a record to keep its sources beside the list.'}</span><span>{graph.queriedAt ? `Queried ${date(graph.queriedAt)}` : graph.engine}</span></footer>
          </div>
          {selected ? <NodeInspector node={selected} graph={graph} select={select} close={close} go={go}/> : <aside className="kg-inspector kg-inspector-empty" aria-label="Record evidence"><BookOpen size={23}/><h2>Evidence in context</h2><p>Select a record to see its primary sources and follow related records here.</p><small>{graph.engine} · Native graph</small></aside>}
        </div>
      </section>
      <section className="panel paths-panel"><div className="section-heading"><div><h2>Buyer paths</h2><p>Published person → company → matched product. Purchasing authority remains unverified.</p></div></div>{graph.paths.length ? graph.paths.map((path, index) => <div className="buyer-path" key={index}><strong>{path.person}</strong><ArrowRight size={15}/><span>{path.company}</span><ArrowRight size={15}/><span>{path.product}</span>{source(path.evidence.source, 'Evidence')}<p>{path.evidence.relevance}</p></div>) : <div className="inline-empty">No source-backed person-to-company path has been established.</div>}</section>
      <WarmIntroductionPaths graph={graph} go={go} fixture={state.peopleFixture}/>
      {graph.marketPaths?.length > 0 && <section className="panel paths-panel"><div className="section-heading"><div><h2>Dated signal paths</h2><p>Signal → company → product. Public event context; buyer evaluation timing remains unconfirmed.</p></div></div>{graph.marketPaths.map((path, index) => <div className="buyer-path" key={index}><strong>{path.signal}</strong><ArrowRight size={15}/><span>{path.company}</span><ArrowRight size={15}/><span>{path.product}</span>{source(path.evidence.source, 'Company publication')}<p>{path.evidence.eventDate}: {path.evidence.quote}</p></div>)}</section>}
    </>}
    <div className="workflow-next"><span>Carry account evidence into a message for human review.</span><button className="button primary" onClick={() => go('outreach')}>Prepare outreach<ArrowRight size={15}/></button></div>
  </>;
}
