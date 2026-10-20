# Workflow stage funnel

The Workflows tab now includes a workflow selector, stage reach funnel, per-step result counts and a clickable contact/run drilldown. It uses the existing GHL browser log feed; no changes to individual automations or new provider credentials are required.

## Deploy

1. Deploy this complete project to the existing Netlify site using its existing environment variables and build settings. This includes the new `workflow-progress` function and its redirect, plus the updated browser script. Do not deploy only the `public` folder: the backend changes are required too.
2. Close or reload every GHL tab running the old feed, and reload the dashboard. Keep GHL open in the configured location with an authenticated session. The existing Custom JS script URL and feed key continue to work. If the old script is cached, add `?v=stage-progress-1` to its script URL in agency Custom JS and reload GHL.
3. The next eligible feed run resets scan cursors once and replays the last 30 days using the existing request budget and resumable paging. Daily totals and dedupe records are preserved. Large histories can need several feed intervals; the funnel shows a catching-up notice while its workflow has pending pages.
4. Open Workflows, choose a workflow and the date period, and click a step to inspect its runs. Validate a known contact/run against GHL's execution log before relying on live counts.

Nothing has been deployed from this local copy. Local preview and tests use made-up data or mocked HTTP calls.

## How to interpret it

- A run is identified by workflow ID plus GHL workflow status/run ID. Repeat enrollments of one contact count separately. Rows missing a run ID cannot contribute to the funnel.
- The period selects runs by their earliest **observed log timestamp**, in the dashboard's time zone. It does not claim to know their true enrollment dates. Backfills can move this date earlier. Later observed events update the same cohort, including completions after the selected period.
- A step counts each run once, even with loops, retries or replayed log rows. Reached includes success, failure and skip observations. The adjacent table distinguishes them; a retry can produce both success and failure for one run.
- Steps are ordered by median elapsed time from first observation. This is inferred log order, not a downloaded workflow graph. Alternate branches may widen the funnel. No sequential conversion rate is inferred between adjacent bars.
- The feed preserves action/step IDs when GHL supplies them. Otherwise steps are grouped by name and action type. Identical names/types without IDs merge; renamed steps without IDs may split. The footer calls out this fallback.
- Latest observed activity is not proof of current enrollment or waiting. Only observed end-of-workflow/finished records count as completed. Missing completion does not imply a run is active.
- Progress for runs without activity in 90 days is removed. Existing historical daily totals remain available under their original retention. YTD funnel counts can be partial. Recovered history initially covers only the 30-day replay window.
- The existing feed's browser dependency remains: it runs only with GHL open, a valid session and the correct location. Internal GHL log formats/endpoints can change; live validation of action IDs and statuses is required.

## Efficiency and reliability

- The existing incremental windows, overlap deduplication, shared request budget, tab lease and resumable backfill are retained.
- Per-run progress stores compact first/last timestamps and result flags per step instead of full raw execution logs or message bodies.
- Normal dashboard responses omit run history. The authenticated `/api/workflow-progress` endpoint calculates one selected workflow/period on demand and returns at most 200 contact details. Narrow the period for additional detail.
- Browser batches save sequentially. Scan cursors commit only after earlier batches succeed. HTTP failures stop the send chain, so rejected batches can be replayed without falsely advancing the cursor.

## Validation

Run `npm install`, `npm test` and `npm run build` with Node 22 or later. `npm run sandbox` serves the dashboard locally with sample workflow stage histories. Added tests cover reverse-order events, retries and deduplication, repeat enrollments, branches, duplicate step names, Pacific cohort dates, one-time migration, retention, bounded authenticated reads, sequential browser batches and rejected-ingest recovery.

Verified locally: all 45 tests passed, build syntax checks passed, and the funnel, stage drilldown and empty workflow state were inspected in the browser using sample data. Live GHL validation and deployment remain outstanding.

## Follow-up: clearer collection status (1.11.1)

The selector now prefers workflows with tracked runs and shows tracked versus aggregate counts for the period. Empty states distinguish no collected history, a pending backfill, scan errors, workflows not scanned yet, and aggregate-only history. A compact per-day progress summary supports selection without downloading contact history. All 48 tests passed, and the updated selector was checked locally. The deployed original funnel was also checked after sign-in and showed saved stage history for the workflow reported as empty earlier. These follow-up changes have not been deployed.
