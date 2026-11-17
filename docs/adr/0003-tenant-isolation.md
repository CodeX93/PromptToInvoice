# ADR 0003: Tenant isolation with Postgres row-level security

- Status: accepted
- Date: 2026-11-17

## Decision

- Every tenant-owned table has `org_id` and a `tenant_isolation` RLS policy (`FORCE ROW LEVEL SECURITY`).
- The web app connects as `pti_app` (no `BYPASSRLS`) and runs tenant work inside `withOrg(db, orgId, fn)`,
  which sets `app.org_id` with `set_config(..., true)` (transaction-local, pooler-safe).
- Workers, webhooks and the public invoice page use `pti_system` (`BYPASSRLS`) through narrow, reviewed modules.
- Migrations run as the owner role.

## Consequences

A missing `WHERE org_id = …` in application code cannot leak data. Integration tests prove isolation for reads and writes.
