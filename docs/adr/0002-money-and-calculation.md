# ADR 0002: Exact money arithmetic and a deterministic totals engine

- Status: accepted
- Date: 2026-11-17

## Decision

- Amounts are integers in the currency's minor unit (`number`, checked against `Number.MAX_SAFE_INTEGER`).
- Quantities, unit prices and rates are decimal strings; arithmetic is done on `bigint` with explicit rounding.
- Totals follow EN 16931: each line net is rounded once; VAT is computed once per (category, rate) group; document discounts are allocated across groups with the largest-remainder method so no cent is lost.
- The AI never computes totals. It extracts structure; `@pti/core/calculate` computes every number.

## Consequences

Totals are reproducible across browser, server, PDF and XML. Property-based tests assert the invariants
(Σ lines = subtotal, Σ breakdown = totals, net + tax = gross).
