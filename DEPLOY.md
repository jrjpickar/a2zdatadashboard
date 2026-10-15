# Deploy the A2Z KPI dashboard

Three projects ship together. Deploy the dispatch board and Ledger updates first (each only adds a read-only feed), then the dashboard.

## 1. Dispatch board 1.9 (existing site)

1. Replace the repo contents with `a2z-dispatch-board-1.9`, deploy as usual (same site, same database).
2. Add env var **`METRICS_EXPORT_KEY`** = a long random string (`openssl rand -hex 32`). Redeploy.
3. New tables are created on the first request. From now on, Complete EOD Sheet and move Reset day / Complete keep their history. Days worked since 1.8 are rebuilt automatically from the Make job-log payloads.

## 2. Ledger (existing site)

1. Replace the repo contents with `a2zaccounting` (adds `netlify/functions/metrics-export.mts` only), deploy.
2. Add env var **`METRICS_EXPORT_KEY`** = another long random string. Redeploy.

## 3. KPI dashboard (new Netlify site)

1. New site from `a2z-kpi-dashboard`. Build `npm run build`, publish `public`, functions `netlify/functions`, Node 22+.
2. Environment variables (Functions scope):

| Variable | Required | Value |
|---|---|---|
| `GHL_API_TOKEN` | yes | Private Integration token for the A2Z location. Scopes: opportunities.readonly, contacts.readonly, users.readonly, locations/customFields.readonly, conversations.readonly, conversations/message.readonly |
| `GHL_APP_SHARED_SECRET` | yes | Shared Secret of the private Marketplace app (same one the dispatch board / dialer uses is fine) |
| `SESSION_SECRET` | yes | Long random string |
| `SYNC_SECRET` | yes | Long random string (lets the scheduler start the background sync) |
| `TWILIO_ACCOUNT_SID` | yes | The account / subaccount A2Z's numbers live in (AC…) |
| `TWILIO_AUTH_TOKEN` | yes | Its auth token (or use `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET`) |
| `TWILIO_NUMBERS` | recommended | A2Z's inbound numbers, comma separated, e.g. `+19497763898`. Blank = every inbound call in the account |
| `DISPATCH_URL` | yes | e.g. `https://your-dispatch-site.netlify.app` |
| `DISPATCH_EXPORT_KEY` | yes | Same value as the dispatch site's `METRICS_EXPORT_KEY` |
| `LEDGER_URL` | yes | e.g. `https://your-ledger-site.netlify.app` |
| `LEDGER_EXPORT_KEY` | yes | Same value as the Ledger's `METRICS_EXPORT_KEY` |
| `DASHBOARD_OWNERS` | optional | Extra senior admins by email (jesse@a2zcs.net is always one). Everyone else is added on the Users tab |
| `DASHBOARD_PIN` | optional | PIN for signing in outside GHL (never gets owner rights) |
| `GHL_WEBHOOK_SECRET` | optional | Turns on `/api/ghl-webhook` for exact stage-change times (below) |

Defaults you only change if GHL changes: `GHL_LOCATION_ID` (QUcu2PEAxPV1sQm1GQCq), `DEMO_PIPELINE_ID`, `LABOR_PIPELINE_ID`, `CONTAINER_PIPELINE_ID`, `CHANGE_ORDER_PIPELINE_ID`, `HIRING_PIPELINE_ID` (VMYXilFR93XJEgprCi7j), `PROPOSAL_STAGE_NAMES` (Proposal Sent, Send Packet, CO Sent — the estimate-sent stage in each pipeline: Demo/Containers "Proposal Sent", Labor "Send Packet", Change Orders "CO Sent"), `JOB_COMPLETED_STAGE_NAMES` (Job Completed, Completed — Demo/Labor/Containers use "Job Completed", Change Orders uses "Completed"; drives Jobs completed), `LOST_STAGE_NAMES` (Priced Too Low, Ghosted, Declined, Proposal Declined -Cold/-Warm/-Hot, … — terminal dead-deal stages; an opp in one counts as lost even if still Open, and the stage becomes the lost reason), `CUSTOMER_CONTACT_TYPES` (General-contractor,Developer,Home-owner), `LABORER_CONTACT_TYPES` (Laborer), `CONTACT_TYPE_FIELD_ID` (blank = a custom field named "Contact Type", else GHL's built-in type), `GHL_TEMPERATURE_FIELD_ID` (xOi9gCcAt2UvgA6POHMB), `ACTIVE_TEMPERATURES` (Warm,Hot,VIP), `DORMANT_TEMPERATURES` (Cold), `SYNC_INTERVAL_MINUTES` (30, 6am–9pm Pacific), `OFF_HOURS_SYNC_MINUTES` (120, overnight), `CONTACTS_FULL_SYNC_HOURS` (6; in between only new contacts are looked up), `RESPONSE_LOOKBACK_DAYS` (120), `TWILIO_HISTORY_DAYS` (400), `TWILIO_ANSWER_MIN_SECONDS` (20, only used if calls aren't forwarded).

