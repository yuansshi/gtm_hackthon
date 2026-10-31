# Pipeline analytics

Open **Pipeline → Analytics**. Industry, tier, summary, current-stage, and search filters choose the account cohort shared by Board, List, and Analytics. The analytics activity window and activity type further restrict events and outbound records, not the underlying account population.

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

The current-stage filter can select accounts by outcome. Rates then describe that selected cohort rather than the full campaign. Milestones need not form a monotonic funnel: a quote, RFQ, or win does not fabricate earlier missing steps. The chart uses separate bars on a common contact-cohort denominator.

## Split-test boundary

Observations are grouped by channel, A/B variant, sequence step, drafting method, and delivery mode. Overlapping account audiences across rows are not additive. Explicit reply-to-draft linkage prevents a generic account reply from being credited to every variant or channel previously used for that account.

The prototype currently has no provider reply feed or UI for entering a reply-to-draft reference. Existing manual stage changes therefore remain unattributed in variant analysis. No winner, causal lift, calibrated prediction, or significance claim is made. Small samples and unequal follow-up limit comparisons.

## Evidence and validation

- Calculation source: [pipeline-metrics.js](../src/pipeline-metrics.js), based on the active business’s persisted account events and immutable outbound receipts.
- UI binding: [PipelineAnalytics.jsx](../src/PipelineAnalytics.jsx); clickable milestone rows inspect the matching account IDs and preserve source links, actor, time, and activity type.
- Eight fixed acceptance fixtures in [analytics.test.js](../tests/analytics.test.js) cover incomplete histories, rolling windows, event ordering, distinct counts, activity modes, business/cohort isolation, exact reply linkage, overlapping variants, timestamp boundaries, missing attribution, and zero denominators.
- The fixed five-account fixture has three contacted accounts and four accounts with recorded replies. Only three replies follow a qualifying contact, so the conversion rate is 3/3, rather than 4/3. Its seven-day view has two qualifying contacts and two post-contact replies, while preserving two additional reply accounts outside that contact cohort.
- A separate read-only SQLite check on October 30, 2026 found four Allco accounts, one contact-cohort account, no post-contact replies, one simulated message, and zero provider acceptances. These matched the rendered local analytics. This is a point-in-time smoke check, not a claim about later campaign data.
- Browser verification exercises industry and tier selection, time and activity modes, shared Board/List filters, milestone inspection, empty results, reset, and business switching. The production build and full existing test suite remain required before publication.

This adds inspectable operational analytics. CRM/calendar ingestion, provider delivery and reply verification, campaign IDs, mature experiment cohorts, and production user authorization remain separate work.
