import React from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import { competitorDateFresh, pricingLabels } from './competitor-evidence.js';
import './competitor-research.css';
const date = value => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const link = (url, label) => <a href={url} target="_blank" rel="noreferrer"><BookOpen size={12}/>{label}<ExternalLink size={11}/></a>;
export function Passages({ evidence }) {
  return <div className="ce-passages">{[['identity', 'Company identity'], ['positioning', 'Positioning'], ['pricing', 'Pricing'], ['packaging', 'Packaging / product range'], ['differentiator', 'Technical differentiator']].map(([key, title]) => evidence[key] && <section key={key}><h4>{title}</h4><blockquote>{evidence[key].quote}</blockquote>{link(evidence[key].url, 'Quoted source')}</section>)}</div>;
}
export function CompetitorGraphEvidence({ review }) {
  if (!review) return null;
  const fresh = review.pages.every(page => competitorDateFresh(page.checkedAt));
  return <div className="ce-graph"><h3>Competitive source review</h3><p>{fresh ? `Reviewed ${date(review.reviewedAt)}` : 'Source evidence has expired; refresh the graph.'}</p><p>{pricingLabels[review.pricingMode]}</p><p>{review.classification}</p><details><summary>Inspect quoted evidence</summary><Passages evidence={review.evidence}/></details></div>;
}
