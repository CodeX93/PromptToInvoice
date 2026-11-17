# AI drafting

Prompt → invoice draft, end to end.

```
prompt bar (server action, POST only)
  └─ createAiDraft (apps/web/src/server/services/ai-drafts.ts)
       1. permission, org setting, per-user rate limit (20/min), monthly quota (counted up front)
       2. context: today (org TZ), seller country/currency, client ids+names (≤150), recent line items with prices (≤40)
       3. extractDraft (@pti/ai)  — Claude, structured output, effort "low", prompt caching, server-side fallbacks
       4. normalizeDraft (@pti/ai) — drop unknown ids, validate every number/date, fill prices from history, record AI fields
       5. resolve client: model id → trigram match (≥0.5) → new *pending* client
       6. tax: explicit hint → treatment for this client (reverse charge, exports) → default rate
       7. saveDraft (same path as manual drafts; totals computed by @pti/core)
       8. ai_drafts row: model, request id, latency, tokens (incl. cache reads), status, AI fields, notes
  └─ editor shows highlighted AI values + margin notes until a person saves
  └─ on issue: recordAiOutcome stores which AI values were edited (quality signal)
```

## Guarantees

- The model never computes money. Totals, tax and rounding come from `@pti/core/calculate`.
- The model has no tools and cannot write, send or issue anything.
- Only client **ids and names** and the user's own line items reach the model. No addresses, emails, tax IDs or bank data.
- Model output is validated field by field. An unknown client id, malformed number or impossible date is discarded and reported to the user, never trusted.
- The user's text is wrapped as data, and the instructions tell the model to ignore embedded instructions. The `injection` eval case covers this.

## Configuration

| Variable | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | Enables AI drafting. |
| `AI_MODEL` | Defaults to `claude-opus-5-5`. |
| `AI_PROVIDER` | `anthropic` (default) or `stub`. `stub` is a deterministic offline parser for local dev and e2e only, refused in production. |

Per organisation (Settings → AI): turn drafting off, or stop retaining prompt text (only a SHA-256 fingerprint is stored).

## Quality

- `packages/ai/evals/cases.ts`: golden cases (typos, EU number formats, multi-line, repeats, other languages, prompt injection).
- Run with a live model:

  ```bash
  ANTHROPIC_API_KEY=… pnpm --filter @pti/ai eval
  ```

  The run prints per-case results, accuracy, and tokens in/cached/out, and exits non-zero below `--min` (default 0.9). Use it to gate prompt and model changes. `--model` lets you compare a cheaper model on the same cases before switching any route to it.
- In production, watch the `ai_drafts.edited_fields` frequency per field and the acceptance rate (drafts issued with no edits).
