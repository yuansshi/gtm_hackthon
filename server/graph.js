import kuzu from 'kuzu';
import path from 'node:path';
import { signalFresh, signalHold } from '../src/market-signals.js';
import { companyHoldReasons } from '../src/company-evidence.js';
import { projectedPeople, personDateFresh } from '../src/people-evidence.js';

const labels = ['Company', 'Person', 'Product', 'Competitor', 'Signal'];
const relationships = {
  matched_to: ['Company', 'Product'], works_at: ['Person', 'Company'], signal_for: ['Signal', 'Company'],
  competes_with: ['Product', 'Competitor'], previously_employed_at: ['Person', 'Company'],
  contacted_via: ['Company', 'Signal'], replied_to: ['Person', 'Signal'],
};

export async function createGraph(directory) {
  const db = new kuzu.Database(path.join(directory, 'knowledge.kuzu'), 256 * 1024 * 1024);
  const connection = new kuzu.Connection(db, 2);
  let queue = Promise.resolve();
  const query = async (cypher, parameters = {}) => {
    const statement = await connection.prepare(cypher);
    const result = await connection.execute(statement, parameters);
    try { return await result.getAll(); }
    finally { result.close(); }
  };
  for (const label of labels) await query(`CREATE NODE TABLE IF NOT EXISTS ${label}(id STRING PRIMARY KEY, businessId STRING, name STRING, data STRING)`);
  for (const [type, [from, to]] of Object.entries(relationships)) await query(`CREATE REL TABLE IF NOT EXISTS ${type}(FROM ${from} TO ${to}, businessId STRING, evidence STRING)`);
  const serial = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  const node = async (label, id, name, businessId, data) => query(`MERGE (n:${label} {id:$id}) SET n.name=$name,n.businessId=$businessId,n.data=$data`, { id, name, businessId, data: JSON.stringify(data) });
  const edge = async (type, fromId, toId, businessId, evidence = '') => {
    const [from, to] = relationships[type];
    await query(`MATCH (a:${from}),(b:${to}) WHERE a.id=$fromId AND b.id=$toId AND a.businessId=$businessId AND b.businessId=$businessId MERGE (a)-[r:${type}]->(b) SET r.businessId=$businessId,r.evidence=$evidence`, { fromId, toId, businessId, evidence });
  };
  async function sync(state, competitors) {
    return serial(async () => {
      const businessId = state.businessId; const prefix = `${businessId}:`;
      await query('BEGIN TRANSACTION');
      try {
        for (const label of labels) await query(`MATCH(n:${label}) WHERE n.businessId=$businessId DETACH DELETE n`, { businessId });
        await node('Product', prefix + 'product', state.businessId === 'allco' ? 'Custom hydraulic cylinders' : 'Wear-resistant castings', businessId, { businessName: state.company.name, families: state.productFamilies, description: state.company.description, source: state.company.website });
        for (const c of competitors) {
          await node('Competitor', prefix + 'competitor:' + c.id, c.name, businessId, c);
          await edge('competes_with', prefix + 'product', prefix + 'competitor:' + c.id, businessId, c.source || 'Alternative approach; hypothesis');
        }
        for (const lead of state.leads) await node('Company', prefix + 'company:' + lead.id, lead.name, businessId, { leadId: lead.id, domain: lead.domain, industry: lead.industry, location: lead.location, source: lead.source, evidenceStatus: lead.evidenceStatus, excludedReason: lead.excludedReason || null, companyProfile:lead.companyProfile?.status==='reviewed'?lead.companyProfile:null });
        for (const lead of state.leads) {
          const companyId = prefix + 'company:' + lead.id;
          if (!lead.excludedReason && !signalHold(lead) && !companyHoldReasons(lead,state).length) await edge('matched_to', companyId, prefix + 'product', businessId, lead.source);
          await node('Signal', prefix + 'signal:' + lead.id, lead.signal.title, businessId, lead.signal);
          await edge('signal_for', prefix + 'signal:' + lead.id, companyId, businessId, lead.signal.source);
          for(const signal of (lead.marketSignals||[]).filter(signal=>signal.acceptedAt&&['accepted','needs_review'].includes(signal.status))){
            const signalId=prefix+'market-signal:'+signal.id;
            await node('Signal',signalId,signal.title,businessId,{...signal,provenance:'owner_reviewed_market_signal',freshContext:signalFresh(signal),purchaseIntentConfirmed:false,description:`${signal.eventDate}: ${signal.quote}. ${signal.status==='needs_review'?'Source evidence needs fresh review.':'Owner-reviewed company publication; purchasing intent remains unconfirmed.'}`});
            await edge('signal_for',signalId,companyId,businessId,signal.source);
          }
          for (const { suffix, person: p } of projectedPeople(state, lead)) {
            const personId = prefix + suffix;
            await node('Person', personId, p.name, businessId, p);
            await edge('works_at', personId, companyId, businessId, p.source);
            if (p.publicReview?.formerEmployer) {
              const employer = p.publicReview.formerEmployer;
              const account = state.leads.find(item => item.domain.toLowerCase().replace(/^www\./, '') === employer.domain);
              const previousId = account ? prefix + 'company:' + account.id : prefix + 'employer:' + employer.domain;
              if (!account) await node('Company', previousId, employer.name, businessId, { domain: employer.domain, role: 'Reviewed former-employer reference; not a lead', source: employer.identitySource, identityQuote: employer.identityQuote });
              await edge('previously_employed_at', personId, previousId, businessId, p.source);
            } else if (p.previousCompany) {
              const previousId = prefix + 'previous:' + p.previousCompany.toLowerCase().replace(/[^a-z0-9]+/g, '-');
              await node('Company', previousId, p.previousCompany, businessId, { role: 'Previous employer name; unresolved identity, not a lead', unresolvedIdentity: true, source: p.source });
              await edge('previously_employed_at', personId, previousId, businessId, p.source);
            }
          }
          const outbound = state.drafts.filter(d => d.leadId === lead.id && ['simulated', 'accepted'].includes(d.status));
          for (const draft of outbound) {
            const outreachId = prefix + 'outreach:' + draft.id;
            await node('Signal', outreachId, `${draft.channel} outreach`, businessId, { draftId: draft.id, channel: draft.channel, variant: draft.variant, sequenceStep: draft.sequenceStep, mode: draft.status === 'simulated' ? 'dry_run' : 'live', at: draft.sentAt, description: draft.status === 'simulated' ? 'Local dry run; no external message sent.' : 'Provider acceptance; inbox delivery not established.' });
            await edge('contacted_via', companyId, outreachId, businessId, draft.id);
          }
          for (const report of (lead.events || []).filter(event => event.recordType === 'outcome')) {
            const outcomeId = prefix + 'outcome:' + report.id;
            const isDemo = report.mode === 'dry_run';
            const attribution = isDemo ? 'Demo observation; no real response established.' : 'Manually reported; not provider-verified.';
            await node('Signal', outcomeId, `${report.stage} · ${isDemo ? 'demo' : 'user-reported'}`, businessId, { outcomeId: report.id, stage: report.stage, at: report.at, recordedAt: report.recordedAt, actor: report.actor, mode: report.mode, provenance: 'user_reported', providerVerified: false, draftId: report.draftId, respondent: report.respondent, source: report.evidenceUrl || null, description: `${attribution} ${report.note}` });
            await edge('signal_for', outcomeId, companyId, businessId, `${attribution} Recorded by ${report.actor} at ${report.recordedAt}.`);
            const draft = outbound.find(draft => draft.id === report.draftId && draft.businessId === businessId);
            const personIndex = report.respondent ? lead.people.findIndex(person => person.name === report.respondent.name && person.source === report.respondent.source) : -1;
            if (report.stage === 'Replied' && draft && personIndex >= 0 && (isDemo === (draft.status === 'simulated')) && Date.parse(report.at) >= Date.parse(draft.sentAt)) {
              await edge('replied_to', prefix + 'person:' + lead.id + ':' + personIndex, prefix + 'outreach:' + draft.id, businessId, `${attribution} ${report.respondent.name}; occurrence ${report.at}; recorded by ${report.actor} at ${report.recordedAt}.`);
            }
          }
        }
        await query('COMMIT');
      } catch (error) { await query('ROLLBACK'); throw error; }
      return await snapshotInternal(businessId);
    });
  }
  async function snapshotInternal(businessId) {
    const nodes = [];
    for (const label of labels) {
      const rows = await query(`MATCH(n:${label}) WHERE n.businessId=$businessId RETURN n.id AS id,n.name AS name,n.data AS data`, { businessId });
      nodes.push(...rows.map(n => ({ ...n, type: label, data: JSON.parse(n.data) })));
    }
    const edges = [];
    for (const [type, [from, to]] of Object.entries(relationships)) {
      const rows = await query(`MATCH(a:${from})-[r:${type}]->(b:${to}) WHERE a.businessId=$businessId AND b.businessId=$businessId AND r.businessId=$businessId RETURN a.id AS source,b.id AS target,r.evidence AS evidence`, { businessId });
      edges.push(...rows.map(r => ({ ...r, type })));
    }
    return { engine: `Kuzu ${kuzu.VERSION}`, businessId, nodes, edges };
  }
  const snapshot = id => serial(() => snapshotInternal(id));
  const paths = id => serial(async () => {
    const rows = await query('MATCH(p:Person)-[:works_at]->(c:Company)-[:matched_to]->(product:Product) WHERE p.businessId=$id AND c.businessId=$id AND product.businessId=$id RETURN p.name AS person,c.name AS company,product.name AS product,p.data AS evidence', { id });
    return rows.map(r => ({ ...r, evidence: JSON.parse(r.evidence), relation: 'Person → works_at → Company → matched_to → Product' }));
  });
  const marketPaths = id => serial(async()=>{
    const rows=await query('MATCH(s:Signal)-[:signal_for]->(c:Company)-[:matched_to]->(p:Product) WHERE s.businessId=$id AND c.businessId=$id AND p.businessId=$id RETURN s.name AS signal,s.data AS evidence,c.name AS company,p.name AS product',{id});
    return rows.flatMap(row=>{const evidence=JSON.parse(row.evidence);return evidence.provenance==='owner_reviewed_market_signal'&&signalFresh(evidence)?[{...row,evidence,relation:'Signal → signal_for → Company → matched_to → Product',interpretation:'Current public-event context; buyer evaluation cycle and purchase intent unconfirmed.'}]:[];});
  });
  const warmPaths = id => serial(async () => {
    const fresh = person => person.reviewCurrent && person.publicReview?.status === 'reviewed' && personDateFresh(person.publicReview.checkedAt) && (!person.publicReview.formerEmployer || personDateFresh(person.publicReview.formerEmployer.checkedAt));
    const people = (await query('MATCH(p:Person) WHERE p.businessId=$id RETURN p.id AS id,p.data AS data', { id })).map(row => ({ id: row.id, data: JSON.parse(row.data) })).filter(row => fresh(row.data));
    const anchorIds = people.filter(row => row.data.knownConnection).map(row => row.id);
    if (!anchorIds.length) return [];
    const personIds = people.map(row => row.id);
    const paths = [];
    for (const anchorEdge of ['works_at', 'previously_employed_at']) for (const targetEdge of ['works_at', 'previously_employed_at']) {
      const rows = await query(`MATCH(a:Person)-[:${anchorEdge}]->(shared:Company)<-[:${targetEdge}]-(t:Person)-[:works_at]->(c:Company)-[:matched_to]->(p:Product) WHERE a.businessId=$id AND t.businessId=$id AND shared.businessId=$id AND c.businessId=$id AND p.businessId=$id AND a.id<>t.id AND a.id IN $anchorIds AND t.id IN $personIds RETURN a.id AS anchorId,a.name AS anchor,a.data AS anchorData,t.id AS personId,t.name AS person,t.data AS targetData,shared.name AS employer,shared.data AS employerData,c.name AS company,c.data AS companyData,p.name AS product ORDER BY a.id,t.id,shared.id LIMIT 100`, { id, anchorIds, personIds });
      for (const row of rows) {
        const anchor = JSON.parse(row.anchorData), target = JSON.parse(row.targetData), employer = JSON.parse(row.employerData);
        if (!fresh(anchor) || !fresh(target) || !anchor.knownConnection || employer.unresolvedIdentity || row.anchor.toLowerCase() === row.person.toLowerCase()) continue;
        const employment = (person, edge) => ({ name: person.name, role: person.role, relationship: edge, source: person.publicReview.source, quote: edge === 'works_at' ? person.publicReview.roleQuote : person.publicReview.formerEmployer?.quote, checkedAt: person.publicReview.checkedAt, identitySource: edge === 'previously_employed_at' ? person.publicReview.formerEmployer?.identitySource : null, identityQuote: edge === 'previously_employed_at' ? person.publicReview.formerEmployer?.identityQuote : null });
        paths.push({ id: `${row.anchorId}|${anchorEdge}|${row.personId}|${targetEdge}|${row.employer}`, anchor: row.anchor, person: row.person, company: row.company, leadId: JSON.parse(row.companyData).leadId, product: row.product, employer: row.employer, anchorEvidence: employment(anchor, anchorEdge), targetEvidence: employment(target, targetEdge), connection: anchor.knownConnection, relation: `Person → ${anchorEdge} → Company ← ${targetEdge} ← Person → works_at → Company → matched_to → Product`, interpretation: 'Possible introduction based on reviewed publications and your attestation. Dates, employment overlap, acquaintance, current employment, willingness and buying authority are unconfirmed.' });
      }
    }
    return paths.slice(0, 100);
  });
  return { sync, snapshot, paths, marketPaths, warmPaths, close: async () => { await queue; await connection.close(); await db.close(); } };
}
