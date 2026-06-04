# Security Review — 2026-06-03

**Project**: finbot
**Scope**: Full monorepo — `packages/api` (Hono + Drizzle backend) + `packages/dashboard` (React + Vite frontend)
**Auditor**: Claude Code via /core:security-audit
**Methodology**: Static analysis only — no infrastructure was contacted.

> **Context note:** This is a personal, single-tenant finance tracker on a personal GitHub repo — **not** a Pluggy platform or Pluggy-integration project. The Pluggy-specific threat-model items (connector credentials, Open Finance tokens, Pluggy webhook signing, Connect Token vs API Key, payment idempotency) are **N/A** and listed under Info. The audit applied the generic web-app subset: tenant isolation, IDOR, SQLi, auth/JWT, secrets, PII logging, CORS, XSS/CSP, crypto, rate limiting, uploads, SSRF, dependencies.

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 2 |
| Medium   | 5 |
| Low      | 7 |
| Info     | 3 |
| **Total**| 17 |

The app's **core authorization model is sound**: every data query is scoped by `householdId` pulled from the verified JWT (not from request input), household membership is checked before every privileged action, and Drizzle's query builder parameterizes all SQL — no injection, no IDOR, no cross-tenant leakage found. The frontend has no `dangerouslySetInnerHTML`/`innerHTML` sinks. `.env` is gitignored and absent from all 43 commits of git history.

The most important fixes are: **(1)** remove the hardcoded `JWT_SECRET` fallback (`"change-me-in-production"`) and add fail-fast env-var validation at startup, and **(2)** upgrade vulnerable runtime dependencies (`drizzle-orm`, `hono`, `@hono/node-server`, and `lodash` via `recharts`).

## Methodology

Tools that ran:
- **semgrep** 1.157.0 — packs: `p/owasp-top-ten`, `p/typescript`, `p/javascript`, `p/react`, `p/secrets`, `p/nodejs` (45 source files, 0 engine errors)
- **osv-scanner** 2.3.8 — against `pnpm-lock.yaml` (526 packages)
- **gitleaks** 8.30.1 — working tree (`gitleaks dir`) + full history (`gitleaks git --all`, 43 commits)
- **trivy** 0.70.0 — `fs` with vuln + secret + misconfig scanners
- **pnpm audit** 11.1.2 — 29 advisories
- **hadolint** 2.14.0 — Dockerfile
- Manual review of the full code against the threat-model checklist

Tools skipped: **trufflehog** (not installed; gitleaks + trivy-secret cover the same ground). `eslint-plugin-security` not run (not configured in repo; skill forbids adding new ESLint config).

## Findings

### High

#### SEC-001 — Hardcoded `JWT_SECRET` fallback enables token forgery

