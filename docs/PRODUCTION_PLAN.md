# PromptToInvoice — Production Application Plan

> Version 1.0 · November 2026 · Status: Proposed (pre-implementation)
> Source: *PromptToInvoice Project Overview* (October 2026)

---

## 0. How to read this document

1. **Section 1** reviews the overview critically: what holds up, what's missing, and what has to change before we build.
2. **Sections 2–12** are the build plan: scope, architecture, data model, AI design, compliance, security, infrastructure.
3. **Sections 13–16** cover delivery: roadmap, testing, launch checklist, risks.
4. **Section 17** lists open decisions that need an owner's answer.

---

## 1. Review of the product idea

### 1.1 What's strong

| Area | Assessment |
|---|---|
| Core idea | Natural-language-to-invoice fixes a real problem. "10h consulting for Acme at $120/h, net 30" is how freelancers already think about their work. |
| Positioning | The space between spreadsheets/templates and full accounting suites (QuickBooks, Xero) is real and underserved for solo service businesses. |
| Business model | A freemium SaaS ladder is the right default for this audience. The $15 and $39 price points are in line with Bonsai, FreshBooks Lite and Invoice Ninja Pro. |
| Scope discipline | The overview deliberately stays out of full accounting. Keep it that way. |

### 1.2 Gaps and risks the overview doesn't cover

These shape the architecture, so they're settled here instead of discovered mid-build.

1. **"AI-assisted calculation" is a liability as written.** LLMs must never be the source of truth for arithmetic, tax rates, or invoice numbers.
   **Decision:** the AI only *extracts structure* (client, line items, quantities, rates, terms). Totals, tax, rounding and currency formatting are computed by deterministic, unit-tested server code. The user always reviews a draft before it becomes an issued invoice.

2. **EU legal invoice requirements are much stricter than the US.** Under the EU VAT Directive (Art. 226) and national law, an issued invoice must have:
   - A **sequential, unique, gap-free number** per issuing entity/series. Germany and others treat gaps as an audit finding.
   - **Immutability once issued.** You don't edit an issued invoice; you issue a **credit note** (cancellation invoice) and a new one.
   - Supplier and customer VAT IDs where applicable, issue date, supply date, net/VAT/gross per rate, and reverse-charge wording for intra-EU B2B.
   - **Retention for 6–10 years**, depending on country (DE 8 years since 2025, FR 10, NL 7, etc.).

   **Decision:** model a strict `DRAFT → ISSUED → (SENT/VIEWED) → PAID | VOID` lifecycle, with credit notes as first-class documents.

3. **Mandatory e-invoicing is arriving in Europe, and it's a market-entry risk.**
   - **Germany:** every business must be able to *receive* structured e-invoices (EN 16931: XRechnung / ZUGFeRD) since 1 Jan 2025. Issuing becomes mandatory for most B2B from 2027–2028.
   - **Belgium:** B2B e-invoicing via Peppol mandatory since 1 Jan 2026.
   - **France:** phased B2B mandate from September 2026 via certified platforms (PA/PDP).
   - **EU ViDA:** cross-border digital reporting from 2030.

   A PDF-only invoice tool will soon be **non-compliant for B2B in several core EU markets.**
   **Decision:** the internal invoice model is EN 16931-shaped from day one. ZUGFeRD/Factur-X hybrid PDF (PDF/A-3 with embedded XML) ships in v1.1. Peppol access-point integration via a partner (e.g., Storecove) is on the roadmap. Germany, Belgium and France are the first EU launch markets to evaluate against this.

4. **US sales tax is mostly out of scope, and that's fine.** Most services billed by freelancers aren't taxable in most states, but some are (e.g., some digital services, and certain states like HI, NM, SD tax most services). v1 supports **user-defined tax rates** with clear "you're responsible for tax correctness" UX. Automated nexus/rate lookup (Stripe Tax / Avalara) is Enterprise-tier roadmap.

5. **"USD/EUR multi-currency" needs a precise definition.** Each invoice has exactly one currency. Store amounts as **integer minor units** (cents). For EU VAT, an invoice in a foreign currency must also show the VAT amount in the supplier's national currency, using an ECB or national bank rate. Plan for GBP, CHF, SEK, PLN, DKK, NOK soon after launch.

6. **Getting paid isn't in the overview, but it's where the value is.** The mission is "remove the friction of getting paid," yet the feature list stops at creating invoices. **Decision:** v1 includes a hosted invoice page with **"Pay now" via Stripe Connect** (cards, SEPA Direct Debit, ACH) and automatic paid-status sync. This is also the second revenue stream (an optional small platform fee), and the strongest retention lever.

7. **Free-tier economics.** "5 invoices/month" is fine, but AI calls cost money and invite abuse. Rate-limit AI generations separately from invoices (e.g., 20 generations/month on free), require a verified email, and add bot protection on signup.

