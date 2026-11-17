# ADR 0005: AI is an extraction layer, never the source of truth

- Status: accepted
- Date: 2026-11-17

## Decision

- Claude turns free text into a schema-constrained draft (client, lines, currency, dates, terms) with explicit
  `uncertainFields` and `assumptions`.
- The server resolves clients (trigram match), validates every field with the shared Zod schema, applies
  defaults and computes totals with `@pti/core`.
- The model has no tools that act (no sending, no writes); the user always reviews the draft.
- Only names and IDs of clients are sent to the model, never addresses or bank details.

## Consequences

A model error can at worst produce a wrong draft that the user sees and edits; it cannot issue, send or mis-total an invoice.
