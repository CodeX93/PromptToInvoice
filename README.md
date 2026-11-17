# PromptToInvoice

AI-powered invoicing for freelancers and small businesses: describe the work in plain language and get a
professional, compliant, ready-to-send invoice.

## Repository layout

```
apps/
  web/            Next.js app: UI, API routes, webhooks, hosted invoice pages
packages/
  core/           Pure domain logic: money, tax, numbering, lifecycle, plans, schemas
  db/             Drizzle schema, migrations, row-level security, transaction helpers
  ai/             Claude extraction: prompt, schema, validation, evals
  einvoice/       EN 16931 (Factur-X / ZUGFeRD / XRechnung) generation
  eslint-config/  Shared lint rules
  tsconfig/       Shared TypeScript presets
docs/
  PRODUCTION_PLAN.md   Product review and plan
  adr/                 Architecture decision records
  runbooks/            Operational procedures
```

## Getting started

Requirements: Node 22.12+, pnpm 10, Docker (or a local Postgres 16).

```bash
pnpm install
```

```bash
pnpm dev:services
```

```bash
cp .env.example apps/web/.env.local
```

```bash
pnpm db:migrate
```

```bash
pnpm dev
```

## Quality gates

| Command             | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `pnpm lint`         | ESLint (strict, type-aware)                         |
| `pnpm typecheck`    | TypeScript, `strict` + `noUncheckedIndexedAccess`   |
| `pnpm test`         | Unit, property-based and Postgres integration tests |
| `pnpm format:check` | Prettier                                            |

## Key design decisions

- [Modular monolith](docs/adr/0001-modular-monolith.md)
- [Exact money and EN 16931 totals](docs/adr/0002-money-and-calculation.md)
- [Tenant isolation with RLS](docs/adr/0003-tenant-isolation.md)
- [Immutable issued invoices](docs/adr/0004-invoice-immutability.md)
- [AI as extraction only](docs/adr/0005-ai-extraction-only.md)
