// Research starting points reviewed against primary company pages on 2026-10-30.
// Product relevance is a hypothesis; no purchasing intent or supplier approval is implied.
export const researchCatalog = [
  {
    id: 'elliott', name: 'Elliott Equipment Company', domain: 'elliottequip.com', country: 'United States', location: 'Omaha, Nebraska', industry: 'Mobile equipment', tier: 'OEM',
    application: 'Truck-mounted aerial work platforms, cranes, and digger derricks',
    reason: 'Mobile lifting equipment is a potential application for custom hydraulic cylinders. Fit requires a drawing and engineering review.',
    businesses: ['allco'], productFamily: 'custom',
    source: 'https://elliottequip.com/', contactSource: 'https://elliottequip.com/contact/', publicEmail: 'sales@elliottequip.com',
    facts: ['The company lists aerial work platforms, cranes, and digger derricks.', 'Its contact page lists an Omaha, Nebraska address.'],
    signal: { title: 'Operations and product leadership appointments', kind: 'Leadership', intent: 'Research signal, not a confirmed buying cycle', source: 'https://elliottequip.com/press-release-andrew-schumacher-vice-president-nebraska-operations-chad-barrett-director-product-management/' },
    people: [{ name: 'Andrew Schumacher', role: 'Vice President of Nebraska Operations', relevance: 'Oversees production, quality, safety, and engineering; purchasing responsibility is not confirmed.', source: 'https://elliottequip.com/press-release-andrew-schumacher-vice-president-nebraska-operations-chad-barrett-director-product-management/', previousCompany: 'Wayne Combustion Systems' }],
  },
  {
    id: 'linkbelt', name: 'Link-Belt Cranes', domain: 'linkbelt.com', country: 'United States', location: 'Lexington, Kentucky', industry: 'Construction equipment', tier: 'OEM',
    application: 'Telescopic boom and lattice boom cranes',
    reason: 'Crane applications may require hydraulic actuation. Exact cylinder requirements and vendor qualification are unknown.',
    businesses: ['allco'], productFamily: 'custom',
    source: 'https://www.linkbelt.com/about-/', contactSource: 'https://www.linkbelt.com/about/executive-team/', publicEmail: 'inquiry@linkbelt.com',
    facts: ['The company describes crane design and manufacturing.', 'Its headquarters and manufacturing facility are in Lexington, Kentucky.'],
    signal: { title: 'US crane manufacturing footprint', kind: 'Application', intent: 'Product relevance only; no new RFQ verified', source: 'https://www.linkbelt.com/about-/' },
    people: [{ name: 'Gene Martin', role: 'Vice President - Engineering', relevance: 'Engineering leadership is published; sourcing authority and direct email remain unverified.', source: 'https://www.linkbelt.com/about/executive-team/' }],
  },
  {
    id: 'superior', name: 'Superior Industries', domain: 'superior-ind.com', country: 'United States', location: 'Morris, Minnesota', industry: 'Aggregate processing equipment', tier: 'OEM',
    application: 'Patriot cone crushers and bulk material processing equipment',
    reason: 'The Patriot product page describes hydraulic cylinders and cast components. This supports potential product relevance, not interchangeability.',
    businesses: ['allco', 'huasheng'], productFamily: 'crusher',
    source: 'https://superior-ind.com/products/patriot', contactSource: 'https://superior-ind.com/', publicEmail: null,
    facts: ['The Patriot product page describes hydraulic cylinders.', 'The product includes a cast mainframe and replaceable liners.'],
    signal: { title: 'Hydraulic and wear-component application documented', kind: 'Application', intent: 'No supplier opening or purchasing deadline verified', source: 'https://superior-ind.com/products/patriot' },
    people: [],
  },
  {
    id: 'altec', name: 'Altec Industries', domain: 'altec.com', country: 'United States', location: 'Birmingham, Alabama', industry: 'Utility equipment', tier: 'OEM',
    application: 'Aerial devices, digger derricks, and boom truck cranes',
    reason: 'The equipment portfolio suggests hydraulic applications. Supplier access, requirements, and buying intent need qualification.',
    businesses: ['allco'], productFamily: 'custom',
    source: 'https://www.altec.com/about-altec', contactSource: 'https://www.altec.com/about-altec/contact-us', publicEmail: null,
    facts: ['Altec lists aerial devices, cranes, and digger derricks.', 'Its contact page lists a Birmingham, Alabama address and contact form.'],
    signal: { title: 'Relevant utility equipment portfolio', kind: 'Application', intent: 'An application match is not a purchase signal', source: 'https://www.altec.com/about-altec' },
    people: [],
  },
  {
    id: 'mclanahan', name: 'McLanahan', domain: 'mclanahan.com', country: 'United States', location: 'US manufacturing footprint; confirm site', industry: 'Mineral processing equipment', tier: 'OEM',
    application: 'Crushing, processing, and material handling equipment',
    reason: 'A research starting point for wear-part applications. Specific equipment, drawings, materials, and purchasing need verification.',
    businesses: ['huasheng'], productFamily: 'cone', source: 'https://www.mclanahan.com/', contactSource: 'https://www.mclanahan.com/contact-us', publicEmail: null,
    facts: ['The company offers mineral processing equipment.'],
    signal: { title: 'Mineral processing equipment portfolio', kind: 'Application', intent: 'Needs current source review before qualification', source: 'https://www.mclanahan.com/' }, people: [],
  },
];

export const competitors = {
  allco: [
    { id: 'parker', name: 'Parker Hannifin', category: 'Direct', focus: 'Hydraulic cylinder products and application engineering', source: 'https://discover.parker.com/hydraulic-cylinder-specification', pricing: 'Public price not established; quotation needed', angle: 'Compare only documented specifications, support, lead times, and qualification requirements.' },
    { id: 'rexroth', name: 'Bosch Rexroth', category: 'Direct', focus: 'Industrial and mobile hydraulic products', source: 'https://www.boschrexroth.com/', pricing: 'Public price not established; quotation needed', angle: 'Collect an approved capability comparison before making claims.' },
    { id: 'repair', name: 'Repair or rebuild existing cylinders', category: 'Alternative', focus: 'An alternative buying approach, not a named supplier', source: null, pricing: 'Case-specific', angle: 'Ask whether the opportunity is a new design, replacement, or rebuild.' },
  ],
  huasheng: [
    { id: 'metso', name: 'Metso', category: 'Direct / OEM ecosystem', focus: 'Crushing equipment and wear parts', source: 'https://www.metso.com/', pricing: 'Quotation needed', angle: 'Do not imply OEM approval or equivalent performance without evidence.' },
    { id: 'existing', name: 'Existing approved foundry', category: 'Alternative', focus: 'An incumbent relationship; identify it during qualification', source: null, pricing: 'Unknown', angle: 'Understand qualification cost, tooling ownership, and the reason to change suppliers.' },
  ],
};

export const pipelineStages = ['Matched', 'Contacted', 'Replied', 'Meeting booked', 'RFQ received', 'Engineering review', 'Quote sent', 'Trial / qualification', 'Closed won', 'Closed lost'];
export const costs = { discovery: 2, enrichment: 5, graph_query: 1, outreach: 1, inference: 2, market_signals: 2, people_research: 2 };
