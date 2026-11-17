# Database runbook

## Roles

| Role | Used by | RLS |
|---|---|---|
| owner (e.g. `pti`) | migrations only (`MIGRATION_DATABASE_URL`) | bypassed (table owner, but `FORCE RLS` applies to non-superusers) |
| `pti_app` | web app request handling (`DATABASE_URL`) | **enforced** |
| `pti_system` | worker, webhooks, public invoice page (`SYSTEM_DATABASE_URL`) | bypassed (`BYPASSRLS`) |

Migration `0002_rls_and_integrity` creates `pti_app` and `pti_system` without passwords. Set them out-of-band:

```sql
ALTER ROLE pti_app PASSWORD '<from secret manager>';
ALTER ROLE pti_system PASSWORD '<from secret manager>';
```

## Applying migrations

```bash
MIGRATION_DATABASE_URL=postgres://owner:…@host/db pnpm db:migrate
```

Migrations are forward-only and follow expand → migrate → contract. Never edit an applied migration.

## Restore drill (quarterly)

1. Restore the latest PITR snapshot into a scratch instance.
2. Run `pnpm db:migrate` against it (must be a no-op).
3. Run `select count(*) from invoices where status <> 'draft' and pdf_sha256 is null;` (should be 0 once PDFs are archived).
4. Record the drill outcome in the ops log.

## Investigating "issued invoice … is immutable"

This error comes from the `invoices_guard` trigger and means application code tried to change legal content of
an issued invoice. It's always a bug in the caller. Corrections go through credit notes.
