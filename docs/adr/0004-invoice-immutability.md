# ADR 0004: Issued invoices are immutable; corrections are credit notes

- Status: accepted
- Date: 2026-11-17

## Context
EU VAT rules and national bookkeeping law (e.g. GoBD in Germany) require issued invoices to stay unchanged,
numbered sequentially without gaps, and retained for 6–10 years.

## Decision
- `status ∈ {draft, open, paid, void}`; delivery and payment facts are separate columns and the display
  status is derived (`@pti/core/lifecycle`).
- Numbers are allocated only when issuing, inside the issuing transaction, from a locked counter row.
- A database trigger rejects any change to legal content after issue and any deletion of issued invoices,
  their lines or payments. The archived PDF hash can be set once.
- Corrections create a credit note referencing the original.

## Consequences
Application bugs cannot silently alter issued documents. "Edit" on an issued invoice is offered as "credit & re-issue".
