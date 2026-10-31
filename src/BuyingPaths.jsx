import React from 'react';
import { ArrowRight, ExternalLink, GitBranch } from 'lucide-react';
import './buying-signals.css';

const source = (url, label) => <a href={url} target="_blank" rel="noreferrer">{label}<ExternalLink size={11}/></a>;
export default function BuyingPaths({ paths, go }) {
  const evaluations = paths?.evaluations || [], displacements = paths?.displacements || [];
  return <section className="panel bs-paths"><div className="section-heading"><div><h2><GitBranch size={16}/>Published buying windows</h2><p>Native job/evaluation and supplier-change traversals. Links reflect reviewed publications and owner-assessed relevance.</p></div><span className="pill">{evaluations.length} evaluation · {displacements.length} supplier-change paths</span></div>
    {!evaluations.length && !displacements.length && <div className="inline-empty">No active reviewed buying window. In Accounts → Signals, review dated publications and link their exact window, then refresh this graph.</div>}
    {[...evaluations, ...displacements].map(path => <article className="bs-path" key={path.id}><header><strong>{path.company}</strong><span className="ar-badge ar-badge-healthy">Published window active</span></header><div className="bs-route">{path.kind === 'evaluation' ? <><span>{path.jobTitle}</span><ArrowRight size={14}/><span>Published evaluation</span></> : <><span>Supplier-change notice</span><ArrowRight size={14}/><span>{path.competitor}</span></>}<ArrowRight size={14}/><span>{path.product}</span></div><p>{path.startDate} to {path.endDate} (UTC days)</p><p>{path.interpretation}</p><details><summary>Window and supporting publications</summary><blockquote>{path.windowQuote}</blockquote>{source(path.source, 'Company window source')}{path.kind === 'evaluation' ? <><blockquote>{path.jobQuote}</blockquote>{source(path.jobSource, 'Job requisition')}</> : <><blockquote>{path.competitorIdentityQuote}</blockquote>{source(path.competitorSource, 'Competitor identity')}</>}</details><button className="button secondary" onClick={() => go('discovery', { accountId: path.leadId })}>Review account evidence<ArrowRight size={13}/></button></article>)}
    {(evaluations.length >= 100 || displacements.length >= 100) && <p className="bs-warning">This view is capped at 100 paths per traversal.</p>}
  </section>;
}
