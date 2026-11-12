# A.I. Fundraising

A multi-tenant nonprofit operating system: donor CRM and fundraising intelligence, giving and receipts, true fund accounting, grants, projects, events, email (“A.I. Fundraising Reach”), work and time, growth, impact, internal messages, admin/RBAC, and the permission-aware **Ask A.I. Fundraising** question portal.

> AI here only **reads, explains, calculates, recommends and drafts**. It never sends email, texts or calls, posts or approves accounting entries, moves money, edits donor records, invites users or publishes anything. Every consequential action is a normal button pressed by a person, and AI drafts stay drafts until someone saves, sends or applies them.

## Quick start

Requirements: Node 20+ and PostgreSQL 14+ (16 recommended).

```bash
cp .env.example .env          # set DATABASE_URL, ENCRYPTION_KEY, JWT_SECRET
npm install
npm run migrate
npm run seed                  # optional demo org — demo@aifundraising.org / demo-password-123
npm run dev                   # API on :4000, web on :5173
```

Production: `npm run build` and then `npm start`. The API serves the built web app from `dist/` on one port. You can also use `docker compose up --build`. It runs Postgres plus the app on :4000 and creates a **non-superuser** database role (required, see Security).

Tests cover ledger balancing, scoring, tenant isolation, webhook signatures, the Ask tool surface and encryption:

```bash
npm test
```

## Deploying on Netlify

A.I. Fundraising uses the same model as the other Thought Authorities sites (A.I. C-Suite and A.I. IPO): **Netlify Functions** for the app, **Netlify Database** for accounts and data, and **Netlify Blobs** for uploaded files and keys.

The functions use Netlify's modern format (`export default` with a `config` route), like A.I. IPO. The build compiles the server into `netlify/server-dist/app.mjs` (`npm run build:netlify`). `netlify/functions/api.mts` serves `/api/*`, `/webhooks/*` and `/t/*`, and `netlify/functions/jobs.mts` runs the automations every minute.

1. In Netlify, choose **Add new project → Import an existing project → GitHub → your repository**, or link the repository to an existing project. `netlify.toml` sets up the build, so leave the build command and publish directory empty in the Netlify UI.
2. **Netlify Database is set up automatically on deploy**, because the project depends on `@netlify/database` and has a migration in `netlify/database/migrations/` (the same convention as the other sites). If no database appears, create one in Netlify under **Data & Storage → Database** and redeploy. Netlify then provides `NETLIFY_DB_URL`, and the app creates the rest of its tables on first use. Netlify Database requires a credit-based Netlify plan.
3. **Deploy.** Every build runs the test suite first, and a failing test stops the deploy.

