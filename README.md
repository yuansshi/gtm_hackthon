# GTM Engine: industrial sales portal

A full-stack demo for two separate businesses: **Allco Hydraulic** and **Huasheng Castings**. The first campaign is Allco → United States → equipment manufacturers (OEMs). Products, research approval, accounts, contacts, drafts, opportunities, usage, and graph records stay scoped to the selected business.

## Run locally

Requires Node.js **24+**, npm, and a platform supported by the native Kuzu package. Verified on macOS arm64. No API keys are needed for demo mode.

```sh
npm ci
cp .env.example .env
npm run build
npm start
```

Open **http://127.0.0.1:3001**. The Express server serves both the API and production UI. For UI development, run `npm run server` and `npm run dev` in two terminals; Vite proxies `/api` to port 3001. `npm run preview` also requires the backend.

The supplied `.env.example` contains dummy Band and Flexprice placeholders. The application does not send requests to Band or Flexprice or infer a verified connection from the presence of a key. AI is disabled by default. Do not put personal keys here.

## Try the five-module flow

1. **Product & ICP:** review company products and capabilities; choose target industries, territory, roles, size criteria, classification, triggers, reference wins, and domain exclusions. A local guided intake recognizes explicit US/Canada/Mexico, OEM, employee-range, NAICS/SIC, and excluded-domain statements. Every proposal is persisted for accept/adjust/dismiss review; it cannot apply itself. Optional project-model intake uses strict structured output and the same review gate. Confirm the profile review and approve for research. Editing the profile revokes research and unsent-message approvals.
2. **Discovery:** run source research (2 demo credits) over the curated collection of real US OEMs. Inspect each company's application hypothesis, citations, named public leaders, fit breakdown, unknowns, and timestamped fetch successes/failures. Shortlist an account. Public contact + DNS MX checking costs 5 credits; MX never establishes mailbox deliverability or buyer authority.
3. **Knowledge graph:** query the native Kuzu database (1 credit), inspect directional relationships and their evidence, and follow Person → Company → Product paths. The graph also retains published previous-employer relationships and local outreach events.
4. **Outreach:** prepare email or LinkedIn drafts with A/B variants and day 0/3/7 follow-ups. Templates cite the account's application and this supplier's website. Edit, save, reject, or approve the exact version. Approval is bound on the server to business, profile, recipient, subject, body, channel, sequence step, and message version. Recording a dry run costs 1 credit and sends **nothing externally**. Duplicate sends are idempotent; both A/B variants cannot be dispatched to the same account/channel/step.
5. **Pipeline:** move accounts through Matched, Contacted, Replied, Meeting booked, RFQ received, Engineering review, Quote sent, Trial / qualification, Closed won/lost. Counts use recorded events, with actor and timestamp. Dry-run messages and user-reported outcomes are identified separately. Segmented and A/B counts are descriptive observations.

Open **Billing & credits** in the sidebar or click the header balance to reload credits and inspect usage. **Service connections** shows integration status. The Activity panel records actors and approvals. Campaign reset retains the workspace credit balance and billing receipts.

## What is real and what is simulated

| Capability | Current implementation |
| --- | --- |
| Persistence | SQLite workspace transactions, revision checks, restart recovery for interrupted credit reservations |
| Graph | Native Kuzu 0.11.3, parameterized Cypher, business-scoped nodes/edges, persistent multi-hop queries |
| Research | Curated real companies + primary citations + live HTTP source checks; not open-ended prospect search |
| Contact enrichment | Public general company addresses + DNS MX; no vendor or verified personal mailbox |
| ICP confidence | Visible 0–1 coverage plus provenance for reviewed local/model suggestions; not calibrated probabilities |
| Drafting | Source-grounded templates by default; optional credential-gated OpenAI structured drafts with required account/supplier citations, proposed claim review, and actual returned token usage |
| Outreach | Server-enforced approval and local dry run; no email/LinkedIn provider connected |
| Agents / Band | Local role-based steps; no independently running Band agents, @mentions, tokens, or cost telemetry |
| Billing / Flexprice | Atomic local demo credit ledger; no external wallet, billing event ingestion, or real charge |
| Security scans | npm audit run locally; Snyk SAST/SCA workflow prepared but not run without project token/repository |

