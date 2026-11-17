# Security

## Threat model (summary)

| Asset                             | Main threats                                         | Primary controls                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant data (clients, invoices)   | Cross-tenant reads/writes, IDOR                      | Postgres RLS (`FORCE`, `tenant_isolation`) on every `org_id` table; app role can't bypass it; `sysDb` (BYPASSRLS) used only with explicit org filters |
| Accounts                          | Credential stuffing, mailbox takeover, session theft | Argon2 hashes, per-IP limits, TOTP enforced on **every** sign-in path, httpOnly/secure cookies, session re-validation per request                     |
| Issued documents                  | Tampering, deletion                                  | DB triggers make issued invoices/lines/payments immutable; deletion only via the retention purge                                                      |
| Money                             | Forged payment confirmations                         | Stripe signature + timestamp, event-id dedupe, PaymentIntent uniqueness, events bound to the invoice's own connected account                          |
| Bank details, webhook/API secrets | Disclosure at rest or in logs                        | AES-GCM at the application layer with per-record AAD, logger redaction, API keys stored as SHA-256 only                                               |
| Infrastructure                    | SSRF via outbound webhooks                           | https-only, range-based egress policy (incl. IPv4-in-IPv6 forms), connection pinned to vetted addresses, no redirects                                 |
| Rate limits                       | Bypass via spoofed `X-Forwarded-For`                 | Right-to-left resolution past `TRUSTED_PROXIES`; IPv6 bucketed to /64                                                                                 |
| Browser                           | XSS, clickjacking, open redirect                     | Per-request nonce CSP with `strict-dynamic`, `frame-ancestors 'none'`, escaped templates, normalised redirect validation                              |

## Review log

### 2026-11-17, pre-launch review (independent reviewer, then verified and fixed)

Every finding was reproduced before fixing and has a regression test.

| #   | Severity | Finding                                                                                                              | Resolution                                                                                              |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Medium   | `safeNext` validated the input, not the normalised path: `/.//evil.com` → `//evil.com` (open redirect after sign-in) | Validate the normalised result (`safe-redirect.test.ts`)                                                |
| 2   | Medium   | SSRF guard missed hex IPv4-mapped IPv6 (`::ffff:7f00:1`), compat/NAT64/6to4 forms, and had a DNS-rebinding window    | Range-based policy + connection pinning via a checked `lookup` (`net/egress.test.ts`)                   |
| 3   | Medium   | Magic link / OAuth / verify-email auto sign-in skipped TOTP                                                          | Session-creation hook redirects 2FA users to password + code (`e2e/auth.spec.ts`)                       |
| 4   | Low–Med  | Organisation plugin endpoints (invite, role change, delete org) bypassed seat limits, audit and soft-deletion        | HTTP allow-list (invitee endpoints only); plugin org deletion disabled                                  |
| 5   | Low      | Stripe Connect events not tied to the sending account                                                                | Payment must come from the invoice profile's own account; connected-account subscription events ignored |
| 6   | Low      | Public quote answers ignored expiry and could be flipped; refused answers still showed "Accepted"                    | Public answers final and expiry-checked; route only confirms recorded answers                           |
| 7   | Low      | API keys outlived the member who created them                                                                        | Revoked on member removal                                                                               |

Also found during hardening (not by the reviewer): client IPs taken from the first
`X-Forwarded-For` entry let any client dodge per-IP rate limits; fixed with `client-ip.ts`.

Verified correct in the same review: RLS coverage, `sysDb` call sites, role matrix,
public-token entropy and scope, webhook signature handling, idempotency scoping, file
access, SQL parameterisation, CSV formula escaping, template escaping, log redaction.

## Reporting

Email the address configured as `LEGAL_EMAIL` with details and a way to reproduce.
