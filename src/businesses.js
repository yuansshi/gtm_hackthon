// Public website statements are starting evidence, not verified manufacturing limits.
import {commercialPlanningFields} from './commercial-planning.js';
import {productIntakeFields,capabilityIntakeKey} from './product-intake.js';
import {personaFields} from './buyer-persona.js';
export const businesses = [
  {
    id: 'huasheng', name: 'Huasheng Castings', initials: 'HS', color: 'blue',
    website: 'https://www.hscastings.com/products/',
    tagline: 'Wear-resistant steel castings',
    description: 'Crusher wear parts, mill liners, and related wear-resistant castings. The website emphasizes high-manganese steel and application-specific products.',
    sourceLabel: 'Product catalog',
    capabilitySource: 'https://www.hscastings.com/about-us/',
    sources: ['https://www.hscastings.com/products/', 'https://www.hscastings.com/about-us/', 'https://www.hscastings.com/quality/'],
    families: [
      ['cone', 'Cone crusher wear parts', 'Mantles, bowl liners, and related wear components'],
      ['jaw', 'Jaw crusher parts', 'Replacement wear parts for jaw crushers'],
      ['gyratory', 'Gyratory crusher wear parts', 'Wear components for gyratory crushing applications'],
      ['impact', 'Impact crusher wear parts', 'Impact plates and related wear components'],
      ['mill', 'Mill liners', 'Vertical mill and ball mill liners'],
      ['shredder', 'Shredder & other wear parts', 'Metal crusher and other catalog castings'],
    ],
    capabilities: [
      ['materials', 'Material grades', 'Exact grades, specifications, and supported heat treatments', 'High-manganese steel; exact grades require confirmation', 'website'],
      ['weight', 'Maximum single casting weight', 'Include units and confirm the selected family’s limit', '30 tonnes listed at company level; applicability to this product needs confirmation', 'website'],
      ['dimensions', 'Maximum dimensions & machining', 'Dimensions, machining envelope, tolerances, and units', '', 'unknown'],
      ['inspection', 'Inspection & material documentation', 'Testing methods, acceptance criteria, and batch certificates', 'Website lists ultrasonic, dimensional, and material analysis capabilities; scope needs confirmation', 'website'],
      ['tooling', 'Patterns, tooling & drawing requirements', 'What is required before feasibility review or quotation?', '', 'unknown'],
    ],
    certification: 'Website lists ISO 9001. Current certificate, scope, and expiry are not confirmed.',
    industries: 'Mining, quarrying, aggregates, mineral processing',
    roles: ['Procurement', 'Maintenance / reliability', 'Engineering', 'Supplier quality'],
    segments: ['Mine / quarry operator', 'Equipment manufacturer (OEM)', 'Parts distributor', 'Service / repair business'],
    expansions: [
      { id: 'recycling', name: 'Metal recycling & shredding', reason: 'The catalog includes metal crusher wear parts. Confirm the product family and materials before pursuing this segment.', source: 'https://www.hscastings.com/products/' },
      { id: 'milling', name: 'Industrial milling operators', reason: 'The catalog lists vertical and ball mill liners. Confirm the equipment and working conditions before expanding.', source: 'https://www.hscastings.com/products/' },
    ],
  },
  {
    id: 'allco', name: 'Allco Hydraulic', initials: 'AH', color: 'teal',
    // User-selected territory for Allco's first campaign, October 30, 2026.
    defaultRegions: 'United States',
    defaultSegments: ['Equipment manufacturer (OEM)'],
    defaultMotion: 'oem',
    defaultRoles: ['Procurement', 'Design engineering', 'Supplier quality'],
    website: 'https://www.allcohydraulic.com/',
    tagline: 'Customized hydraulic cylinders',
    description: 'Customized hydraulic cylinder products for construction, mining, material handling, and other applications. Exact dimensions and performance limits need supplier confirmation.',
    sourceLabel: 'Company & market overview',
    capabilitySource: 'https://www.allcohydraulic.com/construction-mining',
    sources: ['https://www.allcohydraulic.com/', 'https://www.allcohydraulic.com/construction-mining', 'https://www.allcohydraulic.com/material-handling'],
    families: [
      ['truck', 'Mining truck cylinders', 'Steering, hoist, and suspension applications'],
      ['excavator', 'Excavator cylinders', 'Walking and bucket-wheel excavator applications'],
      ['crusher', 'Crusher cylinders', 'Cone crusher tramp cylinder applications'],
      ['handling', 'Material-handling cylinders', 'Forklift cylinders, including sensor-equipped examples'],
      ['custom', 'Other custom cylinder applications', 'Requires a drawing, application, and feasibility review'],
    ],
    capabilities: [
      ['bore', 'Bore & rod diameter range', 'Minimum / maximum values and units (mm or inches)', '', 'unknown'],
      ['stroke', 'Stroke & overall dimensions', 'Stroke limits, closed / open length, and units', '', 'unknown'],
      ['pressure', 'Rated working pressure', 'Pressure range, units, and application conditions', '', 'unknown'],
      ['mounting', 'Mounting & connection options', 'Mounting geometry, rod ends, ports, and sensors', '', 'unknown'],
      ['compatibility', 'Materials, seals & operating conditions', 'Fluid, seals, temperature, corrosion protection, and duty cycle', 'Website describes alloy steel, plated rods, and several seal materials; exact combinations need engineering confirmation', 'website'],
      ['testing', 'Testing & acceptance documentation', 'Required pressure / leakage tests and acceptance criteria', '', 'unknown'],
    ],
    certification: 'Website references ISO 9001:2008. Current certificate, scope, and expiry are not confirmed.',
    industries: 'Construction and mining equipment, material handling',
    roles: ['Procurement', 'Design engineering', 'Maintenance / service', 'Supplier quality'],
    segments: ['Equipment manufacturer (OEM)', 'Hydraulic system integrator', 'Cylinder distributor', 'Service / repair business', 'Equipment operator'],
    expansions: [
      { id: 'forklifts', name: 'Forklift & material-handling manufacturers', reason: 'The website shows a forklift cylinder with sensors. Confirm the requested specification and manufacturing range.', source: 'https://www.allcohydraulic.com/material-handling' },
      { id: 'crusher-service', name: 'Crusher manufacturers & service companies', reason: 'The construction/mining page lists cone crusher tramp cylinders. Equipment compatibility requires technical review.', source: 'https://www.allcohydraulic.com/construction-mining' },
    ],
  },
];

