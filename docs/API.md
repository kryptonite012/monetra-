# API guide

Base URL: `/api/v1` (behind Nginx at `https://<your-domain>/api/v1`, or
`http://localhost:4000/api/v1` in development).

- **Interactive docs:** `GET /api/docs` (Swagger UI)
- **Machine-readable spec:** `GET /api/openapi.json`. A copy lives in
  [`openapi.json`](openapi.json); regenerate it with `npm run docs:openapi`.

The spec is generated from the same zod schemas that validate requests, so it
always matches the running code.

## Conventions

| Topic | Convention |
| --- | --- |
| Format | JSON in and out. Successful responses are `{ "data": … }`. Paginated lists add `"meta": { page, pageSize, total, totalPages }` |
| Money | **Decimal strings**, never floats. Requests accept `"1250.50"` or `1250.5` (up to 4 decimals). Responses use 2 decimals, e.g. `"1250.50"` |
| Dates | Business dates are `YYYY-MM-DD`; months are `YYYY-MM`; timestamps are ISO-8601 UTC |
| IDs | UUID v4 |
| Pagination | `?page=1&pageSize=25` (max 200) |
| Errors | `{ "error": { "code", "message", "details?", "requestId" } }` with an appropriate HTTP status |
| Tracing | Every response carries `X-Request-Id`. Send your own (8–64 safe characters) to correlate logs |
| Caching | API responses are sent with `Cache-Control: no-store` |

### Error codes

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Malformed JSON or an invalid identifier |
| 401 | `UNAUTHORIZED`, `TOKEN_INVALID`, `SESSION_REVOKED`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS`, `INVALID_MFA_CODE` | Authentication problems |
| 403 | `FORBIDDEN`, `CSRF_FAILED`, `ACCOUNT_INACTIVE` | Not allowed |
| 404 | `NOT_FOUND` | Missing, or owned by another user (the API never reveals which) |
| 409 | `CONFLICT`, `ALREADY_REVERSED`, `ACCOUNT_CLOSED`, `INTEGRITY_RULE`, `REFERENCE_ERROR` | State conflicts, duplicate references, ledger immutability |
| 413 | `PAYLOAD_TOO_LARGE`, `UPLOAD_REJECTED` | Body or file too large |
| 422 | `VALIDATION_ERROR`, `UNPROCESSABLE`, `CONSTRAINT_VIOLATION` | Validation failed. `details` lists `{ path, message }` per field |
| 423 | `ACCOUNT_LOCKED` | Temporarily locked after repeated failed sign-ins |
| 429 | `RATE_LIMITED`, `TOO_MANY_ATTEMPTS` | Slow down |

## Authentication

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "asha@example.in", "password": "…" }
```

If the response contains `"mfaRequired": true`, finish signing in with
`POST /auth/login/mfa { mfaToken, code | recoveryCode }`.

A successful sign-in returns `{ accessToken, expiresIn, user }` and sets the
httpOnly `monetra_rt` refresh cookie. Send the access token on every request:

```http
Authorization: Bearer <accessToken>
```

To refresh or sign out (both authenticated by the cookie):

1. `GET /auth/csrf` sets a `monetra_csrf` cookie and returns the token.
2. Send it back as the `X-CSRF-Token` header on `POST /auth/refresh` and
   `POST /auth/logout`.

The refresh token rotates on every refresh.

## Example: record an expense

```http
POST /api/v1/expenses
Authorization: Bearer …
Content-Type: application/json

{
  "accountId": "6f0c…",
  "amount": "1249.50",
  "occurredOn": "2026-11-03",
  "description": "Zepto groceries",
  "merchantName": "Zepto",
  "paymentMethodId": "a71e…"
}
```

The expense is auto-categorised as *Groceries*. The response includes
`metadata.autoCategory.explanation` (for example `Recognised "zepto"`) and any
`warnings`, such as a possible duplicate.

## Rules worth knowing

- **Ledger entries are immutable.** `PATCH /transactions/:id` changes
  annotations only. Use `POST /transactions/:id/correct` or `/reverse`, or
  `PUT`/`DELETE` on income and expenses, which reverse and re-post behind the
  scenes.
