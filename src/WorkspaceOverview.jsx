import React from 'react';
import { ArrowRight, BookOpen, Check, ChevronRight, Compass, FileCheck2, ShieldCheck, Target, Users } from 'lucide-react';
import { modules } from './data';

const date = value => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function WorkspaceOverview({ business, state, go, exportBrief }) {
  const leads = state.leads || [];
  const drafts = state.drafts || [];
  const shortlisted = leads.filter(lead => lead.selected && !lead.excludedReason);
  const pending = drafts.filter(draft => ['draft', 'rejected'].includes(draft.status));
  const approved = drafts.filter(draft => draft.status === 'approved');
  const contacted = leads.filter(lead => lead.stage !== 'Matched' && lead.stage !== 'Closed lost');
  const reviewed = Object.values(state.capabilities).filter(value => value.status === 'reviewed' && value.value.trim()).length;
  const next = !state.approved
    ? { title: 'Confirm your customer profile', text: 'Review the products, target market, and qualification boundaries before research.', action: 'Review profile', view: 'product', icon: FileCheck2 }
    : !leads.length
      ? { title: 'Find the accounts worth researching', text: 'Your approved profile is ready. Start account research to inspect potential applications.', action: 'Open account research', view: 'discovery', icon: Compass }
      : pending.length
        ? { title: `${pending.length} ${pending.length === 1 ? 'message needs' : 'messages need'} human review`, text: 'Check the recipient, claims, and evidence, then approve the exact message version.', action: 'Open HITL review', view: 'outreach', icon: ShieldCheck }
        : !shortlisted.length
          ? { title: 'Choose your first account', text: 'Inspect the research and fit rationale, then add relevant accounts to your shortlist.', action: 'Review accounts', view: 'discovery', icon: Users }
          : approved.length
            ? { title: 'Approved messages are ready for a dry run', text: 'Review the approved version in outreach before recording a local demo result.', action: 'Open approved messages', view: 'outreach', icon: ShieldCheck }
            : drafts.some(draft => draft.status === 'simulated')
              ? { title: 'Keep the opportunity context current', text: 'Your demo outreach is recorded. Track subsequent, user-reported sales milestones in the pipeline.', action: 'Open pipeline', view: 'pipeline', icon: Target }
              : { title: 'Prepare a relevant introduction', text: 'Your shortlisted accounts carry their application context and public sources into the draft.', action: 'Prepare outreach', view: 'outreach', icon: BookOpen };
  const NextIcon = next.icon;
  const metrics = [
    { label: 'Researched accounts', count: leads.length, detail: 'Public evidence to inspect', click: () => go('discovery', { accountsView: 'all' }) },
    { label: 'Shortlisted', count: shortlisted.length, detail: 'Selected for qualification', click: () => go('discovery', { accountsView: 'shortlisted' }) },
    { label: 'Needs human review', count: pending.length, detail: 'Exact-message decisions', click: () => go('outreach'), review: true },
    { label: 'Pipeline progress', count: contacted.length, detail: 'Accounts beyond matching', click: () => go('pipeline') },
  ];
  const steps = [state.approved, leads.length > 0, leads.length > 0, drafts.some(draft => ['approved', 'simulated'].includes(draft.status)), leads.some(lead => lead.events?.some(event => event.mode === 'dry_run' || event.mode === 'user_reported'))];

  return <div className="workspace-overview">
    <div className="page-heading"><div><h1>{business.name}</h1><p>{business.tagline}. {state.icp.regions ? `Campaign territory: ${state.icp.regions}.` : 'Choose a campaign territory to begin.'}</p></div><div className="heading-actions"><button className="button secondary" onClick={exportBrief}>Export brief</button><button className="button primary" onClick={() => go(next.view)}>{next.action}<ArrowRight size={15} /></button></div></div>

    <div className="workspace-metrics">{metrics.map(metric => <button key={metric.label} className={`workspace-metric ${metric.review && pending.length ? 'needs-attention' : ''}`} onClick={metric.click}><span>{metric.label}<ChevronRight size={14} /></span><strong>{metric.count}</strong><small>{metric.detail}</small></button>)}</div>

    <div className="workspace-columns"><div className="workspace-main-column">
      <section className="panel account-overview"><div className="section-heading"><div><h2>Accounts in this campaign</h2><p>Research fit and commercial progress stay distinct.</p></div><button className="text-button" onClick={() => go('discovery', { accountsView: 'all' })}>View all accounts<ChevronRight size={14} /></button></div>
        {leads.length ? <div className="research-scroll"><table><thead><tr><th scope="col">Company</th><th scope="col">Research fit</th><th scope="col">Stage</th><th scope="col">Evidence</th></tr></thead><tbody>{leads.slice(0, 5).map(lead => <tr key={lead.id}><td><button className="overview-account" onClick={() => go('discovery', { accountId: lead.id })}><span className="company-monogram">{lead.name.split(' ').slice(0, 2).map(part => part[0]).join('')}</span><span><strong>{lead.name}</strong><small>{lead.location}</small></span></button></td><td><span className="overview-fit">{lead.fit.score}<small>/100</small></span></td><td><span className={`pill ${lead.stage === 'Matched' ? '' : 'green'}`}>{lead.stage}</span></td><td><span className="evidence-caption"><BookOpen size={13} />{lead.facts?.length || 0} source facts</span></td></tr>)}</tbody></table></div> : <div className="overview-empty"><Compass size={27} /><h3>Your next accounts start here</h3><p>Approve a customer profile, then research real companies with a potential application for your products.</p><button className="button secondary" onClick={() => go(state.approved ? 'discovery' : 'product')}>{state.approved ? 'Open account research' : 'Review product & ICP'}<ArrowRight size={14} /></button></div>}
      </section>

      <section className="panel campaign-handoffs"><div className="section-heading"><div><h2>Campaign workflow</h2><p>Each handoff keeps this business’s context.</p></div></div><div className="handoff-list">{modules.map((module, index) => <button key={module.id} onClick={() => go(module.id)} className={module.id === 'outreach' ? 'human-handoff' : ''}><span className={`handoff-number ${steps[index] ? 'complete' : ''}`}>{steps[index] ? <Check size={14} /> : index + 1}</span><div><strong>{module.short}</strong><span>{module.output}</span></div>{module.id === 'outreach' && pending.length > 0 && <small className="handoff-pending">{pending.length} to review</small>}<ChevronRight size={15} /></button>)}</div></section>
    </div><aside className="workspace-context-column">
      <section className={`panel workspace-next-action ${next.view === 'outreach' && pending.length ? 'review-next' : ''}`}><NextIcon size={22} /><h2>{next.title}</h2><p>{next.text}</p><button className="button primary" onClick={() => go(next.view)}>{next.action}<ArrowRight size={14} /></button></section>
      <section className="panel campaign-summary"><div className="section-heading"><h2>Campaign context</h2><button className="text-button" onClick={() => go('product')}>Edit</button></div><dl><div><dt>Market</dt><dd>{state.icp.regions || 'Not selected'}</dd></div><div><dt>Buyer</dt><dd>{state.icp.segments.join(', ') || 'Not selected'}</dd></div><div><dt>Products</dt><dd>{state.productFamilies.length} families in scope</dd></div><div><dt>Capabilities</dt><dd>{reviewed} of {business.capabilities.length} internally reviewed</dd></div></dl><p className="context-boundary"><ShieldCheck size={14} />Research approval keeps technical qualification separate.</p></section>
      <section className="panel overview-activity"><div className="section-heading"><h2>Recent activity</h2></div><ol>{state.activity.slice(0, 4).map(event => <li key={event.id}><span className="activity-dot" /><div><strong>{event.title}</strong><small>{event.actor} / {date(event.at)}</small></div></li>)}</ol></section>
    </aside></div>
  </div>;
}
