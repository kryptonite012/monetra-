# Security

Monetra holds sensitive personal and financial information, so security is
built into every layer. This document describes the controls, where they live
in the code, and what operators must do.

## What Monetra never collects

Monetra is a record-keeping tool. It does not move money or connect to banks,
and it **never asks for or stores**:

- bank or net-banking passwords
- UPI PINs or MPINs
- OTPs from banks or payment apps
- full card numbers or CVVs

This is enforced, not just documented. `lib/sensitive.ts` rejects any payload
that contains a Luhn-valid 13–19 digit number or a field named `cvv`, `pin`,
`upiPin`, `otp`, `password` (outside the auth endpoints) and similar. Payment
methods store only a UPI ID or a card's last four digits. Account names that
look like full account numbers are rejected.

## Controls

| Area | Implementation | Code |
| --- | --- | --- |
| Password storage | scrypt (N=2¹⁵, r=8, p=1, 64-byte key, per-user salt). Hashes are upgraded transparently when parameters change. Policy: 10+ characters, 3 character classes, no common passwords, no name or email | `lib/crypto.ts`, `lib/password-policy.ts` |
| Sign-in protection | Generic error messages, constant-time path for unknown emails, lockout after 5 failures for 15 minutes, every attempt recorded | `modules/auth/auth.service.ts` |
| Multi-factor authentication | TOTP (RFC 6238), compatible with common authenticator apps. Replay protection (last used time step), 10 single-use hashed recovery codes, attempt-limited challenges | `lib/totp.ts`, `modules/auth/mfa.service.ts` |
| Verification | Email links (hashed, 24 h, single use) and SMS codes (hashed, 10 min, 5 attempts) | `modules/auth/verification.service.ts` |
| Sessions | 15-minute HS256 JWT access tokens kept in browser memory; 30-day opaque refresh tokens in an httpOnly, Secure, `SameSite=Strict` cookie scoped to `/api/v1/auth`; only SHA-256 hashes are stored | `modules/auth/session.service.ts` |
| Refresh rotation | A new refresh token on every use. Reuse after the 30-second grace window revokes the whole token family and raises a security alert | `modules/auth/refresh.service.ts` |
| Session revocation | Every request checks the session row, so sign-out, device revocation, password change, account disable and role change take effect immediately | `middleware/auth.ts` |
| Password change and reset | Reset links are hashed, single use and last 30 minutes. A reset signs out all sessions; a change signs out all other sessions. Both send an email notice | `modules/auth/password.service.ts` |
| Role-based access | `user`, `support`, `admin`. Endpoints are authenticated by default and admin routes declare their roles. Admins cannot read users' financial records and cannot change their own role or status | `lib/http.ts`, `modules/admin` |
| Tenant isolation | Every query is scoped by `user_id`. A trigger also checks that ledger entries belong to the account owner. Cross-user ids return 404 | `lib/ownership.ts`, ledger triggers |
| CSRF | API calls use Bearer tokens (not ambient credentials). The two cookie-authenticated endpoints (refresh, logout) need a double-submit `X-CSRF-Token`, plus `SameSite=Strict` | `middleware/security.ts` |
| XSS | React escapes output; no user HTML is ever rendered. The API sends `Content-Security-Policy: default-src 'none'`. Receipts are served with `sandbox` CSP and `nosniff`. CSV and Excel exports neutralise formula injection | `middleware/security.ts`, `modules/reports/renderers.ts` |
| Security headers | Helmet (HSTS in production, frameguard DENY, no-referrer, CORP). Nginx and Next.js add the same headers for the web app. API responses are `Cache-Control: no-store` | `middleware/security.ts`, `infra/nginx` |
| CORS | Explicit allow-list (`CORS_ORIGINS`) with credentials | `middleware/security.ts` |
| Rate limiting | 1500 requests / 15 min per IP across the API and 20 / 15 min on credential endpoints, backed by Redis so limits hold across replicas. Nginx adds edge limits | `middleware/security.ts`, `infra/nginx/nginx.conf` |
| Input validation | zod schemas on every body, query and path. Money is validated as decimals with at most 4 fractional digits. Database CHECK constraints back up the rules | `lib/http.ts`, migrations |
| Encryption in transit | TLS 1.2+ at Nginx with HSTS; optional TLS to PostgreSQL (`DATABASE_SSL`) | `infra/nginx/nginx.tls.conf` |
| Encryption at rest | AES-256-GCM field encryption for phone numbers and TOTP secrets (`DATA_ENCRYPTION_KEY`). Keyed HMAC lookup hashes for uniqueness. Full-disk or volume encryption for the database host (operator). Backups optionally AES-256 encrypted | `lib/crypto.ts`, `infra/backup` |
| File uploads | In-memory upload limit, content-type detected from magic bytes (JPEG, PNG, WEBP, PDF), PDFs with JavaScript or embedded files rejected, random file names, per-user private directory (0700/0600), never served from a public path | `lib/uploads.ts` |
| Ledger integrity | Immutable financial fields, one-way reversal state, no deletes except the audited account-erasure path, `NUMERIC` money | ledger migration |
| Audit logging | Append-only `audit_logs` (a trigger blocks UPDATE and DELETE) for auth events, data changes, admin actions, exports and deletions, with IP, user agent and request id | `modules/audit` |
| Login monitoring | Every attempt is stored. Users see their sign-in history and devices, get alerts on new-device sign-ins, lockouts and token reuse, and can revoke sessions | `modules/auth/sessions.routes.ts` |
| Logging hygiene | pino redaction of authorization headers, cookies, CSRF tokens, passwords, codes and secrets | `lib/logger.ts` |
| Data rights | `GET /me/export` returns a full JSON export with secrets removed. `DELETE /me` needs the password, typed confirmation and a 2FA code if enabled; it erases all data and files | `modules/users` |
| Dependencies | `npm audit --omit=dev --audit-level=high` in CI, weekly Dependabot updates | `.github` |
| Containers | Non-root users, minimal Alpine images, tini as init, healthchecks, PostgreSQL not exposed publicly in production | Dockerfiles, compose files |

## Configuration safeguards

The API **refuses to start in production** if `JWT_ACCESS_SECRET`,
`DATA_ENCRYPTION_KEY` or `HASH_PEPPER` still have their development values, or
if `COOKIE_SECURE` is not `true`.

## Operator responsibilities

- Generate unique secrets per environment and keep them out of version
  control.
- Rotating `DATA_ENCRYPTION_KEY` requires re-encrypting existing fields.
  Ciphertexts are versioned (`v1.`), so a future key version can be added and
  data migrated.
- Encrypt database volumes and backups, and store backups off-site.
- Keep the host patched. Rebuild images regularly so base images pick up
  fixes.
- Review `auth.refresh_reuse_detected`, `auth.account_locked` and
  `admin.*` audit events.
- Run a penetration test before handling real customer data at scale.

## Known limitations

- Phone verification needs an SMS gateway relay. The development provider
  only logs codes.
- There is no bank or account-aggregator integration. Balances are as
  accurate as the records users enter. Any future integration must use an
  authorised channel (for example RBI-regulated Account Aggregators).
- Market prices are manual unless the AMFI provider is enabled, and the app
  labels them that way.

## Reporting a vulnerability

Please report security issues privately to the repository owner through
GitHub's private vulnerability reporting, rather than opening a public issue.
Include steps to reproduce and the affected version.