- **Sensitive data is rejected.** Payloads containing full card numbers
  (Luhn-valid 13–19 digits), or fields named `cvv`, `pin`, `upiPin`, `otp` and
  similar, fail validation.
- **Receipts** are uploaded as `multipart/form-data` with a single `file`
  field. JPEG, PNG, WEBP and PDF only, checked by content; max 5 MB by
  default.
- **Ownership.** A resource that belongs to another user returns `404`.

## Endpoint index

### Auth

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/auth/login` | Sign in with email and password *(public)* |
| `POST` | `/auth/login/mfa` | Complete sign-in with an authenticator or recovery code *(public)* |
| `POST` | `/auth/logout` | Sign out of the current session *(public)* |
| `GET` | `/auth/me` | Current user |
| `GET` | `/auth/mfa` | Two-factor authentication status |
| `POST` | `/auth/mfa/disable` | Disable two-factor authentication |
| `POST` | `/auth/mfa/enable` | Confirm TOTP setup and receive one-time recovery codes |
| `POST` | `/auth/mfa/recovery-codes` | Regenerate recovery codes (invalidates the old ones) |
| `POST` | `/auth/mfa/setup` | Begin TOTP setup (returns secret and QR code) |
| `POST` | `/auth/password/change` | Change password (other sessions are signed out) |
| `POST` | `/auth/password/forgot` | Request a password reset email *(public)* |
| `POST` | `/auth/password/reset` | Set a new password using a reset token (signs out every session) *(public)* |
| `POST` | `/auth/refresh` | Rotate the refresh token and obtain a new access token *(public)* |
| `POST` | `/auth/register` | Create an account *(public)* |
| `POST` | `/auth/verify-email/confirm` | Confirm an email address using the emailed token *(public)* |
| `POST` | `/auth/verify-email/request` | Send (or resend) the email verification link |
| `POST` | `/auth/verify-phone/confirm` | Confirm the SMS verification code |
| `POST` | `/auth/verify-phone/request` | Send a 6-digit verification code by SMS (optionally to a new number) |

### Security

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/audit-logs` | Your own audit trail (security and data changes) |
| `GET` | `/auth/login-activity` | Recent sign-in attempts for your account |
| `GET` | `/auth/sessions` | Active sessions (devices) for your account |
| `POST` | `/auth/sessions/revoke-others` | Sign out every other device |
| `DELETE` | `/auth/sessions/{id}` | Sign out a specific device |

### Profile

| Method | Path | Description |
| --- | --- | --- |
| `DELETE` | `/me` | Permanently delete your account and all data |
| `GET` | `/me` | Your account and profile |
| `GET` | `/me/export` | Download all of your data as JSON |
| `POST` | `/me/onboarding` | Save onboarding answers and mark onboarding complete |
| `PATCH` | `/me/preferences` | Update app and notification preferences |
| `PATCH` | `/me/profile` | Update profile details |

### Accounts

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/accounts` | List accounts with computed balances |
| `POST` | `/accounts` | Add an account (manually tracked) |
| `GET` | `/accounts/summary` | Total available balance, card outstanding and balances by account type |
| `DELETE` | `/accounts/{id}` | Delete an account that has no transactions |
| `GET` | `/accounts/{id}` | Account details with balance and six-month flow summary |
| `PATCH` | `/accounts/{id}` | Update account details (opening balance only while the account has no transactions) |
| `GET` | `/accounts/{id}/balance` | Balance on a given date (computed from the ledger) |
| `POST` | `/accounts/{id}/close` | Close an account (records the closing balance and blocks new entries) |
| `POST` | `/accounts/{id}/reconcile` | Reconcile against a bank statement balance (optionally posting an adjustment) |
| `GET` | `/accounts/{id}/reconciliations` | Reconciliation history for an account |
| `POST` | `/accounts/{id}/reopen` | Reopen a closed account |
| `GET` | `/accounts/{id}/statement` | Account statement with running balance |

### Payment methods

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/payment-methods` | List payment methods |
| `POST` | `/payment-methods` | Add a payment method (stores only non-secret identifiers) |
| `DELETE` | `/payment-methods/{id}` | Remove a payment method (deactivated instead if it has history) |
| `PATCH` | `/payment-methods/{id}` | Update a payment method |