- **Severity**: High (Critical if the production deploy ever runs without `JWT_SECRET` set)
- **Category**: Configuration / Authentication
- **Location**: [`packages/api/src/config/env.ts:14`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/config/env.ts#L14), consumed at [`packages/api/src/middleware/auth.ts:4`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/middleware/auth.ts#L4)
- **Detected by**: manual review

**Problem**
`JWT_SECRET` falls back to a publicly-known literal when the env var is unset:
```typescript
// packages/api/src/config/env.ts:14
JWT_SECRET: process.env.JWT_SECRET ?? "change-me-in-production",
```
This is the dangerous "hardcoded fallback" pattern (distinct from a fail-fast check): the app boots happily with a known secret instead of refusing to start. There is no startup validation anywhere (see SEC-003), so a missing/empty `JWT_SECRET` in any environment silently degrades to `"change-me-in-production"`.

**Risk**
The same secret signs and verifies all auth tokens (`hono/jwt`, HS256). If the app ever runs with the fallback, anyone can forge a valid JWT by signing `{ sub: <any userId>, householdId: <any householdId>, exp: ... }` with `"change-me-in-production"` — full account takeover and cross-household data access, defeating the otherwise-solid tenant isolation. The local `.env` does set a real UUID secret, so dev is currently safe; the exposure is the production Docker path, which depends entirely on the env var being present.

**Actionables**
- Remove the fallback; read `process.env.JWT_SECRET` and throw at startup if missing/short (see SEC-003).
- Require a minimum length (≥ 32 bytes) and reject the literal `"change-me-in-production"`.
- Reference: [CWE-798](https://cwe.mitre.org/data/definitions/798.html) (hardcoded credentials).

---

#### SEC-002 — Vulnerable runtime dependencies

- **Severity**: High
- **Category**: Dependencies
- **Location**: [`packages/api/package.json`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/package.json), [`packages/dashboard/package.json`](https://github.com/FranDisalvo90/finbot/blob/main/packages/dashboard/package.json)
- **Detected by**: osv-scanner, trivy, pnpm audit

**Problem**
Several **runtime** (production) dependencies have known CVEs:

| Package | Installed | Severity | Fixed in | Note |
|---|---|---|---|---|
| `drizzle-orm` | 0.38.4 | High | 0.45.2 | direct API dep |
| `hono` | 4.12.5 | 14 CVEs (medium/low) | ≥ 4.12.18 | direct API dep |
| `@hono/node-server` | 1.19.10 | Medium | 1.19.13 | direct API dep |
| `lodash` | 4.17.23 | High + Medium | 4.18.0 | transitive via `recharts` (dashboard) |

**Risk**
The web framework (`hono`) and ORM (`drizzle-orm`) sit directly in the request path, so their CVEs are the most reachable. `lodash` is transitive and needs a `recharts` bump or a pnpm `override`.

**Actionables**
- Bump `hono` ≥ 4.12.18, `@hono/node-server` ≥ 1.19.13, `drizzle-orm` ≥ 0.45.2 (review the Drizzle changelog for breaking changes).
- Add a pnpm `overrides` entry forcing `lodash` ≥ 4.18.0, or update `recharts`.
- Re-run `pnpm audit` / `osv-scanner` after upgrading.

---

### Medium

#### SEC-003 — No startup validation of required environment variables

- **Severity**: Medium
- **Category**: Configuration
- **Location**: [`packages/api/src/config/env.ts:8-18`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/config/env.ts#L8-L18)
- **Detected by**: manual review

**Problem**
Every secret/config value uses `?? <default>` (`JWT_SECRET`, `GOOGLE_CLIENT_ID`, `DATABASE_URL`, Splitwise creds), so the app always boots even when critical secrets are absent — silently substituting insecure defaults rather than failing fast. This is the gap that turns SEC-001 from "impossible" into "conditional."

**Actionables**
- Adopt a schema-based loader (`zod`, `envalid`, or `t3-env`) that throws at boot when `JWT_SECRET` / `GOOGLE_CLIENT_ID` / `DATABASE_URL` are missing or empty.
- Keep harmless local defaults (e.g. `PORT`) but never for secrets.

---

#### SEC-004 — Wildcard CORS on all routes

- **Severity**: Medium
- **Category**: Configuration
- **Location**: [`packages/api/src/app.ts:18`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/app.ts#L18)
- **Detected by**: manual review

**Problem**
`app.use("*", cors())` applies Hono's default CORS, which reflects `Access-Control-Allow-Origin: *` for every route, including the authenticated `/api/*` surface.

**Risk**
Mitigated because auth uses a `Bearer` token in the `Authorization` header (not cookies), so `*` without `credentials` can't drive a classic CSRF/credentialed cross-origin read. Still, any website can call the API with a token it has obtained, and there's no origin allowlist for the dashboard.

**Actionables**
- Restrict to the dashboard origin(s): `cors({ origin: [<dashboard-url>] })`, env-driven per environment.

---

#### SEC-005 — No CSP / security headers; JWT stored in `localStorage`

- **Severity**: Medium
- **Category**: Frontend / Configuration
- **Location**: [`packages/dashboard/src/lib/auth.tsx:82`](https://github.com/FranDisalvo90/finbot/blob/main/packages/dashboard/src/lib/auth.tsx#L82), served from [`packages/api/src/app.ts:38-46`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/app.ts#L38-L46)
- **Detected by**: manual review

**Problem**
The 7-day JWT is kept in `localStorage`, and the server serves the SPA with no `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, or HSTS headers. No XSS sink exists today, but if one is ever introduced, `localStorage` tokens are directly exfiltratable.

**Actionables**
- Add a `secureHeaders()` middleware (Hono ships one) with a CSP for the served HTML.
- Consider an httpOnly cookie for the token (larger change), or accept the localStorage tradeoff and compensate with a strict CSP.

---

#### SEC-006 — Household invite codes use non-cryptographic randomness

- **Severity**: Medium
- **Category**: Crypto
- **Location**: [`packages/api/src/routes/households.ts:27-34`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/households.ts#L27-L34)
- **Detected by**: manual review

**Problem**
```typescript
code += chars[Math.floor(Math.random() * chars.length)];
```
Invite codes (8 chars) are generated with `Math.random()`, which is not cryptographically secure and is potentially predictable. These codes grant a new member full access to a household's financial data.

**Risk**
An attacker who can observe or predict `Math.random()` state, or who brute-forces the 48h-valid code space, could join a household uninvited. Brute force is the more realistic vector (no rate limiting on `/join` — see SEC-009).

**Actionables**
- Use `crypto.randomBytes`/`crypto.randomInt` (or `crypto.randomUUID`) for invite codes.
- Add attempt rate limiting / lockout on `POST /api/households/join`.

---

#### SEC-007 — Container runs as root

- **Severity**: Medium
- **Category**: Configuration (container)
- **Location**: [`Dockerfile:23-45`](https://github.com/FranDisalvo90/finbot/blob/main/Dockerfile#L23-L45)
- **Detected by**: semgrep, trivy, hadolint

**Problem**
The production stage has no `USER` directive, so the Node process runs as `root` (CWE-250). A code-exec or container-escape bug then has root in the container.

**Actionables**
- Add a non-root user in the production stage: `RUN useradd -m app && USER app` (or use node:22-slim's built-in `node` user: `USER node`).
- Add a `HEALTHCHECK` (see SEC-016).

---

### Low

#### SEC-008 — No upload size limit; unbounded in-memory preview/state stores

- **Severity**: Low
- **Category**: Code / Configuration
- **Location**: [`packages/api/src/routes/import.ts:16-25`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/import.ts#L16-L25), [`packages/api/src/routes/splitwise.ts:14`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/splitwise.ts#L14)
- **Detected by**: manual review

**Problem**
`/api/import/upload` reads the whole uploaded file into a `Buffer` with no size cap before PDF/CSV parsing. The `previews` map (import.ts:16) is only cleared on confirm, and `oauthStates` is cleared opportunistically — both grow unbounded under repeated requests.

**Risk**
Memory-exhaustion DoS. Low for a personal single-user app; worth bounding anyway.

**Actionables**
- Enforce a max upload size (e.g. reject `Content-Length` > 5 MB).
- Add TTL/size eviction to the `previews` map (or move previews to the DB / a keyed cache with expiry).

---

#### SEC-009 — No rate limiting on auth/public endpoints

- **Severity**: Low
- **Category**: Configuration
- **Location**: [`packages/api/src/app.ts:21-23`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/app.ts#L21-L23)
- **Detected by**: manual review

**Problem**
No rate limiting on `/api/auth/google`, `/api/splitwise/callback`, or `/api/households/join`. Compounds SEC-006 (invite-code brute force).

**Actionables**
- Add per-IP rate limiting middleware on public/auth routes.

---

#### SEC-010 — Splitwise access token stored in plaintext at rest

- **Severity**: Low
- **Category**: Code / Data handling
- **Location**: [`packages/api/src/routes/splitwise.ts:216-222`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/splitwise.ts#L216-L222) (column `users.splitwiseAccessToken`)
- **Detected by**: manual review

**Problem**
The Splitwise OAuth access token is persisted unencrypted in the `users` table.

**Risk**
DB read access (backup leak, SQLi elsewhere, ops access) exposes a usable third-party token. Low for a personal app with one DB, but tokens deserve encryption at rest.

**Actionables**
- Encrypt the token column (app-level envelope encryption or Postgres `pgcrypto`), or document the accepted risk.

---

#### SEC-011 — Financial descriptions logged to stdout and sent to the AI provider

- **Severity**: Low
- **Category**: Data handling / Logging
- **Location**: [`packages/api/src/services/categorizer.ts:49,73,104,124`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/services/categorizer.ts#L49-L124)
- **Detected by**: manual review

**Problem**
Expense descriptions (merchant names, amounts) are interpolated into the Anthropic prompt (by design — this is the categorization feature) and the raw model response is `console.log`'d. Descriptions are financial PII.

**Risk**
Low: sending to Anthropic is intended; stdout logs are local. Becomes higher if logs ship to a third-party aggregator without scrubbing.

**Actionables**
- Drop or redact the `raw response` / description logs in production (gate on `NODE_ENV`).

---

#### SEC-012 — Long-lived (7-day) JWT with no revocation

- **Severity**: Low
- **Category**: Authentication
- **Location**: [`packages/api/src/routes/auth.ts:66-76`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/auth.ts#L66-L76)
- **Detected by**: manual review

**Problem**
Tokens are valid for 7 days with no refresh or server-side revocation list; logout only clears `localStorage`. A stolen token is usable for its full lifetime.

**Actionables**
- Shorten lifetime + add a refresh flow, or maintain a revocation/`tokenVersion` check. Accept-and-document if out of scope for a personal app.

---

#### SEC-013 — Dev-only dependency vulnerabilities

- **Severity**: Low
- **Category**: Dependencies
- **Location**: [`pnpm-lock.yaml`](https://github.com/FranDisalvo90/finbot/blob/main/pnpm-lock.yaml)
- **Detected by**: osv-scanner, pnpm audit

**Problem**
Dev/build-tooling CVEs not in the production runtime: `vitest` 4.0.18 (Critical, fix 4.1.0), `vite` 6.4.1 (High, fix 6.4.2), `esbuild` (dev-server SSRF, via drizzle-kit), `postcss`, `flatted`, `picomatch`, `brace-expansion`.

**Risk**
Low — these run only on the developer's machine/CI, not in production. The `esbuild`/`vite` dev-server issues matter only when the dev server is exposed.

**Actionables**
- Bump `vitest` ≥ 4.1.0 and `vite` ≥ 6.4.2; refresh the lockfile to pull patched transitive build tooling.

---

#### SEC-014 — Live secrets present in local `.env` (expected; not committed)

- **Severity**: Low
- **Category**: Secrets
- **Location**: local `.env` (gitignored — [`/.gitignore:3`](https://github.com/FranDisalvo90/finbot/blob/main/.gitignore#L3))
- **Detected by**: gitleaks (working tree)

**Problem**
The working-tree `.env` holds a real Anthropic API key, the Splitwise client secret, and the JWT secret. gitleaks confirms these are **only** in the working tree — `.env` is gitignored and absent from all 43 commits of history, so this is the *correct* place for them, not a leak.

**Risk**
Low and local-only. Listed for completeness and because the Anthropic key is live/chargeable.

**Actionables**
- No action required for the repo. Rotate only if the machine is shared/compromised. Keep `.env.example` placeholders-only (currently correct).

---

### Info

#### SEC-015 — Prompt-injection surface in AI categorizer
Expense descriptions are interpolated into the LLM prompt ([`categorizer.ts:75-93`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/services/categorizer.ts#L75-L93)). A crafted description could nudge categorization, but impact is limited to mis-categorizing the attacker's own expenses (results are validated against the household's own category list). Informational.

#### SEC-016 — Dockerfile hardening notes
No `HEALTHCHECK` (trivy DS-0026, Low) and consecutive `RUN` layers (hadolint DL3059) in [`Dockerfile`](https://github.com/FranDisalvo90/finbot/blob/main/Dockerfile). Defense-in-depth / image-quality only.

#### SEC-017 — Pluggy-specific threat-model items: N/A
This is not a Pluggy platform/integration project, so the following were checked and found inapplicable: connector-credential handling (PLG-03), Open Finance token handling (PLG-04), Pluggy webhook authenticity/idempotency (PLG-05, 20, 21), `clientUserId` linking (PLG-22), Connect Token vs API Key (PLG-19), payment idempotency (PLG-24), sandbox widget flags (PLG-25), `onSuccess` reliance (PLG-26). The Splitwise OAuth flow **does** correctly implement CSRF `state` validation ([`splitwise.ts:182-186`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/splitwise.ts#L182-L186)) and does not derive its redirect URI from user input.

## Excluded findings

- `packages/api/src/routes/__tests__/*.test.ts`, `packages/api/src/services/__tests__/*.test.ts` — test files; semgrep found no issues.
- `.env.example` lines 1, `ANTHROPIC_API_KEY=`, `GEMINI_API_KEY=` — placeholder/empty values, not real secrets.
- `DATABASE_URL` = `postgres:postgres@localhost:5433` — default local Docker dev credential, matches `.env.example`.

## Appendix: Raw tool outputs

Under `/tmp/security-audit-20260603-100223/`: `osv.json`, `pm-audit.json`, `trivy-vuln.json`, `gitleaks-tree.json`, `gitleaks-history.json`, `trivy-secrets.json`, `semgrep.json`, `trivy-misconfig.json`, `hadolint.json` (not committed).