3. Deploy. Check that the `sync-schedule` scheduled function exists (production deploys only).
4. GHL: in the private Marketplace app add a **Custom Page** (left nav) with the new site URL. Update the app installation for A2Z.
5. Open it in GHL → **Refresh live data**. The first sync takes a few minutes (all contacts, all opportunities, 400 days of Twilio calls). Then open **Data Quality**: every feed should say OK and "Estimate-sent stages" should list Demo, Labor, Containers and Change Orders.
6. Open **Settings** (owners) and enter how many containers you own per size, the rental days before a pickup is past due, business hours and work days.

### Optional: exact stage-change times

Without this, stage changes are noticed on the next sync (≤30 min). For exact times: GHL workflow, trigger **Pipeline Stage Changed** (Demo, Labor, Containers, Change Orders), action **Webhook** POST to `https://<kpi-site>/api/ghl-webhook?key=<GHL_WEBHOOK_SECRET>` with custom data `opportunity_id = {{opportunity.id}}` and `stage_name = {{opportunity.pipeline_stage}}` (plus `pipeline_id = {{opportunity.pipeline_id}}`).

## Workflow stats (GHL automation)

GHL's automation overview numbers (enrollments, finished, skipped/failed steps, trigger match rate) are only available from GHL's internal API, which needs a logged-in user's session. Two parts:

### Workflow names (public API)
Add the **workflows.readonly** scope to `GHL_API_TOKEN`. The normal sync then lists every workflow (name, published/draft) and the Workflows tab shows published vs. total. Nothing else to do.