8. **Data protection.** EU customers mean GDPR. Invoices contain their *clients'* personal data, which makes us a **processor**. We need a DPA, a sub-processor list, an EU data-residency option, and a documented legal basis for sending invoice text to an AI provider.

9. **Pricing table gaps.** "Team seats" on Business needs a number (proposal: 3 included, +$8/seat). Annual billing (2 months free) is missing, and it's standard and good for cash flow. Prices should be shown in local currency (€15 / €39 incl. or excl. VAT; B2C pricing in the EU must show VAT-inclusive prices).

10. **Metrics.** The overview has no success metrics. Proposed north star: **invoices paid through the platform per week.** Supporting metrics: time from prompt to issued invoice, AI draft acceptance rate (no edits), free→paid conversion, DSO (days sales outstanding) for users.

### 1.3 Verdict

The idea is sound and buildable. With the corrections above (deterministic math, legal lifecycle, e-invoicing-ready data model, payments in v1), it's a defensible product rather than a thin AI wrapper.

---

## 2. Product scope

### 2.1 Personas

| Persona | Need | Tier |
|---|---|---|
| **Freelancer Fatima** (designer, Berlin, bills DE + US clients) | Fast invoices, correct VAT/reverse charge, EUR + USD | Starter → Pro |
| **Consultant Carlos** (US LLC, bills hourly) | Speed, recurring invoices, card payments | Pro |
| **Agency Anna** (8-person studio, 2 legal entities) | Multiple business profiles, teammates, reporting | Business |
| **Ops at Scale Co.** | API, SSO, integrations | Enterprise |

### 2.2 MVP (v1.0) — must ship

**Accounts & orgs**
- Email+password, magic link, Google/Microsoft OAuth; MFA (TOTP) optional, required for org owners on Business.
- Organization (tenant) → members with roles: Owner, Admin, Member, Accountant (read-only + export).
- Business profiles (legal entity): legal name, address, tax/VAT ID, logo, default currency, payment details, invoice number series, default terms, locale.

**Clients**
- CRUD, with contact email(s), billing address, VAT ID (with EU VIES validation), default currency, default payment terms, notes.
- AI creates a *pending* client from a prompt if none matches; the user confirms.

**Invoices**
- **AI prompt → draft**: free-text (and later voice) input → structured draft shown in an editable form. Field-level highlights where the AI is unsure or inferred something.
- Manual create/edit (the form is the same component as the AI draft).
- Line items: description, qty, unit (hours/days/items), unit price, discount, tax rate; invoice-level discount.
- Lifecycle: Draft → Issued (number assigned, immutable) → Sent → Viewed → Partially paid → Paid | Overdue | Void (by credit note).
- Credit notes.
- PDF generation (branded template; 3 templates in Pro).
- Send by email from the platform (tracked open/view), with PDF attachment + hosted link.
- Hosted invoice page with **Pay now** (Stripe Connect).
- Manual "mark as paid" (bank transfer) with partial payments.
- Automatic payment reminders (configurable schedule).
- Recurring invoices (monthly/weekly/custom) — Pro+.
- Duplicate invoice; "invoice like last time for X" via the AI prompt.

**Dashboard**
- Outstanding, overdue, paid this month/quarter, by currency (no cross-currency sums without explicit FX conversion).
- Top clients, aging buckets (0–30/31–60/61–90/90+).

**Billing (our SaaS subscription)**
- Stripe Billing: plans, trials, annual, proration, customer portal, VAT/GST on our own subscription via Stripe Tax.
- Plan limits enforced server-side (invoices/month, AI generations/month, business profiles, seats).

**Compliance**
- Gap-free per-series numbering, issued immutability, audit log, data export (CSV + all PDFs as ZIP), account deletion with legal-retention exceptions.

### 2.3 v1.x (fast follow, 0–3 months after launch)
- ZUGFeRD / Factur-X (EN 16931) hybrid PDFs; XRechnung XML export.
- More currencies + ECB FX reference rates for VAT display.
- Expenses / billable time import (CSV, Toggl, Harvest).
- Accounting export (DATEV CSV, QuickBooks/Xero sync).
- Localized UI and invoice languages: EN, DE, FR, ES, NL, IT.
- Quotes/estimates → convert to invoice.

### 2.4 v2 (3–9 months)
- Peppol sending/receiving via an access-point partner.
- Public REST API + webhooks, API keys (Enterprise).
- SSO (SAML/OIDC), SCIM.
- AI: smart reminder copy, cash-flow forecast, late-payer prediction, "ask your invoices" Q&A.
- Mobile apps (or PWA first), voice-to-invoice.
- Stripe Tax / Avalara integration for US sales tax.

