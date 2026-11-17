# Public API & webhooks

Enterprise plan. Keys and endpoints are managed in **Settings → API & webhooks**.
Machine-readable contract: `GET /api/v1/openapi.json` (generated from the same zod
schemas that validate requests, so it cannot drift).

## Conventions

- **Auth:** `Authorization: Bearer pti_live_<prefix>_<secret>`. Only a SHA-256 hash is
  stored; lookup is by prefix with a constant-time compare. Keys act with *member*
  permissions (create/issue/send, never people, billing or settings).
- **Money** is an integer in minor units next to an ISO 4217 `currency`. Quantities,
  prices and rates are decimal **strings**.
- **Errors** are RFC 9457 `application/problem+json` with a stable `title` code;
  validation errors carry `errors: { field: [messages] }`. Every response has `x-request-id`.
- **Rate limit:** 600 req/min per key; `x-ratelimit-limit|remaining|reset`, `retry-after` on 429.
- **Idempotency:** send `Idempotency-Key` on POSTs. The first response is stored for
  24 h and replayed (`idempotent-replayed: true`); the same key with a different body is a
  422; a concurrent duplicate gets 409; 5xx results release the key.

## Endpoints

| Method | Path | |
|---|---|---|
| GET | `/invoices` | `status`, `client_id`, `q`, `cursor`, `limit` |
| POST | `/invoices` | Creates a **draft**; omitted fields take org defaults |
| GET | `/invoices/{id}` | |
| POST | `/invoices/{id}/issue` | Assigns the number; irreversible |
| POST | `/invoices/{id}/send` | 202; `to` defaults to the client's emails |
| GET | `/invoices/{id}/pdf` | PDF/A-3 (Factur-X embedded where the plan allows) |
| GET/POST | `/clients`, GET `/clients/{id}` | |
| POST | `/drafts` | `{ "prompt": "…" }` → AI draft (counts against AI quota) |

## Webhooks

Events: `invoice.issued|sent|viewed|paid|voided`, `quote.accepted|declined` (plus `ping`
from "Send test"). Emitted only **after** the business transaction commits, written to an
outbox table and delivered by the worker.

```
PTI-Signature: t=1700000000,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
PTI-Event: invoice.paid
PTI-Delivery: <delivery id, use for dedupe>
```

Verify against the raw body, reject `t` older than 5 minutes. Non-2xx or timeout (10 s)
retries with backoff up to 8 attempts; 50 consecutive failures pause the endpoint until
a test is sent. Targets must be public `https` hosts — DNS is checked against private,
loopback, link-local and metadata ranges at creation **and** at every send (DNS rebinding),
and redirects are not followed.
