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

The supplied `.env.example` contains dummy Band and Flexprice placeholders. The application does not send requests to Band or Flexprice or infer a verified connection from the presence of a key. AI, Tavily prospect search, and Hunter contact research are disabled by default. Do not put personal keys here.

## Try the five-module flow

1. **Product & ICP:** review company products and capabilities; choose target industries, territory, roles, size criteria, classification, triggers, reference wins, and domain exclusions. A local guided intake recognizes explicit US/Canada/Mexico, OEM, employee-range, NAICS/SIC, and excluded-domain statements. Every proposal is persisted for accept/adjust/dismiss review; it cannot apply itself. Optional project-model intake uses strict structured output and the same review gate. Confirm the profile review and approve for research. Editing the profile revokes research and unsent-message approvals.
2. **Discovery:** use optional project-enabled **Search prospects** to inspect and acknowledge an ICP query plan, retrieve up to three company domains for two local credits, and open fetched sources for review without another intake charge. Alternatively, run source research (2 demo credits) over curated and owner-admitted US OEMs, or choose **Research a website** to fetch up to two company pages (2 credits). Review exact company, manufacturer, US-location, and application evidence before adding a new account; it is not automatically shortlisted. Inspect each company's application hypothesis, citations, named public leaders, fit breakdown, unknowns, and timestamped fetch successes/failures. Shortlist an account. Public contact + DNS MX checking costs 5 credits; MX never establishes mailbox deliverability or buyer authority. The account’s **Contacts** tab also supports optional project-enabled Hunter search and selected-address verification (5 credits each), followed by an explicit contact/source review. Selecting a contact updates editable unsent recipients and requires new message approval.
3. **Knowledge graph:** query the native Kuzu database (1 credit), inspect directional relationships and their evidence, and follow Person → Company → Product paths. The graph also retains published previous-employer relationships and local outreach events.
4. **Outreach:** prepare email or LinkedIn drafts with A/B variants and day 0/3/7 follow-ups. Templates cite the account's application and this supplier's website. Edit, save, reject, or approve the exact version. Approval is bound on the server to business, profile, recipient, subject, body, channel, sequence step, and message version. Recording a dry run costs 1 credit and sends **nothing externally**. Duplicate sends are idempotent; both A/B variants cannot be dispatched to the same account/channel/step.
5. **Pipeline:** move accounts through Matched, Contacted, Replied, Meeting booked, RFQ received, Engineering review, Quote sent, Trial / qualification, Closed won/lost. Counts use recorded events, with actor and timestamp. Dry-run messages and user-reported outcomes are identified separately. Segmented and A/B counts are descriptive observations.

Open **Billing & credits** in the sidebar or click the header balance to reload credits and inspect usage. **Service connections** shows integration status. The Activity panel records actors and approvals. Campaign reset retains the workspace credit balance and billing receipts.

## What is real and what is simulated

| Capability | Current implementation |
| --- | --- |
| Persistence | SQLite workspace transactions, revision checks, restart recovery for interrupted credit reservations |
| Graph | Native Kuzu 0.11.3, parameterized Cypher, business-scoped nodes/edges, persistent multi-hop queries |
| Research | Curated companies, quoted-source website intake, and optional ICP-driven Tavily search with bounded source retrieval; owner-reviewed admission; search fixtures checked, live project search unverified |
| Contact enrichment | Public addresses/MX plus optional Hunter V2 search and verifier, dated check labels, persona/source review, and recipient/version reset; fixture and public test API checked, live project enrichment unverified |
| ICP confidence | Visible 0–1 coverage plus provenance for reviewed local/model suggestions; not calibrated probabilities |
| Drafting | Source-grounded templates by default; optional credential-gated OpenAI structured drafts with required account/supplier citations, proposed claim review, and actual returned token usage |
| Outreach | Server-enforced approval and local dry run; no email/LinkedIn provider connected |
| Agents / Band | Local role-based steps; no independently running Band agents, @mentions, tokens, or cost telemetry |
| Billing / Flexprice | Atomic local demo credit ledger; no external wallet, billing event ingestion, or real charge |
| Security scans | npm audit and GitHub verify pass; Snyk workflow stops at the missing project-token check before SAST/SCA |

No RFQ, buying intent, direct buyer email, certification, technical compatibility, price advantage, or delivery commitment is fabricated. A failed refresh preserves its failure status; it does not silently turn cached research into fresh verification.

## Persistence and operation

`.data/workspace.sqlite` holds the scoped workspaces and usage ledgers; `.data/knowledge.kuzu` is the native graph. Back up the whole `.data` directory while the server is stopped. Keep one server process per data directory; SQLite and Kuzu are embedded databases. Browser storage remains a local profile backup and is not the source of approval authority. Legacy browser approval flags are never imported as authorization.

