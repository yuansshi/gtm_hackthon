# Pipeline analytics

Open **Pipeline → Analytics**. Industry, tier, summary, current-stage, sales-owner, next-action, and search filters choose the account cohort shared by Board, List, and Analytics. The analytics activity window and activity type further restrict events and outbound records, not the underlying account population.

## Definitions

| Measure | Definition |
| --- | --- |
| Accounts with activity | Distinct selected accounts with at least one matching, valid event timestamp. |
| Recorded contact cohort | Distinct selected accounts with a Contacted event inside the selected activity window and type. |
| Post-contact milestone | An event for the same account at or after its first matching Contacted event, within the same window/type. |
| Milestone rate | Post-contact milestone accounts divided by contact-cohort accounts. A zero denominator is unavailable (`—`), not 0%. |
| Recorded milestones | Distinct accounts with the event in the window/type, including incomplete or out-of-order histories. |
| Segment reply rate | Same contact-cohort definition within each industry/tier. Segment percentages are never averaged. |
| Dry-run messages | Immutable simulated outbound records in the window, counted distinctly by draft ID. |
| Live provider acceptances | Provider-accepted records in the window. This is not proof of inbox delivery. |
| Linked reply account | A reply event naming the exact outbound draft for the same account, occurring at or after that outbound record. A manual stage edit without that reference is not attributed to an A/B variant. |

Time filters use UTC instants with inclusive endpoints. The UI displays those instants in the viewer’s local timezone. The rolling window ends at the displayed observation time. Invalid and future timestamps are excluded and disclosed in data coverage; unknown attribution is included only in All recorded activity. Account and event duplication cannot multiply the new cohort calculations.

Research activity, user-reported stage edits, dry runs, and live provider events retain their recorded types. Selecting Dry runs does not include manual replies. Selecting User-reported does not silently treat a previous simulated contact as a manual contact. All recorded activity can combine those records, and an inline note identifies included simulations.

The current-stage filter can select accounts by outcome. Owner and next-action filters similarly select the current operational cohort, not a randomized or stable experiment population. Rates then describe that selected cohort rather than the full campaign. Milestones need not form a monotonic funnel: a quote, RFQ, or win does not fabricate earlier missing steps. The chart uses separate bars on a common contact-cohort denominator.

## Split-test boundary

Observations are grouped by saved value proposition, channel, A/B variant, sequence step, drafting method, and delivery mode. The value-proposition selector filters only the Sequence & variant observations table; the account cohort, milestone charts and industry/tier rates retain their existing scope. Focus comes from the immutable outbound brief, never from current account settings, copy interpretation or an A/B label. Older messages and unsupported imported focus values remain Unrecorded. New drafts and edited unsent copy do not enter these results until a dry run or provider acceptance is recorded.

The three supported focuses are application fit, supplier qualification and engineering collaboration. They are owner-selected messaging hypotheses, not verified differentiators. The actual final wording still requires human review; these rows do not establish randomized assignment or fair experiment cohorts. Overlapping account audiences across rows are not additive. Explicit reply-to-draft linkage prevents a generic account reply from being credited to every variant or channel previously used for that account.

Pipeline’s **Record outcome** dialog supports explicit user-reported or demo reply-to-draft references, notes, and optional published respondents. Actual reports can link only provider-accepted outbound records; demo reports can link only local dry runs. Existing quick stage edits without a message reference remain unattributed. No provider reply feed is connected. See [Outcome reporting](outcome-reporting.md). No winner, causal lift, calibrated prediction, or significance claim is made. Small samples and unequal follow-up limit comparisons.

## Evidence and validation

- Calculation source: [pipeline-metrics.js](../src/pipeline-metrics.js), based on the active business’s persisted account events and immutable outbound receipts.
- UI binding: [PipelineAnalytics.jsx](../src/PipelineAnalytics.jsx); clickable milestone rows inspect the matching account IDs and preserve source links, actor, time, and activity type.
- Ten fixed acceptance fixtures in [analytics.test.js](../tests/analytics.test.js) cover incomplete histories, rolling windows, event ordering, distinct counts, activity modes, business/cohort isolation, exact reply linkage, overlapping variants, timestamp boundaries, missing attribution, zero denominators, same-variant focus splits, old/unknown focus isolation, exact-focus reply attribution and exclusion of other modes/steps/methods/times/accounts.
- The fixed five-account fixture has three contacted accounts and four accounts with recorded replies. Only three replies follow a qualifying contact, so the conversion rate is 3/3, rather than 4/3. Its seven-day view has two qualifying contacts and two post-contact replies, while preserving two additional reply accounts outside that contact cohort.
- A separate read-only SQLite check on October 30, 2026 found four Allco accounts, one contact-cohort account, no post-contact replies, one simulated message, and zero provider acceptances. These matched the rendered local analytics. This is a point-in-time smoke check, not a claim about later campaign data.
- Browser verification exercises industry and tier selection, time and activity modes, shared Board/List filters, milestone inspection, empty results, reset, and business switching. The value-proposition pass also fixed outcome-history rendering during the transient profile-only business load; direct Pipeline navigation and Allco/Huasheng switching were rechecked afterward. The production build and full existing test suite remain required before publication.

This adds inspectable operational analytics. CRM/calendar ingestion, provider delivery and reply verification, campaign IDs, mature experiment cohorts, and production user authorization remain separate work.

Owner and next-action controls, free manual save history, UTC due-date storage and shared account filters are documented in [Lead management](lead-management.md). Task completion itself adds no contact/reply/stage event or conversion credit.
