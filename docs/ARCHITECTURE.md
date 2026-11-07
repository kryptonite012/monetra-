# Architecture

## System overview

```
 Browser (Next.js app)
   │  same origin: /, /api/*
   ▼
 Nginx ──────────────► web  (Next.js standalone server, :3000)
   │
   └── /api/* ───────► api  (Express 5 REST API, :4000) ───► PostgreSQL 16
                          │                                   ▲
                          ├── Redis 7 (rate limits, cache, queues)
                          │                                   │
                       worker (BullMQ) ───────────────────────┘
                          └── reminders, recurring entries, anomaly alerts,
                              budget alerts, net-worth snapshots, retention
```

- The **web app** renders in the browser and calls the REST API. In
  development, the Next.js server proxies `/api`. In production, Nginx routes
  it. Either way the browser sees one origin, so the refresh cookie can be
  `SameSite=Strict`.
- The **API** is stateless apart from PostgreSQL and Redis, so it scales
  horizontally.
- The **worker** runs scheduled maintenance. A PostgreSQL advisory lock
  ensures only one instance runs a batch, even with several workers or with
  the inline scheduler (`JOBS_MODE=inline`, used for single-node setups).

## Backend layout (`backend/src`)

| Path | Responsibility |
| --- | --- |
| `config/env.ts` | Validated configuration. The process refuses to start with unsafe production settings. |
| `lib/` | Shared primitives: `money.ts` (decimal maths), `crypto.ts` (scrypt, AES-GCM, tokens), `totp.ts`, `http.ts` (typed route builder), `dates.ts`, `uploads.ts`, `mailer.ts`, `sms.ts`, `cache.ts`, `sensitive.ts` |
| `middleware/` | Auth (JWT + live session check), RBAC, security headers, CORS, rate limits, CSRF, error handling |
| `engine/` | Pure financial formulas (EMI, interest, XIRR, ratios, projections, health score). See [CALCULATIONS.md](CALCULATIONS.md) |
| `modules/<domain>/` | One folder per domain: routes (HTTP + validation) and services (business logic) |
| `jobs/` | Scheduled tasks and the BullMQ / inline schedulers |
| `db/` | Knex connection, migrations, demo seed |
| `docs/openapi.ts` | Builds the OpenAPI 3.1 document from the registered routes |

### Typed route builder

Every endpoint is declared once through `apiRouter()`:

```ts
r.post('/transfer', {
  summary: 'Transfer money between your accounts',
  status: 201,
  body: z.object({ fromAccountId: z.uuid(), toAccountId: z.uuid(), amount: positiveMoney }),
  handler: ({ user, body }) => …,
});
```

The same zod schema does three jobs: it validates the request at runtime, types
the handler at compile time and generates the OpenAPI documentation. Endpoints
require authentication by default. `public: true` opts out, and `roles` limits
an endpoint to particular roles.

## Data model

All tables use UUID primary keys and `timestamptz` audit columns. Money is
always `NUMERIC(19,4)`. Business dates are `date` columns, so there is no
time-zone drift.

```
users ─┬─ user_profiles
       ├─ sessions (refresh-token families) ── auth_tokens, mfa_recovery_codes, login_events
       ├─ accounts ─┬─ account_balances (statement reconciliations)
       │            └─ transactions (immutable ledger) ◄─┬─ income_records
       │                                                ├─ expense_records ─┬─ expense_splits
       │                                                │                  └─ receipts
       │                                                ├─ loan_installments ── loans
       │                                                ├─ investment_transactions ── investments
       │                                                └─ bill_payments ─┬─ bills
       │                                                                  └─ subscriptions
       ├─ transaction_categories (system tree + custom), merchants, categorization_rules
       ├─ payment_methods (UPI IDs, card last-4 only)
       ├─ recurring_rules, budgets ── budget_categories
       ├─ savings_goals ── goal_contributions
       ├─ assets, liabilities, net_worth_snapshots
       ├─ notifications, financial_reports
audit_logs (append-only, deliberately no FK so it outlives deleted rows)
```

### The ledger

`transactions` is the single source of truth for balances:

```
balance(account) = opening_balance + Σ credits − Σ debits
```

- **Immutability.** A `BEFORE UPDATE` trigger rejects any change to amount,
  direction, account, date, reference and similar fields. Only annotations
  (category, merchant, notes, tags) may change. A `BEFORE DELETE` trigger
  blocks deletes, except inside the sanctioned purge path used by account
  deletion (`SET LOCAL monetra.allow_ledger_purge = 'on'`).
