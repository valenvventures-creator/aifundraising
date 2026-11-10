# A.I. Nonprofits — by Thought Authorities

A multi-tenant nonprofit operating system: donor CRM and fundraising intelligence, giving and receipts, true fund accounting, grants, projects, events, email (“A.I. Nonprofits Reach”), work and time, growth, impact, internal messages, admin/RBAC, and the permission-aware **Ask A.I. Nonprofits** question portal.

> AI here only **reads, explains, calculates, recommends and drafts**. It never sends email, texts or calls, posts or approves accounting entries, moves money, edits donor records, invites users or publishes anything. Every consequential action is a normal button pressed by a person, and AI drafts stay drafts until someone saves, sends or applies them.

## Quick start

Requirements: Node 20+ and PostgreSQL 14+ (16 recommended).

```bash
cp .env.example .env          # set DATABASE_URL, ENCRYPTION_KEY, JWT_SECRET
npm install
npm run migrate
npm run seed                  # optional demo org — demo@ainonprofits.org / demo-password-123
npm run dev                   # API on :4000, web on :5173
```

Production: `npm run build` and then `npm start`. The API serves the built web app from `dist/` on one port. You can also use `docker compose up --build`. It runs Postgres plus the app on :4000 and creates a **non-superuser** database role (required, see Security).

Tests cover ledger balancing, scoring, tenant isolation, webhook signatures, the Ask tool surface and encryption:

```bash
npm test
```

## Deploying

A.I. Nonprofits is **one Node.js server plus a PostgreSQL database**. The server serves the web pages *and* the `/api` endpoints from the same address.

- Static-only hosts (GitHub Pages, or Netlify/Vercel static sites) will show the pages, but every action fails with “Can’t reach the A.I. Nonprofits server”. Nothing answers `/api` on those hosts.
- Use a host that runs a Node service and offers Postgres, such as Render, Railway, Fly.io, a VPS, or anything that runs the included Dockerfile. Set the variables from `.env.example`, then `npm run build` and `npm start`. Migrations run automatically on start.

## Architecture

| Layer | Choice |
|---|---|
| API | TypeScript, Express, `pg` (raw SQL, numbered migrations in `server/db/migrations`) |
| Database | PostgreSQL with **row-level security on every tenant table** (`app.tenant_id` set per transaction) |
| Web | React 18, Vite, Tailwind, React Router, Recharts, Leaflet (OpenStreetMap tiles) |
| Jobs | In-process queue on `job_queue` (`FOR UPDATE SKIP LOCKED`) plus periodic automations |
| Files | Local `STORAGE_DIR` (mount a volume, or replace `saveAttachment` with S3) |
| PDF / CSV / XLSX | pdfkit, csv-stringify, exceljs |
| AI | Anthropic SDK (`claude-opus-5-5`, adaptive thinking, server-side refusal fallback). Without a key it falls back to deterministic template drafts and rule-based Q&A |

Key folders:
- `server/services/ledger.ts`: double-entry posting. **Every line must name a fund, and each fund must balance on its own**, so every fund balance can be traced to ledger lines. Gifts, expenses, payroll, invoices, bank items and refunds all post through this module.
- `server/services/intelligence.ts`: donor health, the 0–100 opportunity score (Capacity, Recency, Frequency, Recent Giving, Engagement, Momentum), suggested asks with their basis, and the Next $100K categories. These are deterministic, configurable in Settings › Fundraising rules, and never produced by AI.
- `server/services/ask.ts`: Ask A.I. Nonprofits. **Read-only tools only**, filtered by the user's permissions and workspace access. Answers return citations that link to the underlying records.
- `server/services/integrations.ts` and `server/routes/integrations.ts`: QuickBooks, Stripe, Square, PayPal, Google and Plaid.
- `server/routes/resources.ts`: generic, permission-aware CRUD for simpler entities.
- `web/src/pages/*`: the screens.

## Modules (navigation)

**Home** (workspace cards plus an aggregate dashboard and onboarding checklist) · **Donors** (Donors & Giving: Overview / Donors / Priorities / Trips / Outreach / Campaigns / Growth Audit / Reports / Receipts; Foundations & Grants; Projects; Email; Events) · **Money** (Accounting: Overview, Transactions, Post Giving, Snap & Receipt, Spend, Funds, Chart of Accounts, Budgets, Bank Feed, Journals, Giving & Receipts, Integrations, Import/Sync, Settings; Payroll; Invoices; Reports; Updates) · **Work** (Tasks, Client Work, Calendar, Communications, Time Log) · **Growth** · **Impact** · **Messages** · **Admin & Access** · **Settings** · **Ask A.I. Nonprofits**. Quick Find opens with ⌘K, Ctrl-K or `/`.

