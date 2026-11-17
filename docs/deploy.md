# Deploying

Two images built from one `Dockerfile`, no secrets at build time:

```bash
docker build --target web    -t pti-web    --build-arg DEPLOYMENT_ID=$(git rev-parse --short HEAD) .
docker build --target worker -t pti-worker --build-arg DEPLOYMENT_ID=$(git rev-parse --short HEAD) .
```

Behind a TLS-inspecting proxy, add `--secret id=extra_ca,src=/path/to/ca.pem`; the CA is
used for `pnpm install` only and never lands in a layer.

| Image        | Runs                                 | Notes                                                                                                                                             |
| ------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pti-web`    | Next.js standalone server, port 3000 | Stateless; scale horizontally. Same `DEPLOYMENT_ID` across replicas of a release.                                                                 |
| `pti-worker` | `node dist/worker.mjs`               | pg-boss jobs: email, PDF archiving, reminders, recurring, FX, webhooks, purge. Run ≥1; more for throughput. Drains on SIGTERM (give it 60 s).     |
| `pti-worker` | `node dist/migrate.mjs`              | One-off before each release, with `MIGRATION_DATABASE_URL` (owner role). Migrations are additive; old app versions keep working during a rollout. |

## Release order

1. Build both images with the same `DEPLOYMENT_ID`.
2. Run migrations.
3. Roll the worker, then the web replicas.

## Configuration

Validated at boot: a container with invalid configuration **exits 1 before it serves**
(`src/instrumentation.ts`), so a bad deploy never takes traffic. See `.env.example` for
every variable. Production refuses the dev-only `AI_PROVIDER=stub` and `EMAIL_PROVIDER=log`.

Database roles (created by `infra/docker/postgres-init.sql`; mirror it on managed Postgres):

- `DATABASE_URL`: `pti_app`, row-level security enforced. Used for tenant data.
- `SYSTEM_DATABASE_URL`: `pti_system`, `BYPASSRLS`. Auth, webhooks and jobs only.
- `MIGRATION_DATABASE_URL`: the owner role. Used only by migrations.

Through a transaction pooler (PgBouncer, Neon), set `DATABASE_DISABLE_PREPARE=true`.
`withOrg` uses `SET LOCAL`, which is transaction-scoped and pooler-safe.

Storage: `STORAGE_DRIVER=s3` for anything with more than one host. The `fs` driver writes to
`apps/web/.data` inside the container, so mount a volume if you use it.

## Probes

- Liveness: `GET /api/health` checks only the process, never dependencies (built into the image `HEALTHCHECK`).
- Readiness: `GET /api/health?ready=1` round-trips to Postgres with a 2 s timeout and returns 503 otherwise.

## Behind a proxy

Terminate TLS in front of the web replicas and forward `X-Forwarded-For`. **Set
`TRUSTED_PROXIES`** to your load balancer's addresses/CIDRs (e.g. `10.0.0.0/8`): the client
is the first address from the right that isn't a trusted hop, so a client-supplied
`X-Forwarded-For` can't dodge rate limits. Without it, only a single-entry header is
believed (platforms that overwrite the header); never expose the app port directly. HSTS (with preload) and a per-request nonce CSP are sent by
the app itself.

## Backups

Postgres: point-in-time recovery (WAL archiving) with daily base backups, plus a tested
restore drill. Issued documents must survive for 10 years: enable versioning and object
lock (compliance mode) on the S3 bucket's `invoice_pdf/` prefix.