### Transactions

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/transactions` | Search and filter the ledger |
| `POST` | `/transactions` | Record a ledger entry (income, expense, refund, fee, interest or adjustment) |
| `POST` | `/transactions/transfer` | Transfer money between your accounts (also used for credit card bill payments) |
| `GET` | `/transactions/{id}` | Transaction details with reversal, transfer and correction links |
| `PATCH` | `/transactions/{id}` | Annotate a transaction (category, merchant, description, notes, tags) |
| `POST` | `/transactions/{id}/correct` | Correct a transaction: reverses it and posts a replacement linked to the original |
| `POST` | `/transactions/{id}/reverse` | Reverse a transaction (posts an equal and opposite entry) |

### UPI & digital payments

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/upi/parse-qr` | Read a UPI QR payload to pre-fill a payment record (does not pay) |
| `GET` | `/upi/summary` | Incoming vs outgoing UPI totals and top counterparties |
| `GET` | `/upi/transactions` | UPI transactions (paid with a UPI method or recorded through the UPI module) |
| `POST` | `/upi/transactions` | Record a UPI payment you made or received |

### Categories

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/categories` | List system and custom categories |
| `POST` | `/categories` | Create a custom category |
| `POST` | `/categories/suggest` | Suggest a category for a description/merchant (explains its reasoning) |
| `DELETE` | `/categories/{id}` | Archive a custom category (existing transactions keep it) |
| `PATCH` | `/categories/{id}` | Rename or restyle a custom category |
| `GET` | `/categorization-rules` | List auto-categorisation rules |
| `POST` | `/categorization-rules` | Create an auto-categorisation rule |
| `DELETE` | `/categorization-rules/{id}` | Delete a rule |
| `PATCH` | `/categorization-rules/{id}` | Update a rule |
| `GET` | `/merchants` | List merchants with spend totals |
| `POST` | `/merchants` | Create a merchant |
| `DELETE` | `/merchants/{id}` | Delete an unused merchant |
| `PATCH` | `/merchants/{id}` | Update a merchant |

### Income

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/income` | List income records |
| `POST` | `/income` | Record income (gross, TDS and other deductions; the net amount is credited) |
| `GET` | `/income/summary` | Monthly and per-source income report (defaults to the current financial year) |
| `DELETE` | `/income/{id}` | Delete an income record (its ledger entry is reversed) |
| `GET` | `/income/{id}` | Income record details |
| `PUT` | `/income/{id}` | Correct an income record (ledger entry is reversed and re-posted) |

### Expenses

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/expenses` | List expenses |
| `POST` | `/expenses` | Record an expense (auto-categorised when no category is given) |
| `GET` | `/expenses/analytics` | Spending analytics (daily, weekly or monthly) with category, merchant and payment-mode breakdowns |
| `DELETE` | `/expenses/{id}` | Delete an expense (its ledger entry is reversed) |
| `GET` | `/expenses/{id}` | Expense details with splits and receipts |
| `PUT` | `/expenses/{id}` | Edit an expense (reverses the original ledger entry and posts a corrected one) |
| `POST` | `/expenses/{id}/receipts` | Attach a receipt (JPEG, PNG, WEBP or PDF; validated by content) |
| `POST` | `/expenses/{id}/splits` | Split an expense with others (equal or exact shares); replaces unsettled shares |
| `DELETE` | `/receipts/{id}` | Delete a receipt |
| `GET` | `/receipts/{id}/file` | Download a receipt file |
| `GET` | `/splits` | Money owed to you from split expenses, grouped by person |
| `DELETE` | `/splits/{id}` | Remove an unsettled share |
| `POST` | `/splits/{id}/settle` | Mark a share as repaid and record the money received |

### Recurring

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/recurring-rules` | List recurring income and expense schedules |
| `POST` | `/recurring-rules` | Create a recurring schedule |
| `POST` | `/recurring-rules/run-due` | Post any of your schedules that are due today (normally done by the scheduler) |
| `GET` | `/recurring-rules/upcoming` | Projected recurring entries for the next N days |
| `DELETE` | `/recurring-rules/{id}` | Delete a recurring schedule (already posted entries are kept) |
| `PATCH` | `/recurring-rules/{id}` | Update a recurring schedule |

