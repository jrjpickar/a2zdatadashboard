# A2Z Operations Dashboard (KPI) 1.1

KPI dashboard for A2Z, built like the LCP Dial Intelligence dashboard: Today / WTD / MTD / YTD in Pacific time, a rep filter, Data Quality, A2Z's orange GHL theme, embedded in GHL as a Custom Page.

**Tabs:** Overview · Leads (speed to lead, inbound calls, action queue, funnels) · Estimates (turnaround, win rate by service / customer type, pipeline, lost reasons) · Work (jobs, backlog, trucks and containers) · Crews & Hiring (crew utilization, labor pool, hiring funnel) · Workflows · Money (admins) · Data Quality · Users (admins). Senior admins can move, hide, rename and resize any tile (Customize tiles). Leads tab opens with per-pipeline funnels shaped like the LCP acquisition funnel; each funnel branches below the trunk to show where the non-won leads went (still open, plus each dead stage — Priced too low, Proposal Declined -Cold/Warm/Hot, Ghosted …).

**Sources** (each synced into Netlify Blobs every ~30 min, or on Refresh live data):

| Source | What it gives |
|---|---|
| GHL API | Opportunities in Demo, Labor, Containers, Change Orders and Hiring; contacts (contact type, source, temperature); users; conversations (first reply) |
| Twilio | Inbound answered / missed, callbacks, outbound calls as replies |
| Dispatch board 1.9 `/api/metrics-export` | Jobs, crew per day, container and truck runs, who booked what, EOD sheet costs |
| Ledger `/api/metrics-export` | Invoice columns + dates, generated invoices, bills, BBSI payroll |

Nothing is written to GHL, Twilio, the dispatch board or the Ledger.

- `npm run sandbox` opens the real page with made-up sample data at http://127.0.0.1:4174 (no credentials, no provider calls).
- `npm test` runs the metric and sync tests. `npm run build` syntax-checks everything.
- Deploy steps and every environment variable: **DEPLOY.md**.
- How each number is counted is on the Data Quality tab.