- **Reversals.** A reversal posts an equal and opposite entry, links it with
  `reversal_of_id`, and moves the original from `posted` to `reversed`. That
  transition is one-way and enforced by a trigger. Transfers are reversed as a
  pair.
- **Corrections.** A correction is a reversal plus a replacement entry with
  `supersedes_id`. Income and expense records keep a stable id and point at
  the latest ledger entry.
- **Concurrency.** Postings lock the account row (`SELECT … FOR UPDATE`), so
  concurrent writes to one account are serialised.
- **Analytics** exclude reversed entries and reversals (`status = 'posted' AND
  kind <> 'reversal'`). Balances include both, so they net to zero.

Higher-level modules (income, expenses, bills, loans, goals, investments,
liabilities, splits) never write balances themselves. They post ledger entries
through `postTransaction` / `postTransfer` inside the same database
transaction as their own records.

## Authentication flow

1. `POST /auth/login` checks the password. Failures count towards a temporary
   lockout. If two-factor is enabled, it returns a short-lived `mfaToken`
   instead of a session.
2. On success the API creates a `sessions` row, returns a 15-minute JWT access
   token in the body, and sets a 30-day refresh token in an httpOnly,
   `SameSite=Strict` cookie scoped to `/api/v1/auth`.
3. The web app keeps the access token **in memory only**. On load, or when the
   token expires, it calls `POST /auth/refresh` with the CSRF header. This
   rotates the refresh token.
4. Each request verifies the JWT **and** checks that the session is still
   active, so revoking a device takes effect immediately.
5. If a rotated refresh token is presented more than 30 seconds after
   rotation, the API treats it as theft: it revokes the whole token family and
   alerts the user. Inside that window it mints a sibling token, which covers
   multiple tabs and reloads that interrupted a refresh.

## Caching

Dashboard aggregates are cached in Redis per user. Every ledger write
increments the user's cache version (`cache:v:<user>`), which invalidates their
cached aggregates immediately without key scans. Without Redis the cache is
simply skipped.

## Background jobs

| Task | What it does |
| --- | --- |
| `recurring` | Posts due recurring income and expenses (catching up missed runs), or sends a reminder when auto-post is off |
| `billReminders`, `subscriptionReminders`, `emiReminders` | Notify before due dates and when payments are overdue |
| `budgetAlerts` | Threshold and overspend alerts per budget category |
| `unusualSpending` | Flags expenses at least 3× the user's typical spend that are not recurring |
| `netWorthSnapshots` | Daily snapshot used for net-worth trends |
| `retentionCleanup` | Deletes expired tokens, old revoked sessions and year-old login events |

Notifications are de-duplicated with a `(user_id, dedupe_key)` unique
constraint, so reruns never spam users.

## AI assistant design

The assistant is a deterministic rules engine. It does not use a hosted
language model, so every number traces back to the user's own records:

- `nlq.parser.ts` detects intent, periods ("last month", "in March",
  "past 3 months") and Indian amounts ("₹50,000", "1.5 lakh", "2 crore").
- `nlq.service.ts` answers from the calculation engine. Each answer returns
  `facts`, `assumptions`, a `confidence` level, follow-up questions and, for
  forecasts or advice, a disclaimer.
- `insights.service.ts` produces proactive insights: spending changes, top
  categories, savings rate, anomalies, unused subscriptions, untracked
  recurring charges, budget overruns and a forecast with a range.

The `AssistantAnswer` contract is narrow, so a language model could later be
added to rephrase answers. The numbers would still come from the engine.

## Frontend layout (`frontend/src`)

| Path | Responsibility |
| --- | --- |
| `app/(auth)/*` | Sign-in (with the two-factor step), registration, password reset, email verification |
| `app/(app)/*` | Authenticated screens behind the session guard and app shell |
| `components/ui` | Design system: buttons, cards, fields, modal, table, tabs, toast, money, progress |
| `components/form-modal.tsx` | Data-driven create/edit dialogs that show server validation errors per field |
| `components/charts.tsx` | Recharts wrappers that follow the light/dark theme |
| `lib/api.ts` | Fetch client: in-memory token, single-flight refresh, CSRF, downloads |
| `lib/auth.tsx` | Session context (restore, login, two-factor, logout) |

Theme tokens are CSS variables (`--bg`, `--surface`, `--brand`, …) redefined
under `.dark` and mapped into Tailwind with `@theme inline`. An inline script
applies the saved theme before first paint, so the page never flashes the
wrong theme.
