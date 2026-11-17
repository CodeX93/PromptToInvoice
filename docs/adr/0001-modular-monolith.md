# ADR 0001: Modular monolith on a pnpm/Turborepo workspace

- Status: accepted
- Date: 2026-11-17

## Context
A small team needs to ship invoicing, AI drafting, payments, e-invoicing and billing quickly while keeping the code easy to change.

## Decision
One deployable web app (`apps/web`) plus one background worker process, sharing domain packages:

| Package | Responsibility |
|---|---|
| `@pti/core` | Pure domain logic: money, tax, numbering, lifecycle, plans, schemas. No I/O. |
| `@pti/db` | Drizzle schema, migrations, RLS, transactional helpers. |
| `@pti/ai` | Claude prompt, schema and response validation. |
| `@pti/einvoice` | EN 16931 mapping and CII/UBL/ZUGFeRD generation. |

Services are split out only when there is a measured need (load, isolation or team boundaries).

## Consequences
- One database, one deploy pipeline, cross-module refactors are atomic.
- Module boundaries are enforced by package exports and `import-x/no-cycle`, not network calls.