export const businessById = id => businesses.find(b => b.id === id) || businesses[0];
export const businessStorageKey = id => `gtm-engine-industrial-v1:${id}`;
export const activeBusinessKey = 'gtm-engine-active-business-v1';

export function initialBusinessState(id) {
  const b = businessById(id);
  return {
    version: 1, businessId: b.id,
    company: { name: b.name, website: b.website, description: b.description },
    productFamilies: b.families.map(([key]) => key),
    capabilities: Object.fromEntries(b.capabilities.map(([key, , , value, status]) => [key, { value, status }])),
    commercial: { certification: b.certification, leadTime: '', minimumOrder: '', deliveryTerms: '', quoteBasis: 'Quoted per RFQ after technical review' },
    icp: { industries: b.industries, regions: b.defaultRegions || '', segments: [...(b.defaultSegments || [])], roles: [...(b.defaultRoles || b.roles)], motion: b.defaultMotion || '', exclusions: 'Requirements outside internally reviewed capabilities; incompatible application or equipment specifications.', naics: '', headcount: '', revenue: '', triggers: '', referenceWins: '', excludedDomains: '' },
    expansionDecisions: {}, approved: false, approvedAt: null,
    // Downstream state belongs to this business, ready for modules 2–5.
    campaigns: [], contacts: [], opportunities: [], outreachApprovals: [],
    activity: [{ id: 'created', title: `${b.name} workspace ready`, detail: 'Review the website-based starting profile before approving prospect research.', at: new Date().toISOString(), actor: 'Workspace' }],
  };
}