### 2.5 Explicitly out of scope
Double-entry bookkeeping, payroll, inventory, receipts OCR (until v2+), tax filing.

---

## 3. Key user flows

### 3.1 Prompt → issued invoice (the core loop, target < 60 s)
```
User types: "Website redesign for Acme GmbH, 3 days at €800/day plus €120 hosting,
             19% VAT, due in 14 days"
   │
   ▼
POST /api/ai/invoice-drafts  (stream)
   │  1. Load context: business profile, client list (names + IDs), recent items, defaults
   │  2. Claude extracts structured JSON (schema-constrained)
   │  3. Server resolves client (fuzzy match → existing | new pending client)
   │  4. Server validates + computes totals deterministically
   │  5. Returns Draft + warnings ("Acme GmbH has no VAT ID on file;
   │                               reverse charge not applied")
   ▼
Editable draft form (AI-filled fields highlighted)
   │  user tweaks → Save draft
   ▼
Issue  → transaction: allocate next number in series, freeze snapshot, render PDF
   ▼
Send   → email via provider; hosted page with Pay now
   ▼
Stripe webhook payment_intent.succeeded → Payment recorded → status Paid
```

### 3.2 Correction of an issued invoice
Issued invoices are read-only. "Correct" → creates a credit note for the full amount, referencing the original, plus a new draft pre-filled from the original.

### 3.3 Onboarding (target: first invoice < 3 min)
Sign up → create business profile (prefilled from the email domain where possible, VAT ID lookup via VIES) → "Describe your last job" prompt → draft → issue/send or save.

---

## 4. Architecture

### 4.1 Principles
- **Modular monolith first.** One deployable app, clear domain modules, one Postgres. Split out services only when there's a measured need (PDF rendering and email are the first candidates, and they're already async jobs).
- **The money path is deterministic.** AI is an input-assist layer and never authoritative.
- **Multi-tenant, row-level isolation**, enforced in the data layer, not just in controllers.
- **Everything that can fail and retry runs in a durable job queue.**
- **EU-first data residency**, since that's the stricter regime.

### 4.2 High-level diagram
```
                ┌──────────────────────────── Vercel / Cloud Run (EU + US) ─────────────────────────┐
 Browser ──────►│  Next.js app (App Router)                                                         │
 (React, PWA)   │   ├─ UI (RSC + client components)                                                 │
                │   ├─ Route handlers / server actions  ──►  Domain modules (TypeScript)            │
 Client ───────►│   │   /api/v1 (public API, v2)              invoicing · clients · billing ·      │
 (hosted pay    │   │   /api/webhooks/stripe                  ai · numbering · tax · reporting     │
  page)         │   └─ Auth (Better Auth / Auth.js)                     │                           │
                └───────────────────────────────────────────────────────┼───────────────────────────┘
                                                                        │
       ┌──────────────────────┬─────────────────────┬───────────────────┼─────────────┬──────────────┐
       ▼                      ▼                     ▼                   ▼             ▼              ▼
  PostgreSQL (Neon /     Object storage        Job queue           Anthropic      Stripe         Email
  RDS, EU region,        (S3 / R2: PDFs,       (Inngest or         Claude API     (Billing +     (Postmark /
  PITR, RLS)             logos, exports)       Trigger.dev)        (AI drafts)    Connect)       Resend)
                                                    │
                                     PDF render worker (Playwright/Chromium or
                                     react-pdf), reminders, recurring, exports
```

