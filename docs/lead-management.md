# Sales ownership and manual follow-ups

In **Pipeline**, each account’s Board card and List row shows its sales owner and next action. Choose **Manage follow-up** to assign an owner, write the next step, optionally set a due date, or mark the task complete. Blank owner means Unassigned; blank action clears the current task. Saves are free and appear in workspace activity and the account’s recent history.

These are manual operating records. A due date does not schedule outreach, a calendar reminder or a notification. Completing a task does not advance its pipeline stage or authorize a message. Use the existing HITL workflow to approve and dispatch an exact message; stage/outcome recording remains separate.

## Shared filters and dates

Sales owner and Next action filters apply to the same account cohort across Board, List and Analytics. Open includes overdue tasks; Overdue excludes completed tasks. No next action selects accounts without a task. Pipeline search also matches owner names. Clear account filters resets the owner/task criteria alongside the existing cohort filters. If a selected owner has no current accounts after an edit, its empty selection remains explicit rather than silently showing all owners.

Due inputs and displays use the viewer’s local timezone; the server stores a canonical UTC timestamp, including milliseconds. Owner-only changes preserve the exact existing due instant and task ID. Overdue status uses the viewer’s device clock and refreshes once per minute. Completed tasks retain their due time and completion timestamp; reopening clears completion. Changing action text or its due time creates a new task identity. Dates do not establish a customer commitment or verified buying signal.

Analytics rates describe the selected owner/task cohort, not overall campaign conversion or a causal ownership effect. Current-owner and overdue selection can bias that population. The global historical activity totals remain labeled as all-account totals. Sequence value-proposition filtering still applies only to its own observation table.

## Persistence, scope and review

`PATCH /api/businesses/:business/leads/:lead/management` accepts strict typed inputs: request UUID, workspace revision, expected management version, owner name (80 characters maximum), and either a null task or text (500 characters maximum), canonical UTC due timestamp/null, and open/completed status. Normal session, CSRF, origin and business-scoped ID checks apply. The operation cannot update recipients, message approval, stage, buying evidence or credits.

The server records a version, actor/time and the newest 20 assignment/task snapshots. A matching retained request ID returns current state without reapplying an old owner or adding activity; reuse for different content is rejected. Outside that retained window, stale revisions/versions still reject old work. Concurrent edits show an error while preserving the form; **Reload latest · discard edits** explicitly reloads the current owner/task before another save. A reset/recreated account cannot accept an old request with its previous workspace revision.

Ownership is a recorded display name, not a verified user identity or a permission grant. “You” in history identifies the shared project session. Per-user authentication, team directories and CRM synchronization are not implemented. Account tasks/history persist in SQLite and across container recreation. Campaign reset removes these account records and their recent task history. No task state is automatically restored from browser backups or source proposals; existing assignments survive research refreshes.

Owner names, task text and task history stay outside model payloads, Band public packets and native graph results. Task edits do not invalidate exact outreach approval because they do not change the copy or evidence used by it. They do not change the graph-input fingerprint. Research proposals cannot assign owners or replace local task metadata. Existing source, preference and exact-message gates still apply to outreach.

## Verification

Eleven management tests cover free assignment/completion without stage/approval changes; clearing/reopening/history bounds; request replay/conflict; stale/reset protection; strict input/scoped IDs; research preservation; model, exact Band packet and native graph privacy; authenticated HTTP/CSRF; overdue/cohort boundaries; and exact timestamp/history persistence after closing/reopening the store. The full suite has 331 passing tests and the production build passes.

Desktop checks use an isolated synthetic workspace. They exercise owner editing, preservation of exact due milliseconds and the original dry-run receipt, shared Board/List/Analytics filters, concurrent-edit rejection/reload, completed/reopened tasks, local-time date entry, clearing/unassignment and business switching. The date-input check caught and fixed missing input-event handling before publication. The deployment probe additionally persists an owner/task across native process and Linux container recreation. No actual prospect assignment, stage change, live provider call or external message is made in the main workspace by these checks.
