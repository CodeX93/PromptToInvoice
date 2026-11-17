# Performance

## Design choices that keep it fast

- Every list is keyset-paginated (`(issue_date, id)` / `(name, id)` cursors), so page 500
  costs the same as page 1; aggregates (dashboard, client balances) are single SQL
  round-trips (lateral joins / CTEs), not N+1 queries.
- Totals are computed once at save and stored; reads never recompute money.
- PDFs are rendered once at issue and archived; downloads stream the stored file.
- Slow or external work (email, PDF archiving, webhooks, FX, reminders) runs on the
  worker through pg-boss; requests never wait on a third party except Stripe Checkout and
  the AI draft call, both of which the user explicitly started.
- Rate limiting is a single upsert per check (no extra infrastructure); the limiter's
  key space is pruned daily.

## Budget (targets)

| Path                                   | p95 target                                     |
| -------------------------------------- | ---------------------------------------------- |
| Authenticated page render (TTFB)       | < 300 ms                                       |
| Save draft (server action)             | < 150 ms                                       |
| Issue invoice (number lock + snapshot) | < 250 ms, excluding PDF archiving (async)      |
| Public invoice page                    | < 200 ms                                       |
| `GET /api/v1/invoices` (25 items)      | < 120 ms                                       |
| AI draft                               | dominated by the model call; UI shows progress |

## Load-testing plan

Not yet run against production-like infrastructure; do this before launch.

1. Seed 50 orgs × 5,000 invoices × 20 lines (realistic skew: a few large orgs).
2. With k6 against a staging deployment (2 web replicas, 1 worker, managed Postgres):
   - Ramp to 200 req/s mixed: 60% list/detail pages, 20% saves, 10% public pages,
     5% issue, 5% API.
   - Hot-spot test: 20 concurrent issuers in **one** org and one series. Numbers must stay
     gap-free and unique (the counter row lock serialises them); watch lock wait time.
3. Watch: p95/p99 per route, Postgres CPU and `pg_stat_statements` top queries, connection
   pool saturation (`DATABASE_POOL_MAX` × replicas must stay below the server limit, or put
   PgBouncer in transaction mode with `DATABASE_DISABLE_PREPARE=true`), pg-boss queue depth.
4. Pass criteria: budgets above at 200 req/s, zero 5xx, zero duplicate or missing numbers.
