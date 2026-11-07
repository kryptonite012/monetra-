# Deployment & operations

## Options at a glance

| Scenario | How |
| --- | --- |
| Try it locally | `docker compose up --build`, then open <http://localhost:8080> |
| Develop | Node.js 22 + PostgreSQL 16 (+ Redis), then `npm run dev:backend` and `npm run dev:frontend` |
| Production (single host) | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` behind TLS |
| Production (scaled) | Run several `api` replicas behind a load balancer, one or more `worker`s, and managed PostgreSQL and Redis |

## 1. Local development

### Linux / macOS

```bash
npm run install:all
```

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`: set `DATABASE_URL` and `TEST_DATABASE_URL`, and generate
secrets as shown in the file. Then:

```bash
npm run migrate
```

```bash
npm run seed
```

```bash
npm run dev:backend
```

In a second terminal:

```bash
npm run dev:frontend
```

### Windows (PowerShell)

1. Install Node.js 22 LTS and PostgreSQL 16 (the EDB installer includes
   `psql`, `pg_dump` and `pg_restore`). Redis is optional; without it, rate
   limits and the cache run in memory and jobs run inline.
2. Create the role and databases:
   `psql -U postgres -c "CREATE ROLE monetra LOGIN PASSWORD 'monetra' CREATEDB;"`,
   then `createdb -U postgres -O monetra monetra` and
   `createdb -U postgres -O monetra monetra_test`.
3. `Copy-Item backend\.env.example backend\.env` and edit it.
4. Run the same `npm run …` commands as above. Every script is
   cross-platform: no bash is required, and paths are resolved with Node's
   `path` module.

Line endings are normalised by `.gitattributes` (LF for code, CRLF for `.ps1`).

## 2. Docker Compose

`docker-compose.yml` starts:

| Service | Purpose |
| --- | --- |
| `postgres` | PostgreSQL 16 with a persistent volume |
| `redis` | Redis 7 (AOF persistence) for rate limits, cache and queues |
| `api` | REST API. Applies pending migrations on start, then serves on :4000 |
| `worker` | BullMQ worker for reminders, recurring entries, alerts and snapshots |
| `web` | Next.js standalone server on :3000 |
| `nginx` | Single public entry point on `${HTTP_PORT:-8080}` |
| `mailpit` | Development SMTP catcher (UI on :8025) |
| `backup` | Daily `pg_dump` into `./backups` with retention and optional encryption |

```bash
cp .env.example .env
```

Generate the secrets listed in `.env`, then:

```bash
docker compose up --build -d
```

```bash
docker compose logs -f api
```

Seed the demo account (optional, not for production):

```bash
docker compose exec api node dist/db/seed.js
```

## 3. Production checklist

1. **Secrets.** Generate unique `JWT_ACCESS_SECRET` (≥ 32 characters),
   `HASH_PEPPER` and `DATA_ENCRYPTION_KEY` (32 random bytes, base64). Store
   them in your secret manager or in a root-only `.env`. The API **refuses to
   start in production** with the development defaults, or with
   `COOKIE_SECURE=false`.
2. **TLS.** Put certificates in `infra/certs/` (`fullchain.pem`,
   `privkey.pem`), for example from certbot. The prod override uses
   `infra/nginx/nginx.tls.conf`, which enables HSTS, HTTP→HTTPS redirect and
   TLS 1.2+.
3. **Email.** Configure a real SMTP provider (`SMTP_HOST`, `SMTP_USER`,
   `SMTP_PASSWORD`, `MAIL_FROM`). Mailpit is disabled in production.
4. **SMS (phone verification).** Set `SMS_PROVIDER=webhook` and
   `SMS_WEBHOOK_URL` to a small relay for your licensed SMS gateway (MSG91,
   Twilio, Gupshup, …). The relay receives `{ "to", "body" }`. The `console`
   provider only logs and is meant for development.
5. **Market data (optional).** `MARKET_DATA_PROVIDER=amfi` fetches official
   end-of-day mutual fund NAVs from AMFI. They are labelled *delayed* in the
   app.
