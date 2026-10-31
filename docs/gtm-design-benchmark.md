# GTM website and product design benchmark

Reviewed October 30, 2026. This is a representative comparison of ten established GTM products, not a verified market-share or popularity ranking. The redesign targets the existing **desktop industrial sales portal**, with separate Allco Hydraulic and Huasheng Castings workspaces.

## Method and evidence boundaries

- Inspected all ten public sites in a browser and retained screenshots, visible DOM text, headings, and headline font families locally.
- Reviewed official product documentation and public interface examples. We did not sign up for products or inspect authenticated customer environments.
- Compared navigation, research tables, record previews, evidence presentation, review decisions, and pipeline views.
- Used the REA CLI to inspect two observed public JavaScript chunks from Apollo and Attio as inert shipped artifacts. REA's MCP registration was absent. No global configuration or analysis engine was installed or changed.
- Vendor outcome statements are marketing claims. We did not establish that interface design causes commercial success. The proposed usability benefits below are design inferences, not measured results.

Private evidence is retained in the task's `gtm-research` directory. Third-party scripts, vendor screenshots, and raw REA bundles are excluded from publication to this source repository.

## Ten-product comparison

| Reference | Distinctive product approach and observed design | Adaptation for this portal |
| --- | --- | --- |
| **Clay** | Configurable work tables, typed research columns, cell detail, conditional automation, and reusable test cases. Its public site uses a distinctive illustrated scene with a clear primary action. [Tables](https://university.clay.com/docs/table-columns-overview), [Builder](https://university.clay.com/docs/claygent-builder), [Website](https://www.clay.com/) | Keep an account table as the working surface. Put long research in contextual detail. Expose research cost and scope beside the action. |
| **Apollo** | Company filters, research previews before large runs, persistent editable research, and visible score criteria. The website presents a connected GTM system with a strong primary conversion action. [Company search](https://knowledge.apollo.io/hc/en-us/articles/4412658766477-Search-for-Companies), [Research](https://knowledge.apollo.io/hc/en-us/articles/29193277882125-AI-Research-Overview), [Scoring](https://knowledge.apollo.io/hc/en-us/articles/4988048582285-Scores-Overview) | Put search, sorting, result counts, and shortlist views directly above accounts. Keep fit rationale inspectable and separate from purchasing intent. |
| **HubSpot Sales Hub** | The updated Sales Workspace combines daily work and CRM records. Configurable summaries lead to tasks, while standard record previews preserve context. Its public site demonstrates the interface near a simple product explanation. [Updated workspace](https://knowledge.hubspot.com/sales-workspace/manage-sales-activities-in-the-updated-sales-workspace), [Record previews](https://knowledge.hubspot.com/object-settings/customize-record-previews), [Sales Hub](https://www.hubspot.com/products/sales) | Replace the tutorial-style landing page with real workload, review counts, recent activity, and a clear next action. Keep longer intake help secondary once the profile is approved. |
| **Salesforce Sales Cloud** | Pipeline summary metrics filter records. Opportunity inspection exposes recent changes, activity, and deal context beside the list. Its public site has an enterprise product hierarchy and explicit demo actions. [Pipeline Inspection](https://help.salesforce.com/s/articleView?id=sf.pipeline_inspection_managing_pipelines_overview.htm&language=en_US&type=5), [Interface walkthrough](https://trailhead.salesforce.com/content/learn/modules/sell-smarter-with-pipeline-inspection/discover-pipeline-inspection) | Make counts useful routes into their underlying work. Keep commercial stages distinct from research status and show actor, time, and action mode. |
| **Attio** | A flexible company/person record model, table and kanban lists, and a right record preview with previous/next controls. The public site uses restrained navigation, typography, and realistic product examples. [Lists](https://attio.com/help/reference/attio-101/attios-data-model/understanding-lists), [Record previews](https://attio.com/help/reference/managing-your-data/records/create-and-view-records), [Website](https://attio.com/) | Add a contextual account preview and review navigation while keeping the underlying table visible. Use a quiet light application shell and consistent spacing. |
| **ZoomInfo** | GTM Workspace connects an account-oriented signal feed, cited research, generated outputs, and CRM-synced views. Its public example pairs a dense account table with a contextual panel. [GTM Workspace](https://www.zoominfo.com/gtm-workspace) | Keep account identity and evidence together across research, graph, and outreach. Show citations beside claims and preserve business scope across every handoff. |
| **Outreach** | Expandable global navigation, a fast Account Overview distinct from a readable Account Plan, and deal context with an activity timeline. Its current site emphasizes a broad revenue execution platform. [Navigation](https://support.outreach.io/support/solutions/articles/159000425829-outreach-global-navigation-menu-overview), [Accounts](https://support.outreach.io/support/solutions/articles/159000434911-accounts-page-overview), [Deal overview](https://support.outreach.io/support/solutions/articles/159000425457) | Use stable labeled navigation, compact record summaries, and deeper evidence tabs. Keep message decisions beside the draft, with direct save/error feedback. |
| **Salesloft** | Rhythm organizes tasks around outcomes and explains the signal behind an action. Signal notifications and actionable tasks use different descriptions. Its public page uses a strong visual hierarchy around seller actions. [Workflow](https://www.salesloft.com/platform/sales-workflow-software), [Signals FAQ](https://developers.salesloft.com/docs/platform/rhythm-resources/signals-faq/) | Put “what needs attention” above secondary configuration. Every next action should have a real reason and an actual destination. |
| **6sense** | Account prioritization separates fit, engagement, intent, and buying-team context. Account detail combines summaries, timelines, scoring activity, and persona coverage. Its public site pairs the proposition with account-level product imagery. [Sales Intelligence](https://6sense.com/platform/sales-intelligence), [Account detail](https://support.6sense.com/docs/abm-account-details-page) | Preserve the distinction between product fit, public signals, and unknown buying intent. Keep technical qualification visible rather than turning a fit score into a purchase prediction. |
| **Common Room** | Configurable tables, filtered cohorts, saved segments, and account profiles that combine key fields with deeper activity tabs. Its public site connects buyer intelligence with pipeline context. [Contacts](https://www.commonroom.io/docs/using-common-room/contacts/), [Segments](https://www.commonroom.io/docs/using-common-room/segments/create-a-segment/), [Account profiles](https://www.commonroom.io/docs/using-common-room/accounts/account-profiles/) | Put compact views, search, sort, and counts close to the table. Keep a stable account header above evidence and activity. |

## Why these patterns are useful

These are hypotheses to validate with users, not claims of proven conversion improvement:

1. **Continuity:** A record preview preserves the account list while the user reads evidence.
2. **Focus:** Task-oriented summaries help users find the next incomplete step.
3. **Explainability:** A score breakdown and source links make a research hypothesis reviewable.
4. **Predictability:** Repeated toolbar, tab, and form patterns reduce the need to learn each module separately.
5. **Control:** Explicit versioned approval makes human responsibility clear before outreach.

## Design plan

The portal is an operational application. Marketing-site illustrations, conversion forms, large hero sections, and promotional outcome figures do not belong in its everyday work surface.

- **Palette:** ink `#202A38`, muted text `#667085`, application background `#F7F8FA`, border `#E6E9EF`, action blue `#315CBA`, review amber `#9A5D0A`. Teal remains the secondary verified/completed-state accent.
- **Typography:** retain locally bundled Manrope. Use compact page titles, 12–14px working text, and smaller supporting metadata. No new remote font dependency.
- **Layout:** a light labeled sidebar, compact top bar, and consistent working-area margins. Research uses a table and contextual record preview. Pipeline supports a board and list.
- **Hierarchy:** one primary action per view, actual status/counts, and source-backed details on demand.
- **Distinctive element:** the HITL stage remains amber and explicitly names the exact message version. Its actions stay adjacent to the message.

```text
Business navigation | Breadcrumb / workspace search / credits / activity
                    | Page title                         Primary action
                    | Scope / views / filters / real workload
                    | Main working surface               Context / review
```

Generic template suggestions that emphasized landing-page heroes, automatic animation, or new typefaces were rejected because this task is a desktop workbench. No animation library or imitation vendor branding is needed.

## Implementation scope

- Operational overview with scoped counts, next actions, account shortcuts, and recent events.
- Workspace navigation search with direct routes to real sections and researched accounts.
- Compact account views, search/sort, and a contextual account preview with source evidence and previous/next navigation.
- Board/list pipeline views with scope and stage filters based on the same real records.
- Consistent surfaces, controls, spacing, typography, and status colors across the existing profile, graph, billing, and review modules.
- Existing approval, quota, workspace separation, and demo-only delivery behavior remain authoritative on the server.

This redesign does not add live buying-intent verification, provider connections, customer creation, external delivery, or per-user authorization.

## REA evidence ledger

- Parent Evidence ID: `ev_f9f744a6647d024aea88aff878b562426cef30df53e27ad87902670180a5c9ca`.
- Summary Evidence ID: `ev_89ca80583d82be69bbf7b5c73c5f0b0e0e359d4240aeb7972b2db2fdc8d66ad8`.
- Input SHA-256: `28f370275a16c48915d670e950b52595f36087296076fcfedf0825dd4dc42b43`.
- Scope: two public JavaScript chunks observed on Apollo and Attio, plus an acquisition manifest; 369,266 text bytes and two parsed JavaScript files, with no parse failures.
- Limits: semantic retention was bounded at 6,000 nodes overall and 3,000 per file; REA reported partial graph coverage and 21,085 semantic unknowns. Chunk selection does not establish product-wide completeness.
- These static findings establish artifact identity and bounded syntax observations. They do **not** establish authenticated product behavior, runtime execution, security enforcement, or commercial effectiveness. The UI adaptations rely on the public browser observations and official documentation above.

## Validation

- Production build passed; all 25 existing tests passed, including business scoping, exact-version approval, edit invalidation, persistence, quota checks, and native graph paths.
- Browser verified at the default 1280 × 720 desktop viewport with no page-level horizontal overflow in HITL. Wide account tables and the ten-stage board scroll within their own working areas.
- Verified summary-to-shortlist navigation, account search/sort, evidence tabs, previous/next preview, Escape dismissal, and command-search account handoff.
- Verified board/list switching, scope and stage filter intersection, empty results, search, and clear-filter recovery.
- Verified Allco/Huasheng switching and that a search for an Allco account returns no result in Huasheng.
- In an isolated local demo workspace, verified that approval and dry-run actions start disabled; acknowledgement permits exact-version approval; saving an edit creates the next version and requires approval again. No external message was sent.
- Product intake, native graph query, and billing rendered successfully; the browser reported no warning/error logs during the final smoke check.

Business impact and usability improvement still require representative users and larger account volumes. Public vendor examples are not substitutes for that validation.