> **Never edit a file in `netlify/database/migrations/` after it has been deployed**, even a comment. Netlify records each applied file and stops the deploy if one changes. Add a new migration folder instead. (The app's own tables live in `server/db/migrations/`.)

You don't need to set any variables to get started. Open the site and choose **Create your organization**.

**Optional environment variables** (*Site configuration → Environment variables*):

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | Turns on password-reset, invitation, receipt and campaign emails. These are the same names as the other sites. `EMAIL_FROM` must use a domain verified in Resend. |
| `ANTHROPIC_API_KEY` | Turns on AI answers in Ask A.I. Fundraising and AI-written drafts. Without it, those features use built-in reports and templates. |
| `JWT_SECRET`, `ENCRYPTION_KEY` | Your own keys. If they're unset, each is generated once and kept in a private Netlify Blobs store, separate from the database. **Never change or delete `ENCRYPTION_KEY` once data exists**, or saved integration credentials become unreadable. |
| `QBO_*`, `GOOGLE_*`, `PLAID_*` | QuickBooks, Google (Gmail/Calendar/Maps) and bank-feed connections. See `.env.example`. |
| `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET` | One-click **Connect with Stripe** (Stripe Connect OAuth). Register redirect URI `https://<site>/api/integrations/stripe/callback` and a Connect webhook at `https://<site>/webhooks/stripe-connect` listening to events on connected accounts. |
| `SQUARE_APPLICATION_ID`, `SQUARE_APPLICATION_SECRET`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_ENVIRONMENT` | One-click **Connect with Square** (Square OAuth). Redirect URL `https://<site>/api/integrations/square/callback`; webhook subscription at `https://<site>/webhooks/square-app`. |
| `DATABASE_URL` | Use your own PostgreSQL database instead of Netlify Database. |
| `LEGAL_COMPANY_NAME`, `LEGAL_CONTACT_EMAIL`, `LEGAL_ADDRESS`, `LEGAL_GOVERNING_LAW`, `LEGAL_EFFECTIVE_DATE` | Details shown on the public End-User License Agreement (`/terms`) and Privacy Policy (`/privacy`) pages, e.g. `LEGAL_GOVERNING_LAW` = `the Province of Ontario, Canada`. |

**Email.** Without Resend (or a user's connected Gmail), the app still works. *Forgot password* explains that email isn't set up and never shows reset links on screen, and invitations give the administrator a private link to share.

**Demo data (optional).** From a computer with this repository, run `DATABASE_URL="<connection string>" npm run seed`, then sign in as `demo@aifundraising.org` / `demo-password-123`.

**Netlify limits.**
- **Requests:** each request has about 10 seconds on standard plans (Netlify support can raise it to 26). AI answers and drafts, very large exports and big imports may need longer.
- **Uploads:** up to about 4 MB per file.
- **Background work:** runs once a minute in short batches, so scheduled emails and journey steps can start up to a minute late.
- **Organization isolation:** the app creates a restricted database role, `ainp_rls`. If the database doesn't allow that, the API refuses to start and says why.

## Deploying on a Node host (alternative)

The app is also a single Node.js server plus PostgreSQL that serves the pages and `/api` from one address. You can run it on Render, Railway, Fly.io, a VPS, or anything that runs the included Dockerfile. Set the variables from `.env.example`, then run `npm run build` and `npm start`. Migrations run automatically on start. A purely static host (such as GitHub Pages) won't work, because nothing would answer `/api`.

## Architecture

| Layer | Choice |
|---|---|
| API | TypeScript, Express, `pg` (raw SQL, numbered migrations in `server/db/migrations`) |
| Database | PostgreSQL with **row-level security on every tenant table** (`app.tenant_id` set per transaction) |
| Web | React 18, Vite, Tailwind, React Router, Recharts, Leaflet (OpenStreetMap tiles) |
| Jobs | Queue on `job_queue` (`FOR UPDATE SKIP LOCKED`) plus periodic automations — in-process on a Node host, a Netlify Scheduled Function on Netlify |
| Files | Local `STORAGE_DIR`, or Netlify Blobs when running on Netlify (`server/lib/storage.ts`) |
| PDF / CSV / XLSX | pdfkit, csv-stringify, exceljs |
| AI | Anthropic SDK (`claude-opus-5-5`, adaptive thinking, server-side refusal fallback). Without a key it falls back to deterministic template drafts and rule-based Q&A |

Key folders:
- `server/services/ledger.ts`: double-entry posting. **Every line must name a fund, and each fund must balance on its own**, so every fund balance can be traced to ledger lines. Gifts, expenses, payroll, invoices, bank items and refunds all post through this module.
- `server/services/intelligence.ts`: donor health, the 0–100 opportunity score (Capacity, Recency, Frequency, Recent Giving, Engagement, Momentum), suggested asks with their basis, and the Next $100K categories. These are deterministic, configurable in Settings › Fundraising rules, and never produced by AI.
- `server/services/ask.ts`: Ask A.I. Fundraising. **Read-only tools only**, filtered by the user's permissions and workspace access. Answers return citations that link to the underlying records.
- `server/services/integrations.ts` and `server/routes/integrations.ts`: QuickBooks, Stripe, Square, PayPal, Google and Plaid.
- `server/routes/resources.ts`: generic, permission-aware CRUD for simpler entities.
- `web/src/pages/*`: the screens.

## Modules (navigation)

**Home** (workspace cards plus an aggregate dashboard and onboarding checklist) · **Donors** (Donors & Giving: Overview / Donors / Priorities / Trips / Outreach / Campaigns / Growth Audit / Reports / Receipts; Grants; Projects; Email; Events) · **Money** (Accounting: Overview, Transactions, Post Giving, Snap & Receipt, Spend, Funds, Chart of Accounts, Budgets, Bank Feed, Journals, Giving & Receipts, Integrations, Import/Sync, Settings; Payroll; Invoices; Reports; Updates) · **Work** (Tasks, Client Work, Calendar, Communications, Time Log) · **Growth** · **Impact** · **Messages** · **Admin & Access** · **Settings** · **Ask A.I. Fundraising**. Quick Find opens with ⌘K, Ctrl-K or `/`.

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
- On a Node host, attachments are stored on local disk. Use a persistent volume, or move to object storage for multi-instance deployments.
- Email open tracking uses a pixel, so open rates are estimates. That is labelled in the UI.
- Migration presets map common column names from generic CRM and church-management exports. Vendor-specific API migrations are not included.
- Dev/staging/prod are environment-driven (`.env` per environment, the Docker image, Postgres). No CI or CD pipeline is included.