No RFQ, buying intent, direct buyer email, certification, technical compatibility, price advantage, or delivery commitment is fabricated. A failed refresh preserves its failure status; it does not silently turn cached research into fresh verification.

## Persistence and operation

`.data/workspace.sqlite` holds the scoped workspaces and usage ledgers; `.data/knowledge.kuzu` is the native graph. Back up the whole `.data` directory while the server is stopped. Keep one server process per data directory; SQLite and Kuzu are embedded databases. Browser storage remains a local profile backup and is not the source of approval authority. Legacy browser approval flags are never imported as authorization.

Default binding is loopback. Binding `HOST=0.0.0.0` requires `PROJECT_ACCESS_TOKEN`; set `PUBLIC_ORIGIN` to the exact HTTPS deployment origin. The project token grants access to both business workspaces: this is a shared-project demo, **not** multi-user tenant authorization. Sessions expire after eight hours, use an HttpOnly SameSite cookie, and require CSRF tokens for writes. Put deployments behind HTTPS and persist `DATA_DIR` on a volume. Do not deploy with a dummy access token.

A Dockerfile is supplied for a Linux Node 24 deployment with `/data` mounted. Docker build/deployment has not been verified on this machine because Docker is unavailable. Static-only hosting cannot run this backend. Sites is not enabled in the current workspace. Public application hosting is not configured. Source submission target: [yuansshi/gtm_hackthon](https://github.com/yuansshi/gtm_hackthon).

Kuzu 0.11.3 is deprecated/archived upstream. It satisfies the hackathon's native graph requirement and passes the included persistence test. Evaluate a maintained graph engine before production use. The `tar` override removes a vulnerable transitive installation dependency; npm audit currently reports no vulnerabilities. This does not substitute for Snyk results.

## Verify

```sh
npm test
npm run build
npm audit
```

Tests exercise approval bypass prevention, content/profile invalidation, stale revisions, scoped IDs, no duplicate dry-run charge, A/B suppression, credit enforcement/refunds, actual native graph persistence and multi-hop paths, private-source rejection, MX semantics, and API session/CSRF/origin/schema validation. Fixtures use reserved `.test` addresses and never send a message. Native query results are explicitly closed before database shutdown.

The GitHub workflow runs checks and Snyk source/dependency scans. Configure a project `SNYK_TOKEN` repository secret; the Snyk job intentionally fails with a setup message if it is missing. No passing Snyk scan is claimed. See the [official Snyk command reference](https://docs.snyk.io/developer-tools/snyk-cli/cli-commands-and-options-summary).

## Source layout

- `src/IndustryApp.jsx`: workspace switching, server hydration, saved profiles, navigation, audit panels.
- `src/ModuleOne.jsx`, `src/GuidedIntake.jsx`, `src/businesses.js`: intake, evidence coverage, supplier profiles, handoff contract.
- `src/Workflow.jsx`: discovery, graph inspection, review queue, pipeline, usage UI.
- `server/app.js`: typed HTTP boundary, sessions, origin/CSRF controls.
- `server/service.js`: workflow policy, exact-message approval, metering, history metrics.
- `server/store.js`, `server/graph.js`: transactional workspace store and native graph projection.
- `src/Billing.jsx`, `server/billing.js`: credit balances, pack/custom reloads, receipts, usage history, limits and retry-safe reload IDs.
- `server/catalog.js`, `server/evidence.js`: cited research collection, source checks, transparent scoring, DNS MX.
- `server/intake.js`, `server/model.js`: bounded local extraction and credential-gated structured model output.
- `tests/workflow.test.js`, `tests/assistant.test.js`, `tests/billing.test.js`: workflow, native database, assistant-review, and real SDK contract tests with intercepted HTTP fixtures.
- `docs/system-design.md`, `docs/rubric-status.md`, `docs/demo-script.md`, `docs/demo-narration.md`: submission preparation and remaining gaps.
- `src/legacy-demo.jsx`, `src/data.js`: original fictional SaaS fixtures preserved; not used as industrial prospects.

A separate 2:51 desktop walkthrough MP4 and source ZIP are supplied with this update. The video uses actual desktop screenshots and local synthesized narration, states provider limitations, and is not continuous live screen capture.

## Optional project AI

Demo mode needs no model key. To enable AI proposals later, designate a project-specific OpenAI key and a Structured Outputs-capable model in `.env`:

```dotenv
PROJECT_AI_ENABLED=true
PROJECT_OPENAI_API_KEY=<project-specific-key>
PROJECT_OPENAI_MODEL=<model-enabled-for-your-project>
```

Restart `npm start` after changing these settings. The adapter never reads `OPENAI_API_KEY` or user-wide secret files. It fixes the destination to the official OpenAI API and does not inherit SDK organization/project defaults. A configured key is labeled **Configured; not verified** until a valid response returns. Do not claim live verification from the fixture tests.

In Product & ICP, choose AI model and explicitly acknowledge processing of this business's description and supplier research brief. Suggestions quote supplied input or cite an allowed catalog URL. Catalog hypotheses are capped at 0.5 confidence. Territories, size/revenue, classification codes, reference wins, and exclusions cannot be invented from a catalog. Accept, adjust, or dismiss every field; applying changes invalidates prior research and unsent-message approvals. Provenance is retained only while the field value/context remains applicable.

In Outreach, choose AI model to generate a draft from the approved supplier brief and the selected account's public context. The model cannot set a recipient or generate a contact address. Account and supplier citations must be in the allowed evidence and inline in the body. Proposed claims still require factual review; URL membership is not semantic fact verification. All drafts remain unsent/unapproved, and the existing exact-message gate applies.

AI requests reserve two **local demo credits** before transmitting. Request IDs deduplicate completed requests and prevent automatic replay of in-flight, failed, or interrupted attempts. A new attempt is explicit. A stale revision is rejected before transmission; a changed profile discards in-flight output. Refusals, incomplete/invalid output, and failures refund local credits and retain provider usage when confirmed. A local refund does not imply a provider refund; SDK/network failures may leave external billing unknown. Returned token counts are telemetry, not an invented dollar cost or Band usage claim.

The SDK uses schema-constrained Responses, `store: false`, bounded output, a 45-second timeout, and no automatic retries. See [official Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). `store: false` is a request setting, not a claim of zero data retention. Current verification covers local extraction, policy, and intercepted SDK HTTP contracts. No live model request has been made with the supplied dummy configuration.

## Billing and reloading credits

The signed-in project user can open **Billing & credits** and reload the active workspace with 100, 500, 1,000, or a custom whole number of demo credits (1–100,000 per request; 1,000,000 maximum balance). The header balance updates immediately. Reloads persist in SQLite, have a receipt with the workspace, amount, date and before/after balances, and remain available after browser/server restart. Allco and Huasheng never share balances automatically.

Repeated requests with the same reload ID return the same receipt and cannot grant credits twice. Amounts and packs are validated on the server; clients cannot post a new balance or a different workspace identity. Usage, reloads, reservations and refunds can be reviewed separately. An insufficient balance blocks metered work; reloading restores availability. Profile/campaign reset preserves the wallet and receipts.

**This is demo billing. No card details, real payment, price, tax invoice or Flexprice charge is collected.** A production payment flow must replace free demo grants with verified provider checkout/webhook fulfillment and real user/tenant authorization. The shared-project demo token is not a multi-user billing identity. The old fixed `/credits` grant now requires the same validated reload request as `/billing/reloads`.