### Budgets

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/budgets` | List budgets, or fetch the budget for one month with utilisation |
| `POST` | `/budgets` | Create a monthly budget with category limits |
| `GET` | `/budgets/compare` | Compare two monthly budgets category by category |
| `GET` | `/budgets/history` | Historical budget performance |
| `DELETE` | `/budgets/{id}` | Delete a budget |
| `GET` | `/budgets/{id}` | Budget utilisation, alerts and projections |
| `PUT` | `/budgets/{id}` | Update budget totals and targets |
| `PUT` | `/budgets/{id}/categories` | Add or update category limits |
| `DELETE` | `/budgets/{id}/categories/{categoryId}` | Remove a category limit |
| `POST` | `/budgets/{id}/copy` | Copy this budget (limits and targets) to another month |

### Savings goals

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/goals` | List savings goals with progress and estimated completion |
| `POST` | `/goals` | Create a savings goal |
| `DELETE` | `/goals/{id}` | Delete a goal (ledger transfers made for it are kept) |
| `GET` | `/goals/{id}` | Goal details with contribution history |
| `PATCH` | `/goals/{id}` | Update a goal |
| `POST` | `/goals/{id}/contributions` | Add money to (or withdraw from, with a negative amount) a goal |
| `DELETE` | `/goals/{id}/contributions/{contributionId}` | Remove a contribution record (does not move money back) |

### Loans & EMIs

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/loans` | List loans with outstanding balances and next EMI |
| `POST` | `/loans` | Add a loan; the EMI schedule is generated automatically |
| `POST` | `/loans/calculator` | EMI calculator with full amortisation schedule |
| `GET` | `/loans/summary` | Outstanding liability dashboard (loans, card dues, other liabilities) |
| `DELETE` | `/loans/{id}` | Delete a loan that has no recorded payments |
| `GET` | `/loans/{id}` | Loan details with amortisation schedule |
| `PATCH` | `/loans/{id}` | Update loan details (financial terms are fixed; use prepayment or foreclosure) |
| `POST` | `/loans/{id}/foreclose` | Close a loan early with a final payment |
| `POST` | `/loans/{id}/installments/{no}/pay` | Record an EMI payment (posts a ledger debit) |
| `POST` | `/loans/{id}/prepay` | Make a part-prepayment and re-plan the remaining schedule |

### Investments

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/investments` | Holdings with valuation, P&L and price-source labels |
| `POST` | `/investments` | Add a holding (optionally with its first purchase) |
| `GET` | `/investments/market-data` | Which market data provider is configured and what it covers |
| `GET` | `/investments/portfolio` | Portfolio totals, allocation, XIRR and data-source disclosure |
| `POST` | `/investments/refresh-prices` | Fetch prices from the configured verified provider (AMFI NAVs for mutual funds) |
| `DELETE` | `/investments/{id}` | Delete a holding that has no ledger-linked transactions |
| `GET` | `/investments/{id}` | Holding details with transactions and XIRR |
| `PATCH` | `/investments/{id}` | Update holding details |
| `POST` | `/investments/{id}/price` | Set a manual price (labelled as manually entered) |
| `POST` | `/investments/{id}/transactions` | Record a buy, sell, dividend, interest, bonus, split or fee |