### Run stats (in-GHL feed script)
`public/ghl-workflow-feed.js` ships with the dashboard. Loaded through GHL's **agency Custom JS**, it runs inside GHL, reuses the signed-in user's live session (it reads the Authorization header off GHL's own requests as they happen — nothing is stored, and it rotates automatically with the session), and every ~30 minutes — in only one open tab at a time, chosen by the dashboard — reads new workflow log rows and the overview numbers and posts slim rows (no message text) to `/api/workflow-feed`.

1. Set **`WORKFLOW_FEED_KEY`** on the KPI site (Functions scope) to a long random string (`openssl rand -hex 32`).
2. In GHL: **Agency view → Settings → Company → Custom JS** (or the location's Custom JS), add:
   ```html
   <script src="https://YOUR-KPI-SITE.netlify.app/ghl-workflow-feed.js"
           data-key="YOUR_WORKFLOW_FEED_KEY"
           data-location="QUcu2PEAxPV1sQm1GQCq" async></script>
   ```
   Use the same key as `WORKFLOW_FEED_KEY`. Optional data- attributes: `data-check-minutes` (default 5, how often a tab checks whether it's its turn), `data-max-requests` (default 160, GHL requests per run), `data-pause-ms` (default 300).
3. Reload GHL. Within a minute or two the Workflows tab's "Feed updated" tile should show a recent time. To check immediately, open the browser console on a GHL page and run `__a2zWorkflowFeedRun()`.

Notes:
- The feed only updates while someone has GHL open. The Workflows tab flags stale data.
- It uses GHL's undocumented internal API; a GHL change could pause it until the script is adjusted. It fails quietly and the tab shows the feed as stale.
- `data-key` is visible to anyone who can read the Custom JS. The key only lets a browser *add* workflow stats to `/api/workflow-feed`; it cannot read any dashboard data. Rotate it by changing `WORKFLOW_FEED_KEY` and the snippet together.
- First run backfills 30 days per workflow, then only new rows. A run cut short by the request budget resumes exactly where it left off.

## Users and roles

- **Senior admin**: jesse@a2zcs.net (built in) plus `DASHBOARD_OWNERS`. Can't be removed. The only role that adds, changes or removes admins.
- **Admin**: sees Money, Settings and the Users tab; adds and removes viewers.
- **Viewer**: everything else.
- Add people on the **Users** tab (pick a GHL user or type an email). Anyone not on the list who opens the dashboard is refused and shows up under "Asked for access" with a one-click Add.
- A PIN sign-in is always viewer level.

## Customizing tiles (senior admins)

A **Customize tiles** button appears in the top bar for senior admins only. In customize mode, every tile (KPI stat or card) on every tab can be:

- **Moved** — drag the ⠿ handle to reorder within its row/section.
- **Removed / restored** — the × hides a tile; hidden tiles stay dimmed in customize mode with a ＋ to bring them back.
- **Renamed** — click a tile's title and type.
- **Resized** (cards only) — ‹› narrower / ⟷ wider across the 12-column grid.

The layout is one shared setting (stored via `/api/layout`, senior-only to write) so everyone sees the same board; viewers and admins can't change it. "Reset this tab" clears the tab's customizations. Changes save automatically.

## Action queue edits (admins)

Done, Dismiss and Snooze (to a date) on each queue item. An edit holds until GHL shows something new on that lead or caller (call, text, email, stage or status change), then the item comes back if it still applies. Edits are shared and kept 180 days. A conversation opened (read) in GHL also takes its item out ("Read in GHL" chip); this needs the token's conversations.readonly scope.

## What to know

- **Dead-deal stages are counted as lost.** Any opportunity sitting in a terminal stage like **Declined, Priced Too Low, Ghosted** (set `LOST_STAGE_NAMES` to match your stage names) counts as **lost** — even if GHL still shows it Open — and the stage name becomes its lost reason. These drop out of open pipeline, the action queue and backlog, and feed win rate and the Lost reasons breakdown. Data Quality lists the stages it detected and flags any dead-stage opps you haven't also marked Lost in GHL.
- **Jobs completed** counts GHL opportunities in Demo, Labor, Containers or Change Orders that are marked **Won** and sitting in a **Job Completed** stage (set `JOB_COMPLETED_STAGE_NAMES` if your stage is named differently), dated by when they entered that stage. It's a GHL-pipeline number, not the dispatch board's Completed button. "Finished on scheduled date" still comes from the board, since only the board has scheduled dates. If no Job Completed stage is found, Data Quality flags it and the count reads 0.
- **History starts at deploy for three things.** GHL keeps no stage history, so Proposal Sent dates are recorded from the first sync (earlier ones use GHL's last stage change). Hire dates (laborer turned warm/hot/VIP) start at the first sync; laborers already warm+ count as active with no hire date. Container/truck runs are exact from dispatch 1.9; earlier closed container moves use their close date.
- **First response** = first human outbound touch: Twilio call, or GHL SMS / email / call. Workflow, bulk and campaign messages don't count. Measured in business hours.
- **Answered calls**: a forwarded leg connected. If A2Z's Twilio setup doesn't forward (e.g. a TwiML app rings browsers), the Data Quality tab shows the detection mode; tell me and I'll adjust.
- **Revenue booked** uses GHL opportunity values. **Money** uses the Ledger and is owners only (also enforced on the server).
- Netlify usage: one background sync every 30 minutes (a few minutes of function time), Blobs storage, and the page loads one gzip snapshot.
