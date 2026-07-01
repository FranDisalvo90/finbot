# Security Review — 2026-06-08

**Project**: finbot
**Scope**: Full monorepo — `packages/api` (Hono + Drizzle backend) + `packages/dashboard` (React + Vite frontend)
**Auditor**: Claude Code via /core:security-audit
**Methodology**: Static analysis only — no infrastructure was contacted.

> **Context note:** Personal, single-tenant finance tracker on a personal GitHub repo. Pluggy-specific items (connector credentials, Open Finance, Pluggy webhooks, Connect Token, payment idempotency) remain **N/A** for the same reasons as the [2026-06-03 review](./2026-06-03-security-review.md).

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 1 |
| Medium   | 6 |
| Low      | 7 |
| Info     | 5 |
| **Total**| 19 |

**Since the [2026-06-03 review](./2026-06-03-security-review.md):**

- ✅ **Fixed**: prior SEC-001 (`JWT_SECRET` hardcoded fallback) and prior SEC-002 (vulnerable runtime deps `drizzle-orm`/`hono`/`@hono/node-server`/`lodash`) — both confirmed remediated by commits [`8b2047c`](https://github.com/FranDisalvo90/finbot/commit/8b2047c) and [`7a8c4da`](https://github.com/FranDisalvo90/finbot/commit/7a8c4da). `env.ts` now fails fast on missing, short, or default `JWT_SECRET`. All four flagged runtime deps are at fixed versions, no open CVEs.
- ⚠️ **New**: `react-router-dom 7.13.1` now has 6 unpatched CVEs (4 High, 2 Medium), including two XSS-class advisories — easiest single fix in this report.
- ⚠️ **New**: cross-household `categoryId`/`parentId` injection — the one route family that bypasses the documented "every query is scoped by `householdId`" invariant. Low practical impact (UUIDs aren't enumerable), but it should be closed.
- ➡️ **Unchanged**: all Medium/Low findings from the prior review are still present (CORS wildcard, CSP/localStorage JWT, Math.random invite codes, Dockerfile-as-root, no rate limiting, Splitwise token plaintext at rest, dev-dep CVEs, etc.).

Core auth model remains sound: JWT verified via `hono/jwt` HS256, `householdId` pulled from the verified payload (never trusted from input), Drizzle parameterizes queries (no injection), no XSS sinks (`dangerouslySetInnerHTML`/`innerHTML`/`eval`/`Function` constructor) in application code.

## Cross-reference with prior review

| Prior ID | This report | Status |
|---|---|---|
| SEC-001 (`JWT_SECRET` fallback) | SEC-016 (Info — verified) | ✅ Fixed |
| SEC-002 (vuln runtime deps) | SEC-016 (Info — verified) | ✅ Fixed |
| SEC-003 (no env validation) | SEC-007 | ↘ Partially fixed (only `JWT_SECRET`); downgraded |
| SEC-004 (wildcard CORS) | SEC-003 | ➡ Unchanged |
| SEC-005 (no CSP / localStorage) | SEC-004 | ➡ Unchanged |
| SEC-006 (Math.random invite) | SEC-005 | ➡ Unchanged |
| SEC-007 (Dockerfile root) | SEC-006 | ➡ Unchanged |
| SEC-008 (upload size / previews) | SEC-008 | ➡ Unchanged |
| SEC-009 (no rate limiting) | SEC-009 | ➡ Unchanged |
| SEC-010 (Splitwise token at rest) | SEC-010 | ➡ Unchanged |
| SEC-011 (PII in logs) | SEC-011 | ➡ Unchanged |
| SEC-012 (long-lived JWT) | SEC-012 | ➡ Unchanged |
| SEC-013 (dev-only CVEs) | SEC-013 | ➡ Unchanged (list refreshed) |
| SEC-014 (local `.env`) | SEC-014 | ➡ Unchanged (no new history leaks) |
| SEC-015 (prompt injection) | SEC-018 | ➡ Info, unchanged |
| SEC-016 (Dockerfile hardening) | SEC-019 | ➡ Info, unchanged |
| SEC-017 (Pluggy N/A) | SEC-020 | ➡ Info, unchanged |
| — | **SEC-001** | 🆕 New (react-router) |
| — | **SEC-002** | 🆕 New (cross-household categoryId) |
| — | **SEC-015** | 🆕 New (brace-expansion runtime transitive) |
| — | SEC-017 | 🆕 Info (Splitwise sync code review) |

## Methodology

Tools that ran:

- **semgrep** (latest from `/opt/homebrew/bin/semgrep`) — packs: `p/owasp-top-ten`, `p/typescript`, `p/javascript`, `p/react`, `p/secrets`, `p/nodejs` (96 source files, 0 errors, 1 finding).
- **osv-scanner** 2.3.8 — recursive scan against `pnpm-lock.yaml` (526 packages).
- **gitleaks** 8.30.1 — working tree (`gitleaks dir`) + full history (`gitleaks git --all`, 44 commits).
- **trivy** 0.70.0 — `fs` with vuln, secret, and misconfig scanners.
- **pnpm audit** 11.1.2.
- **hadolint** 2.14.0 — `Dockerfile`.
- **pnpm lint** (ESLint flat config, no security plugin) — 0 errors, 2 unrelated warnings.
- Manual review of every route file (`auth`, `households`, `expenses`, `categories`, `reports`, `import`, `rules`, `splitwise`), config, middleware, parsers, categorizer, splitwise-client/sync, and frontend `auth.tsx` / `api.ts`, against the Pluggy threat-model checklist adapted for FinBot's `householdId` model.

Tools skipped: **trufflehog** (not installed; gitleaks + trivy-secret cover the same ground).

## Findings

### High

#### SEC-001 — `react-router-dom 7.13.1` ships in dashboard runtime with 6 unpatched CVEs (4 High, 2 Medium)

- **Severity**: High
- **Category**: Dependencies
- **Location**: [`packages/dashboard/package.json`](https://github.com/FranDisalvo90/finbot/blob/main/packages/dashboard/package.json), [`pnpm-lock.yaml`](https://github.com/FranDisalvo90/finbot/blob/main/pnpm-lock.yaml)
- **Detected by**: osv-scanner, pnpm audit, trivy

**Problem**

The dashboard ships `react-router-dom 7.13.1`. The OSV database now has six advisories against that version:

| CVE | Severity | Fixed in | Note |
|---|---|---|---|
| CVE-2026-42211 | High | 7.14.2 | Arbitrary constructor invocation via TYPE_ERROR deserialization in vendored `turbo-stream` |
| CVE-2026-33245 | High | 7.13.2 | XSS via `javascript:` redirect targets in unstable RSC handling |
| CVE-2026-42342 | High | 7.15.0 | DoS via unbounded path expansion in `__manifest` endpoint |
| CVE-2026-34077 | High | 7.14.0 | DoS via reflected user input in single-fetch |
| CVE-2026-40181 | Medium | 6.30.4 | Open redirect via protocol-relative `//` path |
| CVE-2026-33244 | Medium | 7.13.2 | Stored XSS via unescaped Location header in prerendered redirect HTML |

**Risk**

The two XSS-class advisories (CVE-2026-33245 and CVE-2026-33244) are the most concerning — XSS in a single-page app where the JWT lives in `localStorage` (SEC-004) is directly exfiltratable. Practical exposure depends on whether the dashboard exercises the affected code paths (RSC handling, prerendering, single-fetch). The DoS items matter less for a single-user app, but the version is still vulnerable. A single bump to `^7.15.0` resolves all six.

**Actionables**

- `cd packages/dashboard && pnpm update react-router-dom@^7.15.0` (and the matching `react-router` peer).
- Re-run `pnpm audit` / `osv-scanner -r .` to confirm.
- Reference: [GHSA-49rj-9fvp-4h2h](https://github.com/advisories/GHSA-49rj-9fvp-4h2h), [GHSA-8646-j5j9-6r62](https://github.com/advisories/GHSA-8646-j5j9-6r62).

---

### Medium

#### SEC-002 — Cross-household `categoryId` / `parentId` injection (tenant-isolation gap)

- **Severity**: Medium
- **Category**: Authorization / Tenant isolation
- **Location**:
  - [`packages/api/src/routes/expenses.ts:60`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/expenses.ts#L60) — `POST /api/expenses`
  - [`packages/api/src/routes/expenses.ts:87`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/expenses.ts#L87) — `PUT /api/expenses/:id`
  - [`packages/api/src/routes/categories.ts:37`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/categories.ts#L37) — `POST /api/categories` (`parentId`)
  - [`packages/api/src/routes/import.ts:237`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/import.ts#L237) — `PUT /api/import/categorize/:expenseId`
- **Detected by**: manual review

**Problem**

These endpoints insert/update `expenses.categoryId` (or `categories.parentId`) directly from the request body, without verifying that the referenced category belongs to the caller's household:

```typescript
// packages/api/src/routes/expenses.ts:52-69 (POST /api/expenses)
const [created] = await db
  .insert(expenses)
  .values({
    householdId,                  // <- from verified JWT, good
    createdBy: userId,
    ...
    categoryId: body.categoryId,  // <- trusted from body, NOT verified
    ...
  })
  .returning();
```

Compounding this, the `leftJoin(categories, ...)` in [`expenses.ts:25`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/expenses.ts#L25), [`reports.ts:21`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/reports.ts#L21), [`reports.ts:150`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/reports.ts#L150), and [`reports.ts:315`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/reports.ts#L315) joins on `expenses.categoryId = categories.id` without an additional `categories.householdId = expenses.householdId` predicate, so a planted foreign reference is dereferenced and its row returned in the response.

The prior audit explicitly noted that "every data query is scoped by `householdId`" — this is the one route family that bypasses that invariant on the write side.

**Risk**

An authenticated user who knows another household's category UUID can:

1. Insert/update one of their own expenses with that foreign `categoryId` (or create a category with a foreign `parentId`).
2. When listing their own expenses or breakdown reports, the join returns the foreign category's `name`, `emoji`, and `parentId` — information disclosure of category metadata across the household boundary.

Practical impact is **constrained** by:

- UUIDs are not enumerable — exploitation requires an out-of-band leak of a `categoryId`.
- Category names today are generic (e.g., "🍔 Comida", "Transporte") — limited sensitivity.
- The expense rows themselves remain correctly scoped by `householdId`; this gap leaks category names, not financial data.

Severity is Medium (not Low) because it contradicts the documented isolation invariant and the fix is trivial — better to close it before categories ever hold notes/budgets/labels that are genuinely sensitive.

**Actionables**

- Before each insert/update that accepts a `categoryId` (or `parentId`) from input, verify: `select { id } from categories where id = $1 and household_id = $2 limit 1` and return `400` if absent.
- Defense in depth: tighten the joins in `expenses.ts` and `reports.ts` to include `eq(categories.householdId, expenses.householdId)`, so even a planted foreign reference dereferences to `null` instead of leaking the row.
- Reference: [CWE-639](https://cwe.mitre.org/data/definitions/639.html) (authorization bypass through user-controlled key).

---

#### SEC-003 — Wildcard CORS on all routes (unchanged from prior SEC-004)

- **Severity**: Medium
- **Category**: Configuration
- **Location**: [`packages/api/src/app.ts:18`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/app.ts#L18)
- **Detected by**: manual review

Still `app.use("*", cors())` — Hono's default reflects `*` on every route. Mitigated by Bearer-token auth (no credentialed CSRF), but no origin allowlist. **Same fix as prior:** `cors({ origin: [<dashboard-url>] })`.

---

#### SEC-004 — No CSP / security headers; JWT stored in `localStorage` (unchanged from prior SEC-005)

- **Severity**: Medium
- **Category**: Frontend / Configuration
- **Location**: [`packages/dashboard/src/lib/auth.tsx:82`](https://github.com/FranDisalvo90/finbot/blob/main/packages/dashboard/src/lib/auth.tsx#L82), served from [`packages/api/src/app.ts:38-46`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/app.ts#L38-L46)
- **Detected by**: manual review

7-day JWT in `localStorage`, no `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, or HSTS on the served HTML. The exposure becomes acute if SEC-001 (`react-router-dom` XSS) is exploited — `localStorage` tokens are directly exfiltratable from any JS. **Add `secureHeaders()` middleware** (Hono ships one) with a strict CSP for the SPA.

---

#### SEC-005 — Household invite codes use non-cryptographic randomness (unchanged from prior SEC-006)

- **Severity**: Medium
- **Category**: Crypto
- **Location**: [`packages/api/src/routes/households.ts:27-34`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/households.ts#L27-L34)
- **Detected by**: manual review

Still `code += chars[Math.floor(Math.random() * chars.length)];` for 8-char invite codes. Use `crypto.randomInt` and add rate limiting on `POST /api/households/join` (compounds with SEC-009).

---

#### SEC-006 — Container runs as root (unchanged from prior SEC-007)

- **Severity**: Medium
- **Category**: Configuration (container)
- **Location**: [`Dockerfile:23-45`](https://github.com/FranDisalvo90/finbot/blob/main/Dockerfile#L23-L45)
- **Detected by**: semgrep, trivy (DS-0002), hadolint

Production stage has no `USER` directive. Add `USER node` (the `node:22-slim` base ships this user).

---

#### SEC-007 — Env-var validation covers only `JWT_SECRET` (partial fix of prior SEC-003)

- **Severity**: Medium (fix is partial)
- **Category**: Configuration
- **Location**: [`packages/api/src/config/env.ts:8-27`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/config/env.ts#L8-L27)
- **Detected by**: manual review

**Problem**

Commit [`8b2047c`](https://github.com/FranDisalvo90/finbot/commit/8b2047c) added a strong fail-fast check for `JWT_SECRET` (must be present, ≥ 32 chars, not the literal `"change-me-in-production"`). **That fix is good and closes the prior SEC-001.** But the other required envs still use `?? <fallback>`:

```typescript
DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/finbot",
ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
SPLITWISE_CLIENT_ID: process.env.SPLITWISE_CLIENT_ID ?? "",
SPLITWISE_CLIENT_SECRET: process.env.SPLITWISE_CLIENT_SECRET ?? "",
```

**Risk**

No active vuln (no hardcoded credential remains; `JWT_SECRET` is the only one that would be exploitable if missing). Risk is operational: the app boots successfully but features silently degrade — production deploy with missing `DATABASE_URL` would attempt to connect to `localhost:5433`, missing `GOOGLE_CLIENT_ID` makes Google verification fail at request time, etc.

**Actionables**

- Adopt a schema-based loader (`zod`, `envalid`, or `t3-env`) that throws at boot for `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `ANTHROPIC_API_KEY`, `SPLITWISE_CLIENT_ID`, `SPLITWISE_CLIENT_SECRET`. Keep harmless defaults for `PORT` only.

---

### Low

#### SEC-008 — No upload size limit; unbounded in-memory previews map (unchanged from prior SEC-008)

- **Severity**: Low
- **Location**: [`packages/api/src/routes/import.ts:16-25`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/import.ts#L16-L25)

Enforce a max upload size and TTL/size eviction on `previews`.

#### SEC-009 — No rate limiting on auth/public endpoints (unchanged from prior SEC-009)

- **Severity**: Low
- **Location**: [`packages/api/src/app.ts:21-23`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/app.ts#L21-L23)

Compounds SEC-005 (invite-code brute force). Add per-IP limiter on `/api/auth/google`, `/api/splitwise/callback`, `/api/households/join`.

#### SEC-010 — Splitwise access token plaintext at rest (unchanged from prior SEC-010)

- **Severity**: Low
- **Location**: [`packages/api/src/db/schema.ts:54`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/db/schema.ts#L54) (`users.splitwiseAccessToken`)

Encrypt the column (app-level envelope or `pgcrypto`) or accept the risk.

#### SEC-011 — Expense descriptions logged to stdout (unchanged from prior SEC-011)

- **Severity**: Low
- **Location**: [`packages/api/src/services/categorizer.ts:49,73,104,124`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/services/categorizer.ts#L49-L124)

Gate the `console.log` calls on `NODE_ENV !== "production"` (or drop them entirely).

#### SEC-012 — Long-lived (7-day) JWT with no revocation (unchanged from prior SEC-012)

- **Severity**: Low
- **Location**: [`packages/api/src/routes/auth.ts:66-76`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/auth.ts#L66-L76)

Accept-and-document for a personal app, or add a `tokenVersion` column for server-side revocation.

#### SEC-013 — Dev-only dependency vulnerabilities (refreshed list, mostly unchanged from prior SEC-013)

- **Severity**: Low
- **Location**: [`pnpm-lock.yaml`](https://github.com/FranDisalvo90/finbot/blob/main/pnpm-lock.yaml)
- **Detected by**: osv-scanner, pnpm audit

Dev-only CVEs (not in the production runtime path):

| Package | Installed | Severity | Fixed in | Note |
|---|---|---|---|---|
| `vitest` | 4.0.18 | Critical | 4.1.0 | UI server arbitrary file read/exec (only exploitable when UI listening) |
| `vite` | 6.4.1 | High | 6.4.2 | Dev-server WebSocket file read |
| `vite` | 6.4.1 | Medium | 6.4.2 | Path traversal in optimized deps `.map` |
| `flatted` | 3.4.1 | High | 3.4.2 | Prototype pollution (via eslint) |
| `picomatch` | 2.3.1 / 4.0.3 | High + Medium | 2.3.2 / 4.0.4 | ReDoS (via tailwindcss, typescript-eslint, vite) |
| `esbuild` | 0.18.20 | Medium | 0.25.0 | Dev-server CSRF (via drizzle-kit) |
| `postcss` | 8.5.8 | Medium | 8.5.10 | XSS via unescaped `</style>` |
| `brace-expansion` | 5.0.4 | Medium ×2 | 5.0.5 / 5.0.6 | DoS via numeric ranges (via eslint) |

Bump `vitest ≥ 4.1.0` and `vite ≥ 6.4.2`; refresh the lockfile to pull patched transitive build tooling.

#### SEC-014 — Live secrets present in local `.env` (unchanged from prior SEC-014)

- **Severity**: Low
- **Location**: local `.env` (gitignored — [`.gitignore`](https://github.com/FranDisalvo90/finbot/blob/main/.gitignore))

gitleaks history scan across all 44 commits (including the 1 new commit since the prior audit) confirmed **zero secrets in history**. The 3 active hits (Anthropic key, JWT_SECRET, Splitwise client secret) are all in the gitignored working-tree `.env` — correct location, no leak. No action required for the repo; rotate only if the machine is shared/compromised.

#### SEC-015 — `brace-expansion 2.0.2` runtime transitive (new)

- **Severity**: Low
- **Category**: Dependencies
- **Location**: [`pnpm-lock.yaml`](https://github.com/FranDisalvo90/finbot/blob/main/pnpm-lock.yaml) (transitive: `google-auth-library` → `gaxios` → `rimraf` → `glob` → `minimatch`)
- **Detected by**: osv-scanner, pnpm audit, trivy

CVE-2026-33750 — zero-step numeric sequence hangs. Technically reachable from runtime since it's pulled by `google-auth-library`, but the affected code path (`rimraf` cleanup) is not exercised in the request path. Low practical impact. Add a pnpm `overrides` entry forcing `brace-expansion ≥ 2.0.3` if you want a clean audit.

---

### Info

#### SEC-016 — Prior High findings remediated (verification)

The two High findings from the [2026-06-03 review](./2026-06-03-security-review.md) are confirmed fixed:

- **Prior SEC-001** (hardcoded `JWT_SECRET` fallback): commit [`8b2047c`](https://github.com/FranDisalvo90/finbot/commit/8b2047c). [`env.ts:8-15`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/config/env.ts#L8-L15) now throws if `JWT_SECRET` is missing, shorter than 32 chars, or equals the literal `"change-me-in-production"`. Strong fix.
- **Prior SEC-002** (vulnerable runtime deps): `drizzle-orm` at 0.45.2+, `hono` at 4.12.23, `@hono/node-server` at 1.19.14, `lodash` at 4.18.1 via [`pnpm-workspace.yaml`](https://github.com/FranDisalvo90/finbot/blob/main/pnpm-workspace.yaml) override. All four no longer report open CVEs in osv-scanner/pnpm-audit/trivy.

#### SEC-017 — Splitwise sync code reviewed (new)

The new code introduced since the prior audit ([`splitwise-sync.ts`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/services/splitwise-sync.ts), [`splitwise-client.ts`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/services/splitwise-client.ts), `POST /api/splitwise/sync`) was reviewed and looks sound:

- Sync state is keyed by `householdId` (unique constraint in [`schema.ts:140-149`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/db/schema.ts#L140-L149)).
- All DB reads/writes are scoped by `householdId` and `source = 'splitwise'`.
- Dedup via `sourceRef` (Splitwise expense id) — idempotent re-sync.
- OAuth `state` CSRF protection (`crypto.randomUUID()` in [`splitwise.ts:69`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/splitwise.ts#L69), validated on callback at [`splitwise.ts:182-186`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/splitwise.ts#L182-L186)).
- Splitwise client uses bounded retries with exponential backoff on 429 ([`splitwise-client.ts:25-39`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/services/splitwise-client.ts#L25-L39)).
- Auth errors (`401`) clear the stored token cleanly ([`splitwise.ts:142-148`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/splitwise.ts#L142-L148)).

One minor observation: `expenses.rawData` stores the entire raw Splitwise expense JSON, which includes other group members' `user_id`, `paid_share`, `owed_share`, and `net_balance` ([`splitwise-sync.ts:39`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/services/splitwise-sync.ts#L39)). This is data you legitimately have via the Splitwise API and the members are people you already share the group with, so it's not an exposure — but consider whether you need to retain the raw blob long-term, or just the fields you actually use.

The in-memory `oauthStates` map ([`splitwise.ts:14`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/routes/splitwise.ts#L14)) doesn't survive restarts and isn't shared across instances — a known limitation for single-instance personal deployments; would need Redis or DB-backed state for HA.

#### SEC-018 — Prompt-injection surface in AI categorizer (unchanged from prior SEC-015)

Expense descriptions interpolated into the Anthropic prompt ([`categorizer.ts:75-93`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/services/categorizer.ts#L75-L93)). A crafted description could nudge categorization, but impact is limited to mis-categorizing the attacker's own expenses; results are filtered against the household's own category list ([`categorizer.ts:128-130`](https://github.com/FranDisalvo90/finbot/blob/main/packages/api/src/services/categorizer.ts#L128-L130)). Informational.

#### SEC-019 — Dockerfile hardening notes (unchanged from prior SEC-016)

No `HEALTHCHECK` (trivy DS-0026, Low). Consecutive `RUN` layers in the production stage (hadolint DL3059) in [`Dockerfile`](https://github.com/FranDisalvo90/finbot/blob/main/Dockerfile). Defense-in-depth / image-quality only.

#### SEC-020 — Pluggy-specific threat-model items remain N/A (unchanged from prior SEC-017)

This is a personal finance tracker, not a Pluggy platform / integration project. The following Pluggy threat-model items were checked and remain inapplicable: connector credentials (PLG-03), Open Finance token handling (PLG-04), Pluggy webhook authenticity/idempotency/payload trust (PLG-05, 20, 21), `clientUserId` linking (PLG-22), API Key vs Connect Token (PLG-19), payment idempotency (PLG-24), sandbox widget flags (PLG-25), `onSuccess` reliance (PLG-26). The Splitwise OAuth flow continues to implement correct CSRF `state` validation (see SEC-017).

## Excluded findings

- All paths under `packages/*/src/**/__tests__/`, `*.test.ts`, `*.spec.ts` — test files; semgrep flagged none of these.
- `packages/dashboard/dist/assets/index-*.js` — bundled output (React's internal `innerHTML` use); grep hits not application code.
- `.env.example` placeholder values, `DATABASE_URL` default `postgres:postgres@localhost:5433` (matches `.env.example`).

## Appendix: Raw tool outputs

Paths to raw JSON under `/tmp/security-audit-20260605-092919/`: `osv.json`, `pm-audit.json`, `trivy-vuln.json`, `gitleaks-tree.json`, `gitleaks-history.json`, `trivy-secrets.json`, `semgrep.json`, `trivy-misconfig.json`, `hadolint.json`, `eslint-output.txt`. Not committed.