### Assets & liabilities

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/assets` | Asset register (property, vehicles, gold and more) |
| `POST` | `/assets` | Add an asset |
| `DELETE` | `/assets/{id}` | Delete an asset record |
| `PATCH` | `/assets/{id}` | Update an asset |
| `POST` | `/assets/{id}/dispose` | Mark an asset as sold or disposed (optionally crediting the sale proceeds) |
| `POST` | `/assets/{id}/revalue` | Record a new valuation |
| `GET` | `/liabilities` | Other liabilities (personal borrowings, dues, payables) |
| `POST` | `/liabilities` | Add a liability |
| `DELETE` | `/liabilities/{id}` | Delete a liability record |
| `PATCH` | `/liabilities/{id}` | Update a liability |
| `POST` | `/liabilities/{id}/payments` | Record a repayment (reduces the outstanding amount; optionally posts a ledger debit) |
| `GET` | `/net-worth` | Current net worth with asset and liability breakdown |
| `GET` | `/net-worth/history` | Net worth trend from monthly snapshots |
| `POST` | `/net-worth/snapshot` | Save today's net worth snapshot |

### Bills & subscriptions

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/bills` | List bills with due status |
| `POST` | `/bills` | Add a recurring bill |
| `GET` | `/bills/upcoming` | Bills and subscription renewals due soon (including overdue) |
| `DELETE` | `/bills/{id}` | Delete a bill (payment history in the ledger is kept) |
| `PATCH` | `/bills/{id}` | Update a bill |
| `POST` | `/bills/{id}/pay` | Record a bill payment and move the due date forward |
| `GET` | `/bills/{id}/payments` | Payment history for a bill |
| `GET` | `/subscriptions` | List subscriptions |
| `POST` | `/subscriptions` | Add a subscription |
| `GET` | `/subscriptions/summary` | Monthly/yearly subscription cost and subscriptions you may not be using |
| `DELETE` | `/subscriptions/{id}` | Delete a subscription record |
| `PATCH` | `/subscriptions/{id}` | Update a subscription |
| `POST` | `/subscriptions/{id}/cancel` | Mark a subscription as cancelled |
| `POST` | `/subscriptions/{id}/pay` | Record a renewal payment and roll the renewal date forward |
| `GET` | `/subscriptions/{id}/payments` | Payment history for a subscription |
| `POST` | `/subscriptions/{id}/used` | Record that you used a subscription (helps detect unused ones) |

### Dashboard

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/dashboard` | Financial command centre: balances, cash flow, net worth, liabilities, bills, health score and charts |
| `GET` | `/dashboard/cashflow` | Monthly income, expenses and net cash flow |
| `GET` | `/dashboard/health-score` | Financial health score with component explanations |

### Reports

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/reports` | Previously generated reports |
| `POST` | `/reports` | Generate a report file (PDF, Excel or CSV) |
| `GET` | `/reports/preview` | Report data as JSON for on-screen viewing |
| `GET` | `/reports/types` | Available report types |
| `DELETE` | `/reports/{id}` | Delete a generated report |
| `GET` | `/reports/{id}/download` | Download a generated report |

### Notifications

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/notifications` | Your notifications (newest first) |
| `POST` | `/notifications/read-all` | Mark every notification as read |
| `GET` | `/notifications/unread-count` | Number of unread notifications |
| `DELETE` | `/notifications/{id}` | Dismiss a notification |
| `PATCH` | `/notifications/{id}/read` | Mark a notification as read |

### AI assistant

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/assistant/anomalies` | Unusually large transactions in the last N days |
| `POST` | `/assistant/ask` | Ask a question about your recorded finances (transparent, rule-based answers) |
| `GET` | `/assistant/examples` | Example questions |
| `GET` | `/assistant/forecast` | Expenditure and savings forecasts with stated assumptions |
| `GET` | `/assistant/insights` | Personalised insights: spending changes, anomalies, unused subscriptions, budget overruns and forecasts |

### Admin

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/admin/audit-logs` | Search the platform audit trail |
| `POST` | `/admin/jobs/run` | Run all background maintenance tasks now |
| `GET` | `/admin/stats` | Platform health statistics (no financial data) |
| `GET` | `/admin/users` | List users |
| `PATCH` | `/admin/users/{id}/role` | Change a user role |
| `PATCH` | `/admin/users/{id}/status` | Enable, lock or disable a user (disabling signs them out everywhere) |