export function missingResearchFields(state) {
  const missing = [];
  if (!state.company.name.trim()) missing.push('Business name');
  if (!state.company.description.trim()) missing.push('Product description');
  try {
    const website = new URL(state.company.website);
    if (!['https:', 'http:'].includes(website.protocol)) missing.push('Valid company website');
  } catch { missing.push('Valid company website'); }
  if (!state.productFamilies.length) missing.push('At least one product family');
  if (!state.icp.industries.trim()) missing.push('Target industries or applications');
  if (!state.icp.regions.trim()) missing.push('Target countries or regions');
  if (!state.icp.segments.length) missing.push('At least one buyer segment');
  if (!state.icp.roles.length) missing.push('At least one buyer role');
  if (!state.icp.motion) missing.push('Sales motion');
  return missing;
}

export function createResearchBrief(state) {
  const b = businessById(state.businessId);
  return {
    schemaVersion: 1, businessId: b.id, company: state.company,
    researchApproved: state.approved, approvedAt: state.approvedAt,
    technicalQualification: 'Requires engineering review for each opportunity',
    productFamilies: b.families.filter(([key]) => state.productFamilies.includes(key)).map(([id, name]) => ({ id, name })),
    capabilities: state.capabilities, commercial: state.commercial, idealCustomerProfile: state.icp,
    acceptedExpansionSegments: b.expansions.filter(e => state.expansionDecisions[e.id] === 'accepted'),
    fieldConfidence: profileConfidence(state),
    sources: b.sources,
    caveat: 'Website-stated capabilities are unverified. Blank values are unknown. Research approval does not approve compatibility, pricing, or delivery promises.',
  };
}

// Visible rule-based evidence coverage, not a calibrated model probability.
export function profileConfidence(state) {
  const known = value => !!(Array.isArray(value) ? value.length : String(value || '').trim());
  return [
    ['industries', state.icp.industries, 'Catalog application hypothesis'],
    ['regions', state.icp.regions, 'Campaign owner input'],
    ['segments', state.icp.segments, 'Campaign owner input'],
    ['roles', state.icp.roles, 'Role hypothesis; buying authority unverified'],
    ...personaFields.map(({key,label})=>[key,state.icp[key],'Owner-defined persona target; current role and authority unverified',label]),
    ['naics', state.icp.naics, 'Owner-provided classification; verify each company'],
    ['headcount', state.icp.headcount, 'Owner-defined target; account size unverified'],
    ['revenue', state.icp.revenue, 'Owner-defined target; account revenue unverified'],
    ['triggers', state.icp.triggers, 'Owner-defined research signal'],
    ...commercialPlanningFields.map(({key,label})=>['commercial.'+key,state.commercial?.[key],'Owner-supplied internal plan; not a quote',label]),
    ...productIntakeFields(businessById(state.businessId)).map(({field,label})=>{
      const key=capabilityIntakeKey(field),capability=key?state.capabilities?.[key]:null;
      const basis=!key?'Product statement; supplier verification required':capability?.status==='reviewed'?'Internally reviewed; application qualification separate':capability?.status==='website'?'Website statement; supplier verification required':'Owner-supplied technical statement; qualification unverified';
      return[field,key?capability?.value:state.company?.description,basis,label];
    }),
  ].map(([field, value, basis,label]) => {
    const provenance = state.assistantFieldProvenance?.[field];
    if (provenance && JSON.stringify(provenance.value) === JSON.stringify(value)) return { field, ...(label?{label}:{}), value, confidence: provenance.confidence, basis: { user_input: 'Campaign owner input', catalog_hypothesis: 'Catalog hypothesis, reviewed as a target' }[provenance.basis] || provenance.basis, evidence: provenance.evidence, method: provenance.method, runId: provenance.runId, reviewedAt: provenance.reviewedAt };
    return { field, ...(label?{label}:{}), value, confidence: known(value) ? (['regions', 'segments'].includes(field) ? 1 : 0.5) : 0, basis: known(value) ? basis : 'Unknown / not supplied', method: 'Evidence coverage heuristic; not calibrated confidence' };
  });
}