The workspace label (Ministry, Organization, Program, Chapter, Campus, and so on) is configurable per organization.

## Integrations: what you need to provide

| Integration | Status in this build | You provide |
|---|---|---|
| **Stripe** | Signed webhooks (verified with HMAC and a timestamp tolerance), idempotent ingest, donor match or create, fund/campaign mapping from metadata or defaults, refunds, disputes, failed recurring payments, and a review queue. Tested end-to-end locally with signed payloads. | Per org in Integrations: restricted API key and webhook signing secret. Then add the shown webhook URL in Stripe. |
| **Square** | Signed webhooks (HMAC-SHA256 over URL + body), payments and refunds. | Access token and signature key. |
| **PayPal** | Webhook verification through PayPal's verify API, captures, refunds and disputes. | Client ID/secret and webhook ID. |
| **QuickBooks Online** | OAuth connect, company info, account/class mapping, push of posted ledger entries as JournalEntries (idempotent via sync records and the QBO `requestid`), Sync Center (queued, errors, conflicts, retry, Sync Now, auto-sync toggle). Voids after sync are flagged as **conflicts** and never silently changed. Date-range CSV/XLSX export as a fallback. | Intuit app credentials in `.env`, plus the redirect URI. |
| **Google** | Per-user OAuth (Gmail send + Calendar events). Gmail is used as the email transport when connected. “Add to Calendar” for trips and calendar items. Disconnect revokes the token. | Google OAuth client in `.env`. |
| **Google Maps** | Trip routes open in Google Maps (no key needed). Geocoding uses the Google Geocoding API if a key is set, otherwise a built-in city gazetteer. | Optional `GOOGLE_MAPS_API_KEY`. |
| **Plaid bank feed** | Link-token, exchange and `/transactions/sync` into the review queue. CSV statement import always works. | Plaid credentials in `.env` plus a front-end Plaid Link script (not bundled). |
| **SMTP** | Server-wide email transport used when the sender has no Gmail connected. | SMTP settings in `.env`. |

The QuickBooks, Square, PayPal, Google and Plaid client code follows each provider's documented API, but **it has not been exercised against live accounts** (no credentials were available). Validate each one in its sandbox before production use. When an integration is not configured, its buttons say so instead of failing silently.

**Texts:** there is no SMS provider. The Text action opens the device's messaging app with the message pre-filled and logs it on the donor record. Adding Twilio would be a small, separate transport.

## Security model

- **Tenant isolation:** Postgres RLS with `FORCE ROW LEVEL SECURITY` on every table that has a `tenant_id`. Each request runs in a transaction with `app.tenant_id` set, so a query that forgets its tenant filter still cannot see another customer's rows (see the test). The app must connect as a **non-superuser** role, and it refuses to start in production otherwise.
- **RBAC:** 30 separately grantable permissions, eight system roles plus custom roles, and per-workspace access grants. Private donor notes, exports, finance approval, integrations and user admin are each separate permissions.
- **Financial controls:** fund self-balancing, restricted-fund overdraft blocking (an approver can override), endowment principal transfer blocking, journal approval workflow with separation of duties, and void-not-delete for posted entries.
- **Secrets:** integration credentials are AES-256-GCM encrypted (`ENCRYPTION_KEY`) and never returned to the browser. Card data is never stored.
- **Audit:** logins, exports, imports, accounting actions, access changes, integration actions and AI drafts are all written to `audit_events` (Settings › Activity history).
- **Other protections:** httpOnly SameSite cookies, an origin check on mutating API calls, rate-limited auth, CSV formula-injection escaping, upload type allow-list, and a public-form honeypot.

## Known limitations and next steps

- The job runner is in-process. For scale, run one worker (`RUN_JOBS=true`) and set `RUN_JOBS=false` on web replicas.
- Attachments are stored on local disk. Swap in object storage for multi-instance deployments.
- Email open tracking uses a pixel, so open rates are estimates. That is labelled in the UI.
- Migration presets map common column names from generic CRM and church-management exports. Vendor-specific API migrations are not included.
- Dev/staging/prod are environment-driven (`.env` per environment, the Docker image, Postgres). No CI or CD pipeline is included.