6. **Database.** Use PostgreSQL 16 with encrypted storage (cloud disk
   encryption or LUKS). Set `DATABASE_SSL=true` when the database is on
   another host. Restrict network access to the API and worker.
7. **Start.**
   `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
8. **First administrator.** Register normally, then run
   `docker compose exec api node dist/scripts/create-admin.js you@company.in`.

### Environment variables

The authoritative list, with validation rules, is `backend/src/config/env.ts`.
Every variable is documented in `backend/.env.example` and `.env.example`.
The most important ones:

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | local | PostgreSQL connection string |
| `REDIS_URL` | – | Required for `JOBS_MODE=bullmq` and for rate limits shared across replicas |
| `JWT_ACCESS_SECRET` / `JWT_ACCESS_TTL` | dev value / `15m` | Access-token signing |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Session lifetime |
| `DATA_ENCRYPTION_KEY` | dev value | AES-256-GCM key for encrypted fields |
| `HASH_PEPPER` | dev value | Keyed lookup hashes (phone uniqueness) |
| `COOKIE_SECURE` | `false` | Must be `true` behind HTTPS |
| `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` | `1500` / `20` per 15 min per IP | Edge limits are also set in Nginx |
| `MAX_FAILED_LOGINS` / `ACCOUNT_LOCK_MINUTES` | `5` / `15` | Lockout policy |
| `UPLOAD_DIR` / `REPORT_DIR` / `MAX_UPLOAD_MB` | `./storage/...` / `5` | Private file storage (a Docker volume at `/data`) |
| `JOBS_ENABLED` / `JOBS_MODE` | `true` / `inline` | Use `bullmq` with a separate worker in production |

## 4. Migrations

- Migrations live in `backend/src/db/migrations` and are applied
  automatically by the API container (`node dist/db/migrate.js latest`).
- Manual commands: `npm run migrate`, `npm run migrate:status`,
  `npm run migrate:rollback` (development).
- Migrations are additive and run under a lock, so concurrent starts are safe.

## 5. Backups and recovery

- The `backup` service runs `infra/backup/backup.sh` every
  `BACKUP_INTERVAL_SECONDS` (default daily). It writes compressed
  custom-format dumps plus a `.sha256` file, and deletes dumps older than
  `BACKUP_RETENTION_DAYS`.
- Set `BACKUP_PASSPHRASE` to encrypt dumps with AES-256 (OpenSSL, PBKDF2
  200k iterations). Keep the passphrase outside the server.
- Copy `./backups` off-site (object storage with versioning), for example
  with a nightly `rclone`/`aws s3 sync`.
- Also back up the `appdata` volume (receipts and generated reports).

Restore (Linux/macOS):

```bash
PGHOST=localhost PGUSER=monetra PGPASSWORD=… PGDATABASE=monetra BACKUP_PASSPHRASE=… sh infra/backup/restore.sh backups/monetra-monetra-20260101T000000Z.dump.enc
```

Restore (Windows):

```powershell
./infra/backup/restore.ps1 -File .\backups\monetra-monetra-20260101T000000Z.dump
```

Test restores regularly into a scratch database before you need them.

## 6. Monitoring

- `GET /health` returns `{"status":"ok"}`. It is used by the Docker
  healthchecks and Nginx.
- Logs are structured JSON (pino) with request ids. Secrets, tokens, cookies
  and passwords are redacted at the logger. Ship stdout to your log platform.
- Watch for `auth.refresh_reuse_detected` and `auth.account_locked` in the
  audit log; both indicate possible attacks.
- Administrators can see platform statistics and the audit log at `/admin`.
  They cannot see users' financial data.

## 7. Scaling notes

- The API is stateless, so add replicas freely. Use Redis so rate limits and
  the cache are shared.
- Run at least one `worker`. A PostgreSQL advisory lock stops batches from
  overlapping, so extra workers are safe.
- Reports are generated synchronously and are small. For very large exports,
  move generation onto the BullMQ queue (the `financial_reports.status`
  column already supports `pending`).