Default binding is loopback. Binding `HOST=0.0.0.0` requires `PROJECT_ACCESS_TOKEN`; set `PUBLIC_ORIGIN` to the exact HTTPS deployment origin. The project token grants access to both business workspaces: this is a shared-project demo, **not** multi-user tenant authorization. Sessions expire after eight hours, use an HttpOnly SameSite cookie, and require CSRF tokens for writes. Put deployments behind HTTPS and persist `DATA_DIR` on a volume. Do not deploy with a dummy access token.

A Dockerfile is supplied for a Linux Node 24 deployment with `/data` mounted. Docker build/deployment has not been verified on this machine because Docker is unavailable. Static-only hosting cannot run this backend. Public application hosting is not configured. Source submission target: [yuansshi/gtm_hackthon](https://github.com/yuansshi/gtm_hackthon).

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
- `src/Workflow.jsx`: graph inspection and service connections, with re-exports for the account, HITL, and pipeline modules.
- `src/AccountResearch.jsx`, `src/HITLReview.jsx`, `src/OpportunityPipeline.jsx`: account evidence previews, exact-message review, and Board/List/Analytics.
- `src/PipelineAnalytics.jsx`, `src/pipeline-metrics.js`: shared cohort calculations, event-mode/window filters, post-contact conversion, and explicit reply linkage.
- `server/app.js`: typed HTTP boundary, sessions, origin/CSRF controls.
- `server/service.js`: workflow policy, exact-message approval, metering, history metrics.
- `server/store.js`, `server/graph.js`: transactional workspace store and native graph projection.
- `src/Billing.jsx`, `server/billing.js`: credit balances, pack/custom reloads, receipts, usage history, limits and retry-safe reload IDs.
- `server/catalog.js`, `server/evidence.js`: cited research collection, source checks, transparent scoring, DNS MX.
- `src/ProspectSearch.jsx`, `src/prospect-plan.js`, `server/prospect-search.js`, `server/prospect-search-provider.js`: inspectable ICP queries, optional project search, persistent retrieval proposals, and shared-cost metering.
- `src/WebsiteIntake.jsx`, `server/website-intake.js`, `server/public-source.js`: public website retrieval, quoted-source admission, persistent candidate collection, and stale-evidence review.
- `src/ContactResearch.jsx`, `src/contact-evidence.js`, `server/hunter.js`, `server/contact-enrichment.js`: vendor candidates, dated verification, explicit contact selection, restrictions, and retry-safe metering.
- `server/review-policy.js`: shared account-context invalidation for editable unsent drafts and restricted-recipient gating.
- `server/intake.js`, `server/model.js`: bounded local extraction and credential-gated structured model output.
- `tests/workflow.test.js`, `tests/assistant.test.js`, `tests/billing.test.js`: workflow, native database, assistant-review, and real SDK contract tests with intercepted HTTP fixtures.
- `docs/system-design.md`, `docs/rubric-status.md`, `docs/demo-script.md`, `docs/demo-narration.md`: submission preparation and remaining gaps.
- `src/legacy-demo.jsx`, `src/data.js`: original fictional SaaS fixtures preserved; not used as industrial prospects.

The current [public demonstration video](https://youtu.be/lXMJIpLYfAc) is 2:47, with Kokoro Heart narration and English captions. It shows product intake, graph matching, composition, exact-version HITL review, and dashboard synchronization in demo mode. The earlier 2:51 walkthrough transcript remains archived in docs/demo-narration.md.

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


### Pipeline analytics

Open **Pipeline → Analytics**. Industry, tier, stage, summary, and search filters select the same accounts across Board, List, and Analytics. Use an activity window and type to separate dry runs, user-reported events, and provider activity. Click a milestone to inspect its supporting accounts and source evidence.

Conversion rates use a shared recorded-contact cohort and outcomes after contact, while raw milestones retain incomplete histories. Sequence observations split channel, A/B variant, step, drafting method, and mode; a reply is attributed only with an explicit same-account draft reference. Use **Record outcome** for confirmed user-reported or demo feedback, notes, occurrence time, optional message linkage, and an existing published respondent. New outcome context clears unsent approvals and advances message versions for fresh HITL review. No provider reply feed is connected; quick stage edits without explicit message links remain unattributed. See [metric definitions and validation](docs/pipeline-analytics.md).

See [Outcome reporting](docs/outcome-reporting.md) for retry-safe persistence, historical entries, message eligibility, approval invalidation, and graph projection behavior.


## Add an account from its website

Open **Accounts → Research a website** after approving the current profile. Enter a company product/about page and, optionally, a same-site contact page. The two-credit job retrieves bounded public HTTPS text without executing scripts or sending credentials. A failed or interrupted fetch refunds once; reopening the same request does not charge again. Close and resume from the website research queue.

Review the retained text beside the account form. Use a company name present in the sources; copy exact manufacturer, geography, and application quotes and select their source pages. Choose a product family in this business’s approved campaign, enter the fit hypothesis, and optionally select a same-domain published email. Confirming **Add researched account** validates source membership and the campaign’s US/OEM/product/domain rules. Quote presence is not semantic verification. The resulting record is unshortlisted, with no invented people, unknown size/intent, unverified mailbox, and technical qualification still required.

Accepted candidates persist and take part in subsequent source refreshes. Missing quotes, failed retrieval, or a removed selected email make evidence review required, deselect the account, block qualification/approval, and advance editable unsent draft versions. A successful fetch alone cannot clear that review requirement; fetch fresh pages and complete a new owner review. Sent receipts and historical stages stay intact. Admission is durable before graph projection; a pending graph refresh can be repaired without duplicating or charging for admission.

Sources expire for admission after 24 hours. A changed profile requires fresh research; refresh the workspace after a revision conflict. Dismissal removes a pending intake from the queue but does not refund completed source work. Optional ICP-driven Tavily search feeds this same review path; project keys are required for live search and Hunter verification. Search does not admit accounts autonomously. Protocol, DNS-pinning, state, and verification details are in [Website intake](docs/website-intake.md).


## Optional project Hunter contact research

Set `PROJECT_HUNTER_ENABLED=true` and `PROJECT_HUNTER_API_KEY` to an explicitly designated project key in the local `.env`, then restart `npm start`. `HUNTER_API_KEY`, global secret files, dummy values, and Hunter’s public test key do not enable the live adapter. The destination is fixed to Hunter’s official HTTPS API. API keys remain on the server and are never accepted through the browser.

Open **Accounts → account preview → Contacts**. Confirm external processing, search the account domain, inspect a candidate’s source links and proposed role, and request email verification. Search and verification each reserve five **local demo credits**, separate from any Hunter charge. HTTP 202 remains pending until explicitly checked; checking the pending result uses no extra local credits. Closing a pending check refunds its local reservation without claiming to cancel Hunter processing or charges. Interrupted work fails on restart without replay.

A **Hunter valid** label requires the matching address, successful MX/SMTP and format checks, no accept-all/block/disposable/webmail flag, and a real provider verification date within 30 days. Unknown or accept-all results need separate uncertainty acknowledgement. Invalid, disposable, webmail, restricted, off-domain, masked, source-free, and incomplete records cannot silently become valid contacts. Persona keyword overlap is a review hint; buying authority and LinkedIn ownership remain unverified. Headquarters/firmographic enrichment is not implemented.

Using a contact is a separate human decision. It updates only this account’s editable unsent recipients, advances their versions, and clears approvals. Historical sent receipts stay unchanged. The graph and manually reported respondents retain vendor-role provenance. Hunter processing restrictions block new address processing and survive campaign reset; this is not a complete opt-out/suppression system.

Verification: the full test suite covers intercepted provider contracts and workflow policy. A manual check also passed against Hunter’s official fixed-data public test API:

```sh
node scripts/check-hunter-contract.js
```

This command uses Hunter’s documented public `test-api-key`, applies **zero contacts**, and does not establish live contact verification. No live project Hunter key was used for the recorded validation. See [Contact enrichment](docs/contact-enrichment.md) and [Hunter’s API reference](https://hunter.io/api-documentation).


## Optional project Tavily prospect search

Set `PROJECT_TAVILY_ENABLED=true` and `PROJECT_TAVILY_API_KEY` to a designated project key in local `.env`, then restart `npm start`. Dummy values and global keys do not enable it. The server fixes the destination to Tavily’s official HTTPS search API and never accepts browser-supplied keys.

Open **Accounts → Search prospects** with an approved US OEM profile. Choose one or two approved product families, inspect the exact queries, and acknowledge external processing. Only those queries and fixed search parameters go to Tavily; supplier details, pricing, contacts, outcomes, and private domain exclusions stay local. Excluded roots/subdomains, existing accounts, directories, and queued sites are filtered before retrieval.

Two local demo credits cover up to two basic queries, eight results per query, three new domains, and two public source pages per domain. Results distinguish exclusions, duplicates, source failures, and ready proposals. Open **Review fetched sources** for exact-quote admission with no additional intake charge. No account is added or shortlisted automatically. **Fetch separately** explicitly starts the normal two-credit website workflow.

Run history survives reloads. Retries with the same request ID do not repeat provider work or charges. Completed searches with empty results or failed source pages consume the search charge; failed searches, interrupted jobs, and stale-profile completion refund once. No automatic replay occurs. Provider usage is recorded only when returned; local credits and refunds do not establish Tavily billing or cancellation. Shared search cost remains business-scoped.

Validation: 95 tests pass, including 16 prospect-search tests with intercepted HTTP contracts and synthetic source fixtures. Desktop browser QA confirmed query acknowledgement reset, run resumption, exclusion/partial-failure display, source-review handoff, admission without another charge, persistent accepted status, separate-fetch prefill, business isolation, Escape, and no horizontal overflow. No live Tavily request was made with a project key. See [Prospect search](docs/prospect-search.md).