### 4.3 Tech stack (recommended)

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** end to end | One language for UI, API, jobs; strong typing for money/tax code |
| Web framework | **Next.js 15 (App Router)** | SSR for hosted invoice pages, server actions, big ecosystem |
| UI | Tailwind CSS + shadcn/ui (Radix) | Accessible primitives, fast iteration |
| Forms / validation | React Hook Form + **Zod** (shared schemas client/server/AI) | One schema defines the invoice everywhere |
| ORM / DB | **Drizzle ORM** + **PostgreSQL 16** | SQL-first, typed, good migration story; Postgres RLS for tenancy |
| Auth | **Better Auth** (self-hosted, Postgres-backed) *or* Clerk | Orgs/roles, MFA, OAuth; Better Auth keeps EU data in our DB |
| Payments | **Stripe Billing** (our subs) + **Stripe Connect Express** (users' clients pay users) | Covers US + EU methods (cards, SEPA, ACH, iDEAL, Bancontact) |
| AI | **Anthropic Claude API** via `@anthropic-ai/sdk`, model `claude-opus-5-5` | Structured outputs, strong extraction quality; see §6 |
| Jobs | **Inngest** (or Trigger.dev) | Durable steps, retries, cron for recurring + reminders |
| PDF | HTML templates → **Playwright/Chromium** headless render | Pixel-perfect branded output; PDF/A-3 post-processing for ZUGFeRD via a Java/`mustangproject` sidecar in v1.1 |
| Email | **Postmark** (transactional) | Deliverability, open tracking, inbound for replies later |
| Storage | S3-compatible (AWS S3 eu-central-1 or Cloudflare R2 with EU jurisdiction) | PDFs, logos, exports |
| Hosting | **Vercel** (app) in `fra1` + `iad1`, *or* AWS (ECS Fargate/Cloud Run) if we need full region control | Fast to ship; revisit at scale |
| Observability | Sentry (errors), OpenTelemetry → Grafana/Axiom (traces/logs), PostHog EU (product analytics, feature flags) | |
| CI/CD | GitHub Actions; preview deploys per PR; Drizzle migrations gated | |
| Infra as code | Terraform (DB, buckets, DNS, secrets) | |

### 4.4 Repository layout (monorepo, pnpm + Turborepo)
```
PromptToInvoice/
├─ apps/
│  ├─ web/                 # Next.js app (UI + API routes + webhooks)
│  └─ pdf-worker/          # (optional split) Chromium render service
├─ packages/
│  ├─ core/                # Domain: money, tax, numbering, invoice state machine (pure TS, 100% unit tested)
│  ├─ db/                  # Drizzle schema, migrations, RLS policies, seed
│  ├─ ai/                  # Prompt templates, schemas, Claude client, evals
│  ├─ einvoice/            # EN 16931 mapping, ZUGFeRD/XRechnung (v1.1)
│  ├─ emails/              # React Email templates
│  ├─ ui/                  # Shared components
│  └─ config/              # eslint, tsconfig, tailwind presets
├─ infra/                  # Terraform
├─ docs/                   # This plan, ADRs, runbooks
└─ .github/workflows/
```

---

## 5. Data model (core entities)

All tenant-owned tables carry `org_id` with a Postgres RLS policy `org_id = current_setting('app.org_id')::uuid`. IDs are UUIDv7. Money is `bigint` minor units plus `char(3)` currency. All tables have `created_at`, `updated_at`; soft-delete only where legally safe.

```
organizations(id, name, plan, stripe_customer_id, data_region, created_at)
users(id, email, name, locale, mfa_enabled, ...)
memberships(org_id, user_id, role)                         -- owner|admin|member|accountant

business_profiles(id, org_id, legal_name, trading_name, address jsonb, country,
                  vat_id, tax_id, registration_no, logo_key, default_currency,
                  default_payment_terms_days, bank_details jsonb (encrypted),
                  stripe_connect_account_id, invoice_footer, locale)

number_series(id, org_id, business_profile_id, doc_type,  -- invoice|credit_note
              prefix, pattern,                             -- e.g. "INV-{YYYY}-{SEQ:5}"
              next_value bigint, reset_policy)             -- yearly|never

clients(id, org_id, business_profile_id?, name, email[], address jsonb, country,
        vat_id, vat_id_verified_at, default_currency, payment_terms_days, notes,
        status)                                            -- active|pending|archived

invoices(id, org_id, business_profile_id, client_id, doc_type,       -- invoice|credit_note
         status,                                                      -- draft|issued|sent|viewed|partially_paid|paid|void
         number, series_id, issue_date, supply_date, due_date,
         currency, subtotal_minor, discount_minor, tax_minor, total_minor,
         amount_paid_minor, tax_mode,                                 -- standard|reverse_charge|exempt|outside_scope
         notes, terms, language, template_id,
         corrects_invoice_id,                                         -- for credit notes
         source,                                                      -- manual|ai|recurring|api
         ai_draft_id,
         issued_snapshot jsonb,                                       -- frozen seller+buyer+lines at issue
         pdf_key, einvoice_xml_key, public_token, issued_at, voided_at)

invoice_lines(id, invoice_id, position, description, quantity numeric(18,4), unit,
              unit_price_minor, discount_pct numeric(5,2), tax_rate_id, tax_rate_pct,
              line_net_minor, line_tax_minor)

tax_rates(id, org_id, name, rate_pct, country, category)  -- S, Z, E, AE (reverse charge) per EN 16931

payments(id, org_id, invoice_id, amount_minor, currency, method, -- stripe|bank|cash|other
         stripe_payment_intent_id, received_at, notes)

recurring_schedules(id, org_id, template_invoice_id, rrule, next_run_at, auto_send, active)
reminder_policies(id, org_id, offsets_days int[], channel, template)
ai_drafts(id, org_id, user_id, prompt_text, model, request_id, output jsonb,
          warnings jsonb, latency_ms, input_tokens, output_tokens, accepted, edit_distance)
email_events(id, org_id, invoice_id, type, provider_id, occurred_at)
audit_log(id, org_id, actor_id, action, entity, entity_id, diff jsonb, ip, at)   -- append-only
usage_counters(org_id, period, invoices_issued, ai_generations)
```

### 5.1 Gap-free numbering (critical)
On **Issue**, inside a single DB transaction:
```sql
SELECT next_value FROM number_series WHERE id = $1 FOR UPDATE;
UPDATE number_series SET next_value = next_value + 1 WHERE id = $1;
UPDATE invoices SET number = <formatted>, status = 'issued', issued_snapshot = ..., issued_at = now()
  WHERE id = $2 AND status = 'draft';
```
- Drafts have **no number**. Numbers are only consumed by a successful issue, so nothing gets skipped.
- Unique index on `(series_id, number)`.
- Issued rows are protected by a DB trigger that rejects updates to financial columns once `status <> 'draft'`.

### 5.2 Money & tax engine (`packages/core`)
- Integer minor units; quantities as decimal (`numeric`) with banker's rounding *per line* then summed (configurable per country; EN 16931 rules on rounding).
- Tax computed per tax category per rate (a VAT breakdown is required on EU invoices).
- Reverse charge: when seller and buyer are in different EU states, the buyer has a valid VAT ID, and it's B2B, then 0% with category `AE` and the mandatory note "Reverse charge – Article 196 Council Directive 2006/112/EC".
- Property-based tests (fast-check) for totals invariants: `total = Σ net + Σ tax − discounts`, never negative except credit notes, currency consistency.

---

## 6. AI design

### 6.1 Role of the model
The model **extracts and normalizes**. It doesn't calculate final totals, assign numbers, or decide tax law. It returns a structured draft plus explicit uncertainty flags.

### 6.2 Model & API configuration
- **Provider:** Anthropic Claude API, official TypeScript SDK `@anthropic-ai/sdk`.
- **Model:** `claude-opus-5-5`. After we have an eval set (§6.5), we can run the same eval against cheaper models (e.g., `claude-haiku-5-5`) and pick per route on measured quality vs. cost. That's a business decision for later.
- **Structured outputs:** `output_config: { format: { type: "json_schema", schema } }`, generated from the shared Zod `InvoiceDraftSchema`. The SDK's `messages.parse()` helper validates the response.
- **Effort:** `output_config.effort: "low"` to start for this extraction task (Opus 5.5 defaults to `medium`, so set it explicitly). Tune with evals.
- **Thinking:** adaptive (the default on Opus 5.5; it can't be disabled, so effort is the cost lever).
- **Refusal handling:** check `stop_reason` before reading content; enable server-side `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`).
- **Streaming** to the UI so fields populate progressively.
- **Prompt caching:** stable system prompt + schema first, with a `cache_control` breakpoint; per-request context (client list, user prompt) after it.
- **Data residency:** `inference_geo` set according to the org's region where supported. Review Anthropic's data retention terms and sign a DPA before launch.
- **Timeouts and retries:** SDK defaults (2 retries) plus a 20 s UX timeout, with graceful fallback to the manual form pre-filled with whatever was parsed.

### 6.3 Draft schema (abridged)
```ts
InvoiceDraft = {
  client: { match_id?: string; name: string; email?: string; country?: string; vat_id?: string },
  currency?: "USD" | "EUR" | ...,          // inferred from symbols/text; else profile default
  issue_date?: string; due_date?: string; payment_terms_days?: number,
  lines: Array<{ description: string; quantity: number; unit?: "hour"|"day"|"item"|...;
                 unit_price: string /* decimal string, not float */; tax_rate_pct?: number }>,
  discount?: { type: "percent"|"amount"; value: string },
  notes?: string,
  uncertain_fields: string[],              // JSON paths the model is unsure about
  assumptions: string[]                    // human-readable, shown to the user
}
```

### 6.4 Guardrails
- **Prompt-injection safety:** the user prompt is data. The model has no tools that act (no sending, no DB writes). The only output is a schema-validated draft.
- **Server-side validation** of every field (Zod), with currency/amount sanity bounds and dates within ±2 years.
- **Client matching** is done by the server (trigram/fuzzy over `clients.name`), not the model. The model gets a short candidate list and returns `match_id`, which the server re-verifies.
- **PII minimization:** send only client names and IDs to the model, not addresses or bank details.
- **Abuse limits:** per-org and per-IP rate limits; prompt length cap (2,000 chars); monthly AI quota per plan.
- **Logging:** store prompt, output, tokens, latency in `ai_drafts` (org-scoped, 90-day retention, excluded for orgs that opt out).

### 6.5 Quality measurement
- **Eval set:** 300+ realistic prompts (EN/DE/FR/ES, US/EU, edge cases: mixed currencies, "half day", "same as last month", discounts, typos) with golden structured outputs.
- **Metrics:** field-level exact match, line-item F1, currency accuracy, *zero tolerance* on invented amounts.
- **CI gate:** prompt or model changes must not regress the eval.
- **Production signal:** `accepted` without edits and per-field edit rates from `ai_drafts`.

---

## 7. Payments (Stripe)

| Flow | Stripe product | Notes |
|---|---|---|
| Our subscriptions | Stripe Billing + Checkout + Customer Portal + Stripe Tax | Plans: starter (free), pro, business; monthly/annual; EUR & USD prices |
| Users getting paid | **Stripe Connect Express** | Onboarding in-app; payouts to the user's bank; optional application fee (e.g., 0.5%, Pro waives?) |
| Payment methods | Cards, Apple/Google Pay, SEPA DD, ACH, iDEAL, Bancontact, Link | Via Payment Element on the hosted invoice page |
| Webhooks | `checkout.session.completed`, `customer.subscription.*`, `invoice.paid` (ours), `payment_intent.succeeded/failed`, `account.updated`, `charge.refunded` | Idempotent handler, signature verified, events table for dedupe, processed via job queue |

Bank transfer stays first-class: IBAN/BIC, ACH routing, and an optional EPC QR code ("GiroCode") on EU PDFs.

---

## 8. Compliance

| Topic | Requirement | Implementation |
|---|---|---|
| GDPR | Lawful basis, DPA, sub-processor list, DSAR, deletion, breach process (72h) | DPA template; `/legal/subprocessors`; export & delete endpoints; incident runbook |
| Data residency | EU data stays in the EU for EU orgs | `data_region` per org; EU DB + bucket; US region later for US orgs |
| Invoice retention | 6–10 yrs depending on country | Issued invoices + PDFs retained even after account deletion (data-minimized, access-restricted), then purged by a scheduled job |
| Immutability | Issued invoices unalterable (GoBD in DE) | DB trigger + snapshot + audit log; PDF hash stored |
| E-invoicing | DE/BE/FR mandates | EN 16931 data model now; ZUGFeRD/XRechnung v1.1; Peppol v2 |
| VAT validation | Verify EU VAT IDs | VIES API on client save; store verification timestamp |
| Our own VAT | Charge VAT on SaaS subs (EU B2C OSS, B2B reverse charge) | Stripe Tax |
| Accessibility | EU Accessibility Act (in force June 2025) | WCAG 2.2 AA target; axe in CI |
| Cookies | ePrivacy | Cookieless analytics where possible; consent banner for non-essential |
| SOC 2 | Enterprise sales | Start controls in year 1 (Vanta/Drata); Type I after ~6 months of evidence |

---

## 9. Security

- **Auth:** Argon2id password hashing, MFA (TOTP + passkeys/WebAuthn), session rotation, device/session list, breached-password check.
- **Authorization:** role-based checks in a single policy module plus Postgres **RLS** as defense in depth. Every query runs with `SET LOCAL app.org_id`.
- **Hosted invoice links:** random 128-bit `public_token`, revocable, rate-limited, `noindex`. No other org data is exposed.
- **Secrets:** a cloud secret manager; no secrets in the repo; rotate the Stripe/Anthropic keys.
- **Encryption:** TLS 1.2+ everywhere, encryption at rest (DB and bucket), application-level encryption for bank details (envelope encryption with KMS).
- **Web security:** CSP with nonces, CSRF protection on server actions, strict CORS, HSTS, SameSite cookies, file upload validation (logos: type and size, re-encoded).
- **Webhooks:** signature verification, replay protection, idempotency keys.
- **Supply chain:** Dependabot/Renovate, `pnpm audit`, lockfile, GitHub secret scanning, CodeQL.
- **Abuse:** Turnstile on signup, per-IP and per-org rate limits (Upstash Redis), email sending limits for new accounts (to prevent phishing via our domain).
- **Backups:** PITR (7–30 days), daily logical backups to a separate account, quarterly restore drill.
- **Pen test** before public launch; bug bounty after.

---

## 10. Infrastructure & operations

| Concern | Plan |
|---|---|
| Environments | `local` (Docker Compose: Postgres, MinIO, Mailpit, Stripe CLI) → `preview` (per PR) → `staging` → `production` |
| Regions | Prod EU (Frankfurt) at launch; US region (Virginia) when US share justifies it. Org pinned to a region. |
| DB | Managed Postgres (Neon or AWS RDS), PITR, read replica for reporting later |
| Migrations | Drizzle Kit; expand/contract pattern; run in CI before deploy |
| Jobs | Inngest functions: `render-pdf`, `send-invoice-email`, `run-recurring` (cron hourly), `send-reminders` (cron daily), `process-stripe-event`, `export-org-data`, `purge-retention` |
| Monitoring | Sentry, uptime checks (hosted page, API, webhook endpoint), SLO dashboards |
| SLOs | 99.9% monthly availability for app + hosted pay page; p95 AI draft < 6 s; p95 page TTFB < 500 ms; PDF ready < 10 s p95 |
| Alerting | Webhook failure rate, job DLQ depth, AI error rate, payment failure spikes → PagerDuty/Slack |
| Cost guardrails | AI spend per org tracked (`ai_drafts` tokens); budget alerts on the Anthropic and cloud accounts |
| Runbooks | Stripe outage, AI provider outage (manual form fallback), email bounce storm, DB restore |

---

## 11. Plans & entitlement enforcement

| Entitlement | Starter (Free) | Pro ($15 / €15) | Business ($39 / €39) | Enterprise |
|---|---|---|---|---|
| Issued invoices / month | 5 | Unlimited | Unlimited | Unlimited |
| AI generations / month | 20 | 500 (fair use) | 2,000 (fair use) | Custom |
| Business profiles | 1 | 1 | 5 | Custom |
| Seats | 1 | 1 | 3 incl. (+$8) | Custom |
| Currencies | USD, EUR | All supported | All supported | All |
| Branded templates | Basic | 3 + logo/colors | All + custom | Custom |
| Online payments (Connect) | ✓ (with fee) | ✓ | ✓ | ✓ |
| Recurring invoices, reminders | – | ✓ | ✓ | ✓ |
| Dashboard | Basic | Analytics | Advanced reporting + exports | Custom |
| E-invoice (ZUGFeRD/XRechnung) | – | ✓ (v1.1) | ✓ | ✓ + Peppol |
| API, SSO, SLA | – | – | – | ✓ |
| Annual billing | – | 2 months free | 2 months free | Contract |

Enforced in one `entitlements` module, read from the plan plus overrides, checked server-side on every gated action. Usage counters are incremented transactionally with the action.

---

## 12. API design (internal now, public in v2)

REST, JSON, versioned `/api/v1`, cursor pagination, `Idempotency-Key` header on POSTs, RFC 9457 problem+json errors.

```
POST   /api/v1/ai/invoice-drafts          { prompt, business_profile_id }  → draft (SSE stream)
GET    /api/v1/invoices?status=&client_id=&cursor=
POST   /api/v1/invoices                   create draft
PATCH  /api/v1/invoices/:id               draft only
POST   /api/v1/invoices/:id/issue
POST   /api/v1/invoices/:id/send          { to[], cc[], message }
POST   /api/v1/invoices/:id/credit-note
POST   /api/v1/invoices/:id/payments      manual payment
GET    /api/v1/invoices/:id/pdf
GET    /api/v1/clients ...  POST/PATCH/DELETE
GET    /api/v1/reports/summary?from=&to=&currency=
POST   /api/webhooks/stripe
GET    /i/:public_token                   hosted invoice page (public)
```

Webhooks out (v2): `invoice.issued`, `invoice.sent`, `invoice.viewed`, `invoice.paid`, `invoice.overdue`.

---

## 13. Delivery roadmap

Assumes a team of 2–3 full-stack engineers plus 1 designer (part-time). Durations are estimates.

| Phase | Weeks | Outcomes |
|---|---|---|
| **0. Foundations** | 1–2 | Monorepo, CI/CD, preview deploys, Docker dev env, DB + RLS skeleton, auth (sign-up/in, orgs, roles), design system, ADRs |
| **1. Invoicing core** | 3–6 | `core` money/tax engine with property tests; business profiles; clients (+VIES); invoice CRUD; state machine; gap-free numbering; PDF rendering; audit log |
| **2. AI drafting** | 5–8 (overlaps) | Zod schema → structured output; prompt + caching; client matching; streaming UI with uncertainty highlights; eval harness (300 cases) in CI |
| **3. Send & get paid** | 7–10 | Email sending + tracking; hosted invoice page; Stripe Connect onboarding + Payment Element; webhooks; manual payments; reminders; recurring |
| **4. SaaS billing & limits** | 9–11 | Stripe Billing plans, checkout, portal, Stripe Tax; entitlements; usage counters; upgrade prompts |
| **5. Dashboard & exports** | 10–12 | KPIs, aging, CSV/ZIP export, GDPR export/delete |
| **6. Hardening** | 12–14 | Security review + external pen test, load test (k6), accessibility audit, backups/restore drill, runbooks, legal pages (ToS, Privacy, DPA, sub-processors), status page |
| **Private beta** | 14–16 | 50–100 freelancers (DE, NL, US); instrumentation; fix loop |
| **Public launch (v1.0)** | ~16 | Product Hunt/communities; pricing live |
| **v1.1** | +4–8 | ZUGFeRD/Factur-X/XRechnung, more currencies, i18n (DE/FR/ES), quotes, accounting exports |
| **v2** | +3–6 months | Public API + webhooks, SSO, Peppol, AI insights, PWA/mobile |

### Definition of done (every feature)
Typed end to end · unit tests (core ≥ 95% coverage) · e2e happy path (Playwright) · authorization and RLS test · audit log entry for mutations · analytics event · docs/ADR updated · accessible (axe clean) · feature-flagged if risky.

---

## 14. Testing strategy

| Level | Tooling | Focus |
|---|---|---|
| Unit | Vitest + fast-check | Money, tax, rounding, numbering format, state machine, entitlements |
| Integration | Vitest + Testcontainers (Postgres) | RLS isolation (org A can't read org B), numbering concurrency (100 parallel issues → no gaps or dupes), webhook idempotency |
| AI evals | Custom harness in `packages/ai/evals` | Field accuracy, no invented amounts; run on prompt/model change |
| E2E | Playwright | Sign-up → prompt → issue → send → pay (Stripe test mode) → paid |
| Visual | Playwright screenshots of PDF templates | Template regressions |
| Load | k6 | 200 rps on read paths, 20 rps AI drafts, PDF queue throughput |
| Security | CodeQL, OWASP ZAP baseline on staging, external pen test | |
| Compliance | Golden-file tests for EN 16931 XML against official validators (KoSIT) | v1.1 |

---

## 15. Launch checklist

- [ ] Legal entity, business bank account, Stripe platform account approved for Connect
- [ ] ToS, Privacy Policy, DPA, sub-processor list, cookie policy, imprint (DE "Impressum")
- [ ] Anthropic commercial terms + DPA reviewed; data-retention settings confirmed
- [ ] Domain, SPF/DKIM/DMARC for sending domain; dedicated sending subdomain
- [ ] Pen test findings resolved (no high/critical)
- [ ] Backups verified by restore drill
- [ ] Status page + support inbox + in-app help
- [ ] Monitoring/alerts tested end to end
- [ ] Pricing pages in USD and EUR (EU B2C VAT-inclusive)
- [ ] Analytics funnel: sign-up → first draft → first issued → first paid → upgrade

---

## 16. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AI produces a wrong amount and the user sends it | Medium | High (trust) | Deterministic math, mandatory review step, highlighted inferred fields, evals with zero-tolerance metric |
| EU e-invoicing mandates make PDF-only obsolete | High | High | EN 16931 model now; ZUGFeRD v1.1; Peppol partner v2 |
| Incumbents add an "AI invoice" button | High | Medium | Win on speed, payments, EU compliance depth, and price; build distribution early |
| Stripe Connect onboarding friction / KYC rejects | Medium | Medium | Bank transfer and QR as first-class; clear onboarding UX |
| AI cost per free user too high | Medium | Medium | Quotas, prompt caching, effort tuning, model-per-route after evals |
| Data breach | Low | Critical | RLS, encryption, MFA, least privilege, pen tests, SOC 2 roadmap |
| Email deliverability / our domain used for phishing | Medium | High | Sending limits for new accounts, link scanning, DMARC, reputation monitoring |
| Gapped numbering bug | Low | High (compliance) | Transactional allocation, unique index, concurrency tests, alert on gaps |

---

## 17. Open decisions (need owner input)

1. **Hosting:** Vercel (fastest) vs. AWS/GCP (full region control, cheaper at scale)? *Recommendation: Vercel + Neon EU now, revisit at ~5k paying orgs.*
2. **Auth:** Better Auth (self-hosted, data in our DB) vs. Clerk (faster, external processor)? *Recommendation: Better Auth for EU data control.*
3. **First EU launch countries:** *Recommendation: Germany + Netherlands + Ireland (English) first; France after the PDP decision.*
4. **Connect platform fee:** 0%, 0.5%, or tier-dependent?
5. **Business seats:** 3 included + $8/seat. Confirm.
6. **Brand/domain** and company jurisdiction (affects VAT registration and Stripe platform country).
7. **Free-tier AI quota:** 20/month. Confirm after measuring real cost per draft in beta.

---

## Appendix A — Immediate next steps (week 1)

1. Confirm the open decisions in §17.
2. Scaffold the monorepo (`pnpm`, Turborepo, Next.js, Drizzle, Tailwind/shadcn, Vitest, Playwright), CI, and Docker Compose dev env.
3. Write ADR-001 (modular monolith), ADR-002 (money as minor units + deterministic engine), ADR-003 (EN 16931-shaped invoice model), ADR-004 (AI as extraction-only).
4. Implement `packages/core` money + tax + numbering with property tests. This is the foundation everything else trusts.
5. Collect 100 real invoice-description prompts from target users to seed the AI eval set.
