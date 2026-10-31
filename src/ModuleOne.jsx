import React, { useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronLeft, ChevronDown, Download, ExternalLink, FileCheck2, Layers3, Plus, Save, ShieldCheck, Target } from 'lucide-react';
import { missingResearchFields } from './businesses';
import GuidedIntake, { ConfidencePanel } from './GuidedIntake';
import {commercialPlanningFields} from './commercial-planning.js';
import {personaFields} from './buyer-persona.js';
import ExpansionSuggestions from './ExpansionSuggestions.jsx';

const tabs = [
  { title: 'Company & products', icon: Layers3 },
  { title: 'Capabilities', icon: FileCheck2 },
  { title: 'Ideal customers', icon: Target },
];

function Field({ label, value, onChange, help, placeholder, multiline = false, id, ...props }) {
  return <div className="field"><label htmlFor={id}>{label}</label>{multiline ? <textarea id={id} rows={3} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} maxLength={3000} {...props} /> : <input id={id} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} maxLength={1000} {...props} />}{help && <small>{help}</small>}</div>;
}

export default function ModuleOne({ business, state, change: commitChange, approve, saveDraft, exportBrief, go, act, busy }) {
  const [tab, setTab] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const change = updater => { setAcknowledged(false); commitChange(updater); };
  const missing = missingResearchFields(state);
  const reviewedCount = Object.values(state.capabilities).filter(c => c.status === 'reviewed' && c.value.trim()).length;
  const update = (section, key, value) => change(s => ({ ...s, [section]: { ...s[section], [key]: value } }));
  const toggle = (section, key, item) => update(section, key, state[section][key].includes(item) ? state[section][key].filter(x => x !== item) : [...state[section][key], item]);
  const toggleFamily = id => change(s => ({ ...s, productFamilies: s.productFamilies.includes(id) ? s.productFamilies.filter(f => f !== id) : [...s.productFamilies, id] }));
  const setCapability = (key, property, value) => change(s => ({ ...s, capabilities: { ...s.capabilities, [key]: { ...s.capabilities[key], [property]: value, ...(property === 'value' ? { status: 'unknown' } : {}) } } }));
  const productNames = business.families.filter(([id]) => state.productFamilies.includes(id)).map(([, name]) => name);

  return <>
    <div className="page-heading"><div><div className="eyebrow">Module 01 / {business.name}</div><h1>Product & ICP</h1><p>Turn your products, capabilities, and customer criteria into an approved research brief.</p></div><div className="heading-actions"><button className="button secondary" onClick={saveDraft}><Save size={15} />Save draft</button><button className="button secondary" onClick={exportBrief}><Download size={15} />Export brief</button></div></div>
    <div className="business-boundary"><span className={`business-stamp ${business.color}`}>{business.initials}</span><div><strong>{business.name}</strong><span>Only this business’s profile, approvals, and campaign data are in this workspace.</span></div><span className={`pill ${state.approved ? 'green' : 'amber'}`}><i />{state.approved ? 'Research profile approved' : 'Draft · review required'}</span></div>
    <details className="intake-disclosure" open={!state.approved}><summary><span><strong>Guided product intake</strong><small>{state.approved ? 'Profile approved. Expand to refine product context.' : 'Build your profile from a plain-language product description.'}</small></span><ChevronDown size={17} /></summary><GuidedIntake state={state} act={act} busy={busy} /></details>
    <div className="module-one-layout">
      <section className="panel module-one-form">
        <div className="profile-steps" role="tablist" aria-label="Module 1 sections">{tabs.map(({ title, icon: Icon }, i) => <button type="button" key={title} role="tab" aria-selected={tab === i} aria-controls={`profile-panel-${i}`} id={`profile-tab-${i}`} className={tab === i ? 'selected' : ''} onClick={() => setTab(i)}><span>{i + 1}</span><Icon size={15} />{title}</button>)}</div>
        <div role="tabpanel" id={`profile-panel-${tab}`} aria-labelledby={`profile-tab-${tab}`}>
          {tab === 0 && <>
            <div className="section-heading"><div><h2>Company & product catalog</h2><p>Public website information is a starting point for your review.</p></div><a className="text-button" href={business.website} target="_blank" rel="noreferrer">Open source website<ExternalLink size={13} /></a></div>
            <Field id="business-name" label="Business name" value={state.company.name} onChange={v => update('company', 'name', v)} />
            <Field id="business-website" label="Company website" value={state.company.website} onChange={v => update('company', 'website', v)} type="url" />
            <Field id="business-description" label="Products & applications" value={state.company.description} onChange={v => update('company', 'description', v)} multiline help="Describe the products and the application. Do not add unverified compatibility or performance claims." />
            <div className="catalog-section"><div className="catalog-heading"><div><h3>Product families in scope</h3><p>Choose what this business should pursue in the next module.</p></div><span>{state.productFamilies.length} selected</span></div><div className="family-grid">{business.families.map(([id, name, description]) => <label className={`family-card ${state.productFamilies.includes(id) ? 'checked' : ''}`} key={id}><input type="checkbox" aria-label={`Include ${name}`} checked={state.productFamilies.includes(id)} onChange={() => toggleFamily(id)} /><div><strong>{name}</strong><span>{description}</span></div></label>)}</div></div>
            <div className="source-strip"><BookOpen size={16} /><span>Catalog statements are labeled as website evidence. Confirm exact specifications with this business before quoting.</span><a href={business.website} target="_blank" rel="noreferrer">Source<ExternalLink size={12} /></a></div>
          </>}
          {tab === 1 && <>
            <div className="section-heading"><div><h2>Manufacturing & supply capabilities</h2><p>Record what is known, what the website states, and what still needs review.</p></div><span className="pill">{reviewedCount}/{business.capabilities.length} reviewed</span></div>
            <div className="capability-intro"><ShieldCheck size={17} /><p>Blank fields mean <strong>unknown</strong>. Editing a value returns it to “Unconfirmed.” Internal review records your assessment; each customer application still needs engineering approval.</p></div>
            <div className="capability-fields">{business.capabilities.map(([key, label, help]) => {
              const c = state.capabilities[key];
              const evidenceUrl = business.id === 'huasheng' && key === 'inspection' ? 'https://www.hscastings.com/quality/' : business.capabilitySource;
              return <div className="capability-field" key={key}><label htmlFor={`cap-${key}`}>{label}</label><textarea id={`cap-${key}`} rows={2} value={c.value} onChange={e => setCapability(key, 'value', e.target.value)} placeholder="Not confirmed — enter a value and its units when known" maxLength={1500} /><div className="capability-meta"><small>{help}</small><select aria-label={`Evidence status for ${label}`} value={c.status} disabled={!c.value.trim()} onChange={e => setCapability(key, 'status', e.target.value)}><option value="unknown">Unconfirmed</option><option value="website">Website-stated</option><option value="reviewed">Internally reviewed</option></select></div>{c.status === 'website' && <a href={evidenceUrl} target="_blank" rel="noreferrer" className="evidence-link"><BookOpen size={12} />Public source · verification pending<ExternalLink size={11} /></a>}</div>;
            })}</div>
            <div className="form-divider" /><div className="section-heading"><div><h2>Commercial & qualification notes</h2><p>These are quote inputs, rather than commitments to a prospect.</p></div></div>
            <Field id="certification" label="Certificates, scope & expiry" value={state.commercial.certification} onChange={v => update('commercial', 'certification', v)} multiline help="Record the current certificate and evidence reference when available. A website statement does not establish current certification." />
            <div className="field-grid"><Field id="lead-time" label="Typical production lead time" value={state.commercial.leadTime} onChange={v => update('commercial', 'leadTime', v)} placeholder="Not confirmed" /><Field id="minimum-order" label="Minimum order / typical quantity" value={state.commercial.minimumOrder} onChange={v => update('commercial', 'minimumOrder', v)} placeholder="Not confirmed" /></div>
            <Field id="delivery-terms" label="Delivery regions & shipping terms" value={state.commercial.deliveryTerms} onChange={v => update('commercial', 'deliveryTerms', v)} placeholder="Confirm available destinations, freight basis, and terms" />
            <Field id="quote-basis" label="Quotation basis" value={state.commercial.quoteBasis} onChange={v => update('commercial', 'quoteBasis', v)} />
            <div className="form-divider"/><div className="section-heading"><div><h2>Internal commercial plan</h2><p>Owner-supplied planning inputs. Customer quotations require separate review.</p></div></div>
            {commercialPlanningFields.map(({key,label,help})=><Field key={key} id={'commercial-'+key} label={label} value={state.commercial[key]||''} onChange={v=>update('commercial',key,v)} maxLength={600} placeholder="Not supplied" help={help}/>)}
          </>}
          {tab === 2 && <>
            <div className="section-heading"><div><h2>Ideal customer profile</h2><p>Choose the commercial direction for this business’s prospect research.</p></div><span className="pill blue">Proposed · editable</span></div>
            <Field id="target-industries" label="Target industries & applications" value={state.icp.industries} onChange={v => update('icp', 'industries', v)} multiline />
            <Field id="target-regions" label="Target countries or regions" value={state.icp.regions} onChange={v => update('icp', 'regions', v)} placeholder="Choose the countries or regions this business should pursue" help="No territory is selected from a website’s export claims. Define your intended sales market." />
            <Field id="target-naics" label="NAICS / SIC targets" value={state.icp.naics || ''} onChange={v => update('icp', 'naics', v)} placeholder="Not supplied — confirm codes for the intended application" />
            <div className="field-grid"><Field id="target-headcount" label="Target employee range" value={state.icp.headcount || ''} onChange={v => update('icp', 'headcount', v)} placeholder="Unknown / no size restriction yet" /><Field id="target-revenue" label="Target revenue range & currency" value={state.icp.revenue || ''} onChange={v => update('icp', 'revenue', v)} placeholder="Unknown / no revenue restriction yet" /></div>
            <Field id="target-triggers" label="Buying signals to research" value={state.icp.triggers || ''} onChange={v => update('icp', 'triggers', v)} placeholder="For example: new model launch or supplier qualification opening" help="These define research questions. A matching signal must have a dated source before it is treated as purchase evidence." />
            <Field id="reference-wins" label="Existing customers & reference wins" value={state.icp.referenceWins || ''} onChange={v => update('icp', 'referenceWins', v)} multiline placeholder="Not supplied — add only approved referenceable customer evidence" />
            <fieldset className="choice-fieldset"><legend>Buyer segments</legend><p>Select the organizations you want to approach.</p><div className="choice-chips">{business.segments.map(segment => <label key={segment} className={state.icp.segments.includes(segment) ? 'selected' : ''}><input type="checkbox" aria-label={`Target ${segment}`} checked={state.icp.segments.includes(segment)} onChange={() => toggle('icp', 'segments', segment)} />{segment}</label>)}</div></fieldset>
            <fieldset className="choice-fieldset"><legend>Buyer roles</legend><p>Suggested roles are preselected for your review.</p><div className="choice-chips">{business.roles.map(role => <label key={role} className={state.icp.roles.includes(role) ? 'selected' : ''}><input type="checkbox" aria-label={`Contact ${role}`} checked={state.icp.roles.includes(role)} onChange={() => toggle('icp', 'roles', role)} />{role}</label>)}</div></fieldset>
            {personaFields.map(({key,label,help})=><Field key={key} id={'persona-'+key} label={label} value={state.icp[key]||''} maxLength={600} onChange={v=>update('icp',key,v)} help={help} placeholder="Not supplied"/>)}
            <div className="field"><label htmlFor="sales-motion">Primary sales motion</label><select id="sales-motion" value={state.icp.motion} onChange={e => update('icp', 'motion', e.target.value)}><option value="">Select a sales motion</option><option value="replacement">Replacement / maintenance (MRO)</option><option value="oem">New equipment / OEM supply</option><option value="channel">Distributor / channel development</option></select><small>This will shape discovery signals, qualification questions, and the first outreach.</small></div>
            <Field id="exclusions" label="Exclusions & qualification boundaries" value={state.icp.exclusions} onChange={v => update('icp', 'exclusions', v)} multiline />
            <Field id="excluded-domains" label="Exclude company domains" value={state.icp.excludedDomains || ''} onChange={v => update('icp', 'excludedDomains', v)} placeholder="example.com, another-company.com" help="Exact domain exclusions are enforced during research. Narrative qualification boundaries remain review questions." />
            <div className="form-divider" /><div className="section-heading"><div><h2>Adjacent segments to consider</h2><p>Catalog-linked research hypotheses. Accept, adjust or dismiss each one, then approve the profile before using it as an optional search target.</p></div></div>
            <ExpansionSuggestions business={business} state={state} change={change} busy={busy}/>
            <div className="approval-check"><label><input type="checkbox" aria-label="Confirm customer profile review" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} /><span>I reviewed this business’s target products, territories, and buyer profile. Approval authorizes prospect research; compatibility, pricing, and delivery still require review.</span></label></div>
          </>}
        </div>
        <div className="profile-form-footer"><button className="text-button" disabled={tab === 0} onClick={() => setTab(t => Math.max(0, t - 1))}><ChevronLeft size={15} />Previous</button><span>Section {tab + 1} of 3</span>{tab < 2 ? <button className="button primary" onClick={() => setTab(t => t + 1)}>Continue to {tab === 0 ? 'capabilities' : 'ideal customers'}<ArrowRight size={15} /></button> : <button className="button primary" disabled={missing.length > 0 || !acknowledged} onClick={() => approve(acknowledged)}><ShieldCheck size={15} />Approve for prospect research</button>}</div>
      </section>
      <aside className="research-sidebar"><section className="panel research-brief"><span className={`icon-box ${business.color}`}><Target size={21} /></span><h2>Research brief</h2><p>The context passed to Discovery.</p><dl><div><dt>Business</dt><dd>{state.company.name || business.name}</dd></div><div><dt>Products in scope</dt><dd>{productNames.length ? productNames.join(', ') : 'Choose a product family'}</dd></div><div><dt>Target markets</dt><dd>{state.icp.regions || 'Not selected'}</dd></div><div><dt>Buyer segments</dt><dd>{state.icp.segments.join(', ') || 'Not selected'}</dd></div><div><dt>Sales motion</dt><dd>{{ replacement: 'Replacement / maintenance', oem: 'New equipment / OEM', channel: 'Distributor / channel' }[state.icp.motion] || 'Not selected'}</dd></div><div><dt>Capabilities internally reviewed</dt><dd>{reviewedCount} of {business.capabilities.length}</dd></div></dl><button className="text-button" onClick={exportBrief}>Download this brief<Download size={14} /></button></section>
        <section className={`readiness-panel ${missing.length ? '' : 'ready'}`}><div><FileCheck2 size={18} /><h3>{missing.length ? `${missing.length} items before research approval` : 'Ready for your review'}</h3></div>{missing.length ? <ul>{missing.map(item => <li key={item}>{item}</li>)}</ul> : <p>Review the Ideal customers section and confirm before approving.</p>}</section>
        <ConfidencePanel state={state} />
        <div className="notice industrial-note"><ShieldCheck size={18} /><span><strong>Technical qualification stays separate.</strong> Discovery may identify a possible application. An engineer must confirm the part, drawing revision, material, and operating conditions before a quote or compatibility claim.</span></div>
        {state.approved && <button className="button primary" onClick={() => go('discovery')}>Open account research<ArrowRight size={16} /></button>}
      </aside>
    </div>
  </>;
}
