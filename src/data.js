export const modules = [
  { id: 'product', number: '01', title: 'Product & ICP', short: 'Product & ICP', icon: 'target', color: 'blue', description: 'Turn product context into a clear picture of your ideal buyer.', input: 'Product, pricing & customer context', output: 'Approved customer profile' },
  { id: 'discovery', number: '02', title: 'Customer & competitor discovery', short: 'Accounts', icon: 'search', color: 'teal', description: 'Find the right accounts, buyers, and competitive opportunities.', input: 'Approved customer profile', output: 'Shortlisted accounts & buyers' },
  { id: 'graph', number: '03', title: 'Knowledge graph', short: 'Knowledge graph', icon: 'network', color: 'violet', description: 'Connect people, companies, and the signals that matter.', input: 'Accounts, people & public signals', output: 'Relationship & buying context' },
  { id: 'outreach', number: '04', title: 'HITL review & outreach', short: 'HITL review', icon: 'mail', color: 'orange', description: 'Review and approve the exact message before outreach can proceed.', input: 'Buyer context & contact details', output: 'Human-approved outreach' },
  { id: 'pipeline', number: '05', title: 'Lead management & dashboard', short: 'Pipeline', icon: 'kanban', color: 'green', description: 'Follow every lead and use the results to improve your next move.', input: 'Outreach & lead activity', output: 'Pipeline progress & feedback' },
];

// Fictional demonstration records. No live research or verification is implied.
export const accounts = [
  { id: 'luma', name: 'Lumastack', initials: 'Lu', tint: 'violet', sector: 'Developer tools', size: '120 employees', person: 'Maya Chen', role: 'Head of Customer Experience', signal: 'Expanding the customer support team', fit: 96, email: 'maya@lumastack.example', location: 'San Francisco, US', reason: 'A growing B2B software team with a dedicated customer experience leader.', source: 'Sample careers page', competitor: 'Queuewise' },
  { id: 'north', name: 'Northline', initials: 'N', tint: 'blue', sector: 'Fintech', size: '240 employees', person: 'James Wilson', role: 'VP of Customer Success', signal: 'Announced a new enterprise offering', fit: 92, email: 'james@northline.example', location: 'New York, US', reason: 'Enterprise expansion creates a potential need for scalable customer support.', source: 'Sample company announcement', competitor: 'HelpPilot' },
  { id: 'way', name: 'Waypoint', initials: 'W', tint: 'teal', sector: 'Business software', size: '85 employees', person: 'Sofia Patel', role: 'Director of Support', signal: 'Hired a new support leader', fit: 89, email: 'sofia@waypoint.example', location: 'Toronto, CA', reason: 'A new support leader at a company within the target size range.', source: 'Sample leadership update', competitor: 'Queuewise' },
  { id: 'bright', name: 'Brightlane', initials: 'B', tint: 'orange', sector: 'Marketing software', size: '175 employees', person: 'Alex Rivera', role: 'Head of Operations', signal: 'Hiring customer operations specialists', fit: 87, email: 'alex@brightlane.example', location: 'Austin, US', reason: 'Customer operations hiring suggests investment in support workflows.', source: 'Sample job listing', competitor: 'HelpPilot' },
  { id: 'field', name: 'Fieldwork', initials: 'F', tint: 'green', sector: 'Productivity software', size: '65 employees', person: 'Jordan Lee', role: 'Customer Experience Lead', signal: 'Launched a team subscription', fit: 84, email: 'jordan@fieldwork.example', location: 'Vancouver, CA', reason: 'A small B2B team expanding its subscription offering.', source: 'Sample product launch', competitor: 'Internal tooling' },
  { id: 'atlas', name: 'Atlasworks', initials: 'A', tint: 'rose', sector: 'Data infrastructure', size: '320 employees', person: 'Sam Taylor', role: 'Director of Customer Success', signal: 'Opened a second regional office', fit: 81, email: 'sam@atlasworks.example', location: 'Boston, US', reason: 'Regional growth may increase the coordination needs of its support team.', source: 'Sample expansion announcement', competitor: 'Internal tooling' },
];

export const stages = ['Matched', 'Contacted', 'Replied', 'Meeting booked', 'Closed won', 'Closed lost'];
export const emptyState = () => ({
  version: 1,
  profile: {
    name: 'SignalDesk',
    description: 'An AI support workspace that helps B2B software teams triage incoming tickets, draft helpful replies, and spot recurring customer issues.',
    pricing: '$299 / month',
    industry: 'B2B software & SaaS',
    size: '50–500 employees',
    region: 'United States & Canada',
    roles: 'Head of Support, VP of Customer Success',
  },
  approved: false, discovered: false, selected: [], graphReady: false,
  drafts: {}, approvals: {}, sent: {}, pipeline: {},
  activity: [{ id: 'welcome', title: 'Demo workspace ready', detail: 'Start with your product, or explore a sample campaign.', actor: 'Workspace', at: new Date().toISOString() }],
});

export function messageFor(account, profile, channel) {
  if (channel === 'linkedin') return `Hi ${account.person.split(' ')[0]}, I noticed ${account.name} is growing its customer operations. I’m working on ${profile.name}, which helps support teams triage tickets and draft replies. Would it be useful to compare notes on your support workflow?`;
  return `Hi ${account.person.split(' ')[0]},\n\nI noticed this update from ${account.name}: ${account.signal.charAt(0).toLowerCase() + account.signal.slice(1)}. That can be a good moment to rethink how the support team handles incoming requests.\n\n${profile.name} helps B2B software teams triage tickets, draft replies, and surface recurring customer issues in one workspace.\n\nWould you be open to a short conversation about how your team handles support today?\n\nBest,\nThe ${profile.name} team`;
}
