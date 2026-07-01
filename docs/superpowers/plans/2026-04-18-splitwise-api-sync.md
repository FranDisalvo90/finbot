# Splitwise API Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync Splitwise expenses via API so the user can see current-month spending without waiting for CSV export.

**Architecture:** OAuth 2.0 connects the user's Splitwise account. A sync service fetches expenses from a selected group, deduplicates by Splitwise ID (sourceRef), inserts/updates/deletes in DB, then runs the existing categorization pipeline. Frontend adds a Splitwise section to the Import page.

**Tech Stack:** Hono, Drizzle ORM, PostgreSQL, native fetch (no Splitwise SDK), React + Tailwind

**Spec:** `docs/superpowers/specs/2026-04-18-splitwise-api-sync-design.md`

---

### Task 1: Schema changes — add Splitwise columns to users + new sync state table

**Files:**
- Modify: `packages/api/src/db/schema.ts:82-89` (users table)
- Create: migration via `pnpm db:generate`

- [ ] **Step 1: Add Splitwise columns to users table and create splitwise_sync_state table**

In `packages/api/src/db/schema.ts`, replace the `users` table definition (lines 82-89) and add the new table after `imports`:

```typescript
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleId: text("google_id").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  picture: text("picture"),
  splitwiseAccessToken: text("splitwise_access_token"),
  splitwiseUserId: integer("splitwise_user_id"),
  splitwiseGroupId: integer("splitwise_group_id"),
  splitwiseGroupName: text("splitwise_group_name"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

After the `imports` table, add:

```typescript
export const splitwiseSyncState = pgTable("splitwise_sync_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull()
    .unique(),
  lastSyncAt: timestamp("last_sync_at"),
  lastUpdatedAt: timestamp("last_updated_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

- [ ] **Step 2: Add env vars for Splitwise OAuth**

In `packages/api/src/config/env.ts`, add three new properties to the `env` object:

```typescript
export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/finbot",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
  PORT: Number(process.env.PORT ?? 3001),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
  JWT_SECRET: process.env.JWT_SECRET ?? "change-me-in-production",
  SPLITWISE_CLIENT_ID: process.env.SPLITWISE_CLIENT_ID ?? "",
  SPLITWISE_CLIENT_SECRET: process.env.SPLITWISE_CLIENT_SECRET ?? "",
  SPLITWISE_REDIRECT_URI: process.env.SPLITWISE_REDIRECT_URI ?? "http://localhost:3001/api/splitwise/callback",
};
```

- [ ] **Step 3: Generate and run migration**

Run:
```bash
cd /Users/franciscodisalvo/personal-projects/financier && pnpm db:generate
```
Expected: New migration file created in `packages/api/drizzle/` with ALTER TABLE for users + CREATE TABLE for splitwise_sync_state.

Run:
```bash
pnpm db:migrate
```
Expected: Migration applied successfully.

Run:
```bash
pnpm db:migrate:test
```
Expected: Migration applied to test DB.

- [ ] **Step 4: Verify lint passes**

Run:
```bash
pnpm lint
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/db/schema.ts packages/api/src/config/env.ts packages/api/drizzle/
git commit -m "feat: add Splitwise OAuth columns to users table and sync state table"
```

---

### Task 2: Extract exchange rate service from import.ts

**Files:**
- Create: `packages/api/src/services/exchange-rate.ts`
- Modify: `packages/api/src/routes/import.ts:17-26`

- [ ] **Step 1: Create exchange rate service**

Create `packages/api/src/services/exchange-rate.ts`:

```typescript
export async function fetchBlueRate(): Promise<number | null> {
  try {
    const res = await fetch("https://dolarapi.com/v1/dolares/blue");
    if (!res.ok) return null;
    const data = (await res.json()) as { venta: number };
    return data.venta;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Update import.ts to use the shared service**

In `packages/api/src/routes/import.ts`, replace the local `fetchBlueRate` function (lines 17-26) with an import:

Remove:
```typescript
// Fetch blue dollar sell rate from dolarapi.com
async function fetchBlueRate(): Promise<number | null> {
  try {
    const res = await fetch("https://dolarapi.com/v1/dolares/blue");
    if (!res.ok) return null;
    const data = (await res.json()) as { venta: number };
    return data.venta;
  } catch {
    return null;
  }
}
```

Add to the imports at the top:
```typescript
import { fetchBlueRate } from "../services/exchange-rate.js";
```

- [ ] **Step 3: Verify existing tests still pass**

Run:
```bash
pnpm test:api
```
Expected: All existing tests pass (the import tests should work unchanged since `fetchBlueRate` behavior is identical).

- [ ] **Step 4: Verify lint passes**

Run:
```bash
pnpm lint
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/exchange-rate.ts packages/api/src/routes/import.ts
git commit -m "refactor: extract fetchBlueRate into shared exchange-rate service"
```

---

### Task 3: Splitwise API client

**Files:**
- Create: `packages/api/src/services/splitwise-client.ts`
- Test: `packages/api/src/services/__tests__/splitwise-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/services/__tests__/splitwise-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { splitwiseFetch, SplitwiseAuthError } from "../splitwise-client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("splitwiseFetch", () => {
  it("sends GET with Bearer token and returns JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ expenses: [] }),
    });

    const result = await splitwiseFetch<{ expenses: [] }>("/get_expenses", "my-token", {
      limit: "10",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://secure.splitwise.com/api/v3.0/get_expenses?limit=10");
    expect(opts.headers.Authorization).toBe("Bearer my-token");
    expect(result).toEqual({ expenses: [] });
  });

  it("throws SplitwiseAuthError on 401", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(splitwiseFetch("/get_expenses", "bad-token")).rejects.toThrow(SplitwiseAuthError);
  });

  it("throws generic error on non-401 failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(splitwiseFetch("/get_expenses", "token")).rejects.toThrow("Splitwise API error: 500");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm test:api -- src/services/__tests__/splitwise-client.test.ts
```
Expected: FAIL — module `../splitwise-client.js` not found.

- [ ] **Step 3: Write the implementation**

Create `packages/api/src/services/splitwise-client.ts`:

```typescript
const SPLITWISE_BASE = "https://secure.splitwise.com/api/v3.0";

export class SplitwiseAuthError extends Error {
  constructor() {
    super("Splitwise token expired or revoked");
    this.name = "SplitwiseAuthError";
  }
}

export async function splitwiseFetch<T>(
  path: string,
  accessToken: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${SPLITWISE_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401) throw new SplitwiseAuthError();
  if (!res.ok) throw new Error(`Splitwise API error: ${res.status}`);

  return res.json() as Promise<T>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm test:api -- src/services/__tests__/splitwise-client.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 5: Lint**

Run:
```bash
pnpm lint
```
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/splitwise-client.ts packages/api/src/services/__tests__/splitwise-client.test.ts
git commit -m "feat: add Splitwise API client with auth error handling"
```

---

### Task 4: Splitwise sync service

**Files:**
- Create: `packages/api/src/services/splitwise-sync.ts`
- Test: `packages/api/src/services/__tests__/splitwise-sync.test.ts`

- [ ] **Step 1: Write the failing test for the sync service**

Create `packages/api/src/services/__tests__/splitwise-sync.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mapSplitwiseExpenses,
  type SplitwiseExpense,
} from "../splitwise-sync.js";

describe("mapSplitwiseExpenses", () => {
  it("maps a regular expense to ParsedExpense using total cost", () => {
    const expense: SplitwiseExpense = {
      id: 123,
      description: "Supermercado",
      cost: "15000.50",
      currency_code: "ARS",
      date: "2026-04-10T14:30:00Z",
      created_at: "2026-04-10T14:30:00Z",
      updated_at: "2026-04-10T14:30:00Z",
      deleted_at: null,
      payment: false,
      users: [
        { user_id: 1, paid_share: "15000.50", owed_share: "7500.25", net_balance: "-7500.25" },
        { user_id: 2, paid_share: "0.0", owed_share: "7500.25", net_balance: "7500.25" },
      ],
    };

    const result = mapSplitwiseExpenses([expense]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      date: "2026-04-10",
      description: "Supermercado",
      amount: 15000.50,
      currency: "ARS",
      installment: null,
      isFinancialCharge: false,
      sourceRef: "123",
      rawLine: JSON.stringify(expense),
    });
  });

  it("filters out payment expenses", () => {
    const payment: SplitwiseExpense = {
      id: 456,
      description: "Payment",
      cost: "5000.00",
      currency_code: "ARS",
      date: "2026-04-11T10:00:00Z",
      created_at: "2026-04-11T10:00:00Z",
      updated_at: "2026-04-11T10:00:00Z",
      deleted_at: null,
      payment: true,
      users: [],
    };

    const result = mapSplitwiseExpenses([payment]);
    expect(result).toHaveLength(0);
  });

  it("filters out deleted expenses", () => {
    const deleted: SplitwiseExpense = {
      id: 789,
      description: "Deleted",
      cost: "1000.00",
      currency_code: "ARS",
      date: "2026-04-12T10:00:00Z",
      created_at: "2026-04-12T10:00:00Z",
      updated_at: "2026-04-12T10:00:00Z",
      deleted_at: "2026-04-12T12:00:00Z",
      payment: false,
      users: [],
    };

    const result = mapSplitwiseExpenses([deleted]);
    expect(result).toHaveLength(0);
  });

  it("handles USD currency", () => {
    const usdExpense: SplitwiseExpense = {
      id: 101,
      description: "Netflix",
      cost: "15.99",
      currency_code: "USD",
      date: "2026-04-01T00:00:00Z",
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
      deleted_at: null,
      payment: false,
      users: [],
    };

    const result = mapSplitwiseExpenses([usdExpense]);
    expect(result).toHaveLength(1);
    expect(result[0].currency).toBe("USD");
    expect(result[0].amount).toBe(15.99);
  });
});

describe("getDeletedExpenseIds", () => {
  // Import lazily so it is available
  it("extracts IDs of deleted expenses", async () => {
    const { getDeletedExpenseIds } = await import("../splitwise-sync.js");

    const expenses: SplitwiseExpense[] = [
      {
        id: 1, description: "Active", cost: "100", currency_code: "ARS",
        date: "2026-04-01T00:00:00Z", created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z", deleted_at: null, payment: false, users: [],
      },
      {
        id: 2, description: "Deleted", cost: "200", currency_code: "ARS",
        date: "2026-04-01T00:00:00Z", created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z", deleted_at: "2026-04-02T00:00:00Z", payment: false, users: [],
      },
    ];

    const deleted = getDeletedExpenseIds(expenses);
    expect(deleted).toEqual(["2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm test:api -- src/services/__tests__/splitwise-sync.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the sync service**

Create `packages/api/src/services/splitwise-sync.ts`:

```typescript
import { db } from "../db/client.js";
import { expenses, users, splitwiseSyncState } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { splitwiseFetch, SplitwiseAuthError } from "./splitwise-client.js";
import { fetchBlueRate } from "./exchange-rate.js";
import { applyRules, categorizeBatch, applyCategorization } from "./categorizer.js";
import type { ParsedExpense } from "./parsers/visa-galicia.js";

export interface SplitwiseExpense {
  id: number;
  description: string;
  cost: string;
  currency_code: string;
  date: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  payment: boolean;
  users: {
    user_id: number;
    paid_share: string;
    owed_share: string;
    net_balance: string;
  }[];
}

export function mapSplitwiseExpenses(raw: SplitwiseExpense[]): ParsedExpense[] {
  return raw
    .filter((e) => !e.payment && !e.deleted_at)
    .map((e) => ({
      date: e.date.substring(0, 10),
      description: e.description,
      amount: parseFloat(e.cost),
      currency: e.currency_code as "ARS" | "USD",
      installment: null,
      isFinancialCharge: false,
      sourceRef: String(e.id),
      rawLine: JSON.stringify(e),
    }));
}

export function getDeletedExpenseIds(raw: SplitwiseExpense[]): string[] {
  return raw.filter((e) => e.deleted_at !== null).map((e) => String(e.id));
}

async function fetchAllExpenses(
  accessToken: string,
  groupId: number,
  updatedAfter: string | null,
): Promise<SplitwiseExpense[]> {
  const all: SplitwiseExpense[] = [];
  let offset = 0;
  const limit = 100;

  const params: Record<string, string> = {
    group_id: String(groupId),
    limit: String(limit),
  };

  if (updatedAfter) {
    params.updated_after = updatedAfter;
  } else {
    // First sync: fetch last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    params.dated_after = sixMonthsAgo.toISOString();
  }

  while (true) {
    params.offset = String(offset);
    const data = await splitwiseFetch<{ expenses: SplitwiseExpense[] }>(
      "/get_expenses",
      accessToken,
      params,
    );

    if (data.expenses.length === 0) break;
    all.push(...data.expenses);

    if (data.expenses.length < limit) break;
    offset += limit;
  }

  return all;
}

export interface SyncResult {
  inserted: number;
  updated: number;
  deleted: number;
  categorized: number;
  exchangeRate: number | null;
}

export async function syncSplitwiseExpenses(userId: string): Promise<SyncResult> {
  // 1. Read user's Splitwise config
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.splitwiseAccessToken || !user?.splitwiseGroupId) {
    throw new Error("Splitwise not connected or no group selected");
  }

  // 2. Read sync cursor
  let [syncState] = await db
    .select()
    .from(splitwiseSyncState)
    .where(eq(splitwiseSyncState.userId, userId));

  const cursor = syncState?.lastUpdatedAt?.toISOString() ?? null;

  // 3. Fetch expenses from Splitwise API
  const rawExpenses = await fetchAllExpenses(
    user.splitwiseAccessToken,
    user.splitwiseGroupId,
    cursor,
  );

  if (rawExpenses.length === 0) {
    return { inserted: 0, updated: 0, deleted: 0, categorized: 0, exchangeRate: null };
  }

  // 4. Map active expenses to ParsedExpense[]
  const parsed = mapSplitwiseExpenses(rawExpenses);
  const deletedIds = getDeletedExpenseIds(rawExpenses);

  // 5. Fetch exchange rate
  const rate = await fetchBlueRate();

  // 6. Dedup against DB via sourceRef
  const allSourceRefs = parsed.map((p) => p.sourceRef!);
  const existingExpenses =
    allSourceRefs.length > 0
      ? await db
          .select()
          .from(expenses)
          .where(
            and(
              eq(expenses.userId, userId),
              eq(expenses.source, "splitwise"),
              inArray(expenses.sourceRef, allSourceRefs),
            ),
          )
      : [];

  const existingByRef = new Map(existingExpenses.map((e) => [e.sourceRef, e]));

  // 7. Insert new, update changed
  let inserted = 0;
  let updated = 0;

  for (const p of parsed) {
    const existing = existingByRef.get(p.sourceRef!);
    const amountArs = rate
      ? p.currency === "ARS"
        ? String(p.amount)
        : String(+(p.amount * rate).toFixed(2))
      : "0";
    const amountUsd = rate
      ? p.currency === "USD"
        ? String(p.amount)
        : String(+(p.amount / rate).toFixed(2))
      : "0";

    if (existing) {
      // Check if anything changed
      if (
        Number(existing.amount) !== p.amount ||
        existing.description !== p.description ||
        existing.date !== p.date
      ) {
        await db
          .update(expenses)
          .set({
            amount: String(p.amount),
            description: p.description,
            date: p.date,
            month: p.date.substring(0, 7),
            currency: p.currency,
            amountArs,
            amountUsd,
            exchangeRate: rate ? String(rate) : null,
            rawData: { raw: p.rawLine },
          })
          .where(eq(expenses.id, existing.id));
        updated++;
      }
    } else {
      await db.insert(expenses).values({
        userId,
        amount: String(p.amount),
        currency: p.currency,
        description: p.description,
        source: "splitwise",
        sourceRef: p.sourceRef,
        date: p.date,
        month: p.date.substring(0, 7),
        installment: null,
        isFinancialCharge: false,
        amountArs,
        amountUsd,
        exchangeRate: rate ? String(rate) : null,
        rawData: { raw: p.rawLine },
      });
      inserted++;
    }
  }

  // 8. Handle deletions
  let deletedCount = 0;
  if (deletedIds.length > 0) {
    const deleteResult = await db
      .delete(expenses)
      .where(
        and(
          eq(expenses.userId, userId),
          eq(expenses.source, "splitwise"),
          inArray(expenses.sourceRef, deletedIds),
        ),
      )
      .returning();
    deletedCount = deleteResult.length;
  }

  // 9. Update sync cursor
  const maxUpdatedAt = rawExpenses.reduce((max, e) => {
    const t = new Date(e.updated_at).getTime();
    return t > max ? t : max;
  }, 0);

  if (syncState) {
    await db
      .update(splitwiseSyncState)
      .set({
        lastSyncAt: new Date(),
        lastUpdatedAt: new Date(maxUpdatedAt),
      })
      .where(eq(splitwiseSyncState.userId, userId));
  } else {
    await db.insert(splitwiseSyncState).values({
      userId,
      lastSyncAt: new Date(),
      lastUpdatedAt: new Date(maxUpdatedAt),
    });
  }

  // 10. Categorize newly inserted expenses
  let categorized = 0;
  if (inserted > 0) {
    const newExpenses = await db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.userId, userId),
          eq(expenses.source, "splitwise"),
          inArray(
            expenses.sourceRef,
            parsed
              .filter((p) => !existingByRef.has(p.sourceRef!))
              .map((p) => p.sourceRef!),
          ),
        ),
      );

    const ruleMatches = await applyRules(
      newExpenses.map((e) => ({ id: e.id, description: e.description })),
      userId,
    );
    const ruleCount = await applyCategorization(ruleMatches);

    const uncategorized = newExpenses
      .filter((e) => !ruleMatches.has(e.id))
      .map((e) => ({ id: e.id, description: e.description, amount: Number(e.amount) }));

    const aiResults = await categorizeBatch(uncategorized, userId);
    const aiMap = new Map(aiResults.map((r) => [r.expenseId, r.categoryId]));
    const aiCount = await applyCategorization(aiMap);

    categorized = ruleCount + aiCount;
  }

  return { inserted, updated, deleted: deletedCount, categorized, exchangeRate: rate };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm test:api -- src/services/__tests__/splitwise-sync.test.ts
```
Expected: All 5 tests pass (mapSplitwiseExpenses and getDeletedExpenseIds).

- [ ] **Step 5: Lint**

Run:
```bash
pnpm lint
```
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/splitwise-sync.ts packages/api/src/services/__tests__/splitwise-sync.test.ts
git commit -m "feat: add Splitwise sync service with expense mapping and incremental sync"
```

---

### Task 5: Splitwise OAuth and API routes

**Files:**
- Create: `packages/api/src/routes/splitwise.ts`
- Modify: `packages/api/src/app.ts`
- Test: `packages/api/src/routes/__tests__/splitwise.test.ts`

- [ ] **Step 1: Write the route tests**

Create `packages/api/src/routes/__tests__/splitwise.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import app from "../../app.js";
import { authHeader } from "../../test/helpers.js";

let auth: Record<string, string>;
beforeAll(async () => {
  auth = await authHeader();
});

const json = async (res: Response) => res.json();

describe("GET /api/splitwise/status", () => {
  it("returns not connected when no token stored", async () => {
    const res = await app.request("/api/splitwise/status", { headers: auth });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.connected).toBe(false);
    expect(body.groupName).toBeNull();
    expect(body.lastSyncAt).toBeNull();
  });
});

describe("POST /api/splitwise/group", () => {
  it("returns 400 when Splitwise not connected", async () => {
    const res = await app.request("/api/splitwise/group", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ groupId: 123, groupName: "Test Group" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/splitwise/sync", () => {
  it("returns 400 when Splitwise not connected", async () => {
    const res = await app.request("/api/splitwise/sync", {
      method: "POST",
      headers: auth,
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/splitwise/disconnect", () => {
  it("returns ok even when not connected", async () => {
    const res = await app.request("/api/splitwise/disconnect", {
      method: "POST",
      headers: auth,
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm test:api -- src/routes/__tests__/splitwise.test.ts
```
Expected: FAIL — routes not registered, 404 responses.

- [ ] **Step 3: Create the Splitwise routes**

Create `packages/api/src/routes/splitwise.ts`:

```typescript
import { Hono } from "hono";
import { db } from "../db/client.js";
import { users, splitwiseSyncState } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { getUserId } from "../middleware/get-user.js";
import { splitwiseFetch, SplitwiseAuthError } from "../services/splitwise-client.js";
import { syncSplitwiseExpenses } from "../services/splitwise-sync.js";

export const splitwiseRoutes = new Hono();

// In-memory CSRF state store: state -> { userId, createdAt }
const oauthStates = new Map<string, { userId: string; createdAt: number }>();

// Clean expired states (older than 10 minutes)
function cleanExpiredStates() {
  const now = Date.now();
  for (const [state, data] of oauthStates) {
    if (now - data.createdAt > 10 * 60 * 1000) {
      oauthStates.delete(state);
    }
  }
}

// GET /status — connection status
splitwiseRoutes.get("/status", async (c) => {
  const userId = getUserId(c);
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  const connected = !!user?.splitwiseAccessToken;
  let lastSyncAt: string | null = null;

  if (connected) {
    const [sync] = await db
      .select()
      .from(splitwiseSyncState)
      .where(eq(splitwiseSyncState.userId, userId));
    lastSyncAt = sync?.lastSyncAt?.toISOString() ?? null;
  }

  return c.json({
    connected,
    groupId: user?.splitwiseGroupId ?? null,
    groupName: user?.splitwiseGroupName ?? null,
    lastSyncAt,
  });
});

// GET /connect — redirect to Splitwise OAuth
splitwiseRoutes.get("/connect", (c) => {
  const userId = getUserId(c);
  const state = crypto.randomUUID();

  cleanExpiredStates();
  oauthStates.set(state, { userId, createdAt: Date.now() });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.SPLITWISE_CLIENT_ID,
    redirect_uri: env.SPLITWISE_REDIRECT_URI,
    state,
  });

  return c.redirect(`https://secure.splitwise.com/oauth/authorize?${params.toString()}`);
});

// GET /groups — list user's Splitwise groups
splitwiseRoutes.get("/groups", async (c) => {
  const userId = getUserId(c);
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  if (!user?.splitwiseAccessToken) {
    return c.json({ error: "Splitwise not connected" }, 400);
  }

  const data = await splitwiseFetch<{
    groups: { id: number; name: string; members: { id: number }[] }[];
  }>("/get_groups", user.splitwiseAccessToken);

  const groups = data.groups
    .filter((g) => g.id !== 0) // Splitwise returns a "non-group" with id 0
    .map((g) => ({ id: g.id, name: g.name }));

  return c.json({ groups });
});

// POST /group — select active group
splitwiseRoutes.post("/group", async (c) => {
  const userId = getUserId(c);
  const { groupId, groupName } = await c.req.json();

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.splitwiseAccessToken) {
    return c.json({ error: "Splitwise not connected" }, 400);
  }

  // Update group and reset sync cursor
  await db
    .update(users)
    .set({ splitwiseGroupId: groupId, splitwiseGroupName: groupName })
    .where(eq(users.id, userId));

  // Reset sync state so the new group does a full sync
  await db.delete(splitwiseSyncState).where(eq(splitwiseSyncState.userId, userId));

  return c.json({ ok: true });
});

// POST /sync — trigger incremental sync
splitwiseRoutes.post("/sync", async (c) => {
  const userId = getUserId(c);
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  if (!user?.splitwiseAccessToken || !user?.splitwiseGroupId) {
    return c.json({ error: "Splitwise not connected or no group selected" }, 400);
  }

  try {
    const result = await syncSplitwiseExpenses(userId);
    return c.json(result);
  } catch (e) {
    if (e instanceof SplitwiseAuthError) {
      // Clear token on auth failure
      await db
        .update(users)
        .set({ splitwiseAccessToken: null, splitwiseUserId: null })
        .where(eq(users.id, userId));
      return c.json({ error: "splitwise_auth_expired" }, 401);
    }
    throw e;
  }
});

// POST /disconnect — clear Splitwise connection
splitwiseRoutes.post("/disconnect", async (c) => {
  const userId = getUserId(c);
  await db
    .update(users)
    .set({
      splitwiseAccessToken: null,
      splitwiseUserId: null,
      splitwiseGroupId: null,
      splitwiseGroupName: null,
    })
    .where(eq(users.id, userId));
  await db.delete(splitwiseSyncState).where(eq(splitwiseSyncState.userId, userId));
  return c.json({ ok: true });
});

// Standalone callback handler (needs to be registered as public route)
export async function splitwiseCallbackHandler(c: import("hono").Context) {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400);
  }

  const stateData = oauthStates.get(state);
  if (!stateData) {
    return c.json({ error: "Invalid or expired state" }, 400);
  }
  oauthStates.delete(state);

  // Exchange code for access token
  const tokenRes = await fetch("https://secure.splitwise.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: env.SPLITWISE_CLIENT_ID,
      client_secret: env.SPLITWISE_CLIENT_SECRET,
      redirect_uri: env.SPLITWISE_REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    return c.json({ error: "Failed to exchange code for token" }, 500);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };

  // Get Splitwise user ID
  const swUser = await splitwiseFetch<{ user: { id: number } }>(
    "/get_current_user",
    tokenData.access_token,
  );

  // Save token and user ID
  await db
    .update(users)
    .set({
      splitwiseAccessToken: tokenData.access_token,
      splitwiseUserId: swUser.user.id,
    })
    .where(eq(users.id, stateData.userId));

  // Redirect to frontend import page
  return c.redirect("/import?splitwise=connected");
}
```

- [ ] **Step 4: Register routes in app.ts**

In `packages/api/src/app.ts`, add the import and route registrations:

Add import at the top (after the `rulesRoutes` import):
```typescript
import { splitwiseRoutes, splitwiseCallbackHandler } from "./routes/splitwise.js";
```

Add the callback as a public route (after the `/api/health` line, before the auth middleware):
```typescript
app.get("/api/splitwise/callback", splitwiseCallbackHandler);
```

Add the protected routes (after `app.route("/api/rules", rulesRoutes);`):
```typescript
app.route("/api/splitwise", splitwiseRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
pnpm test:api -- src/routes/__tests__/splitwise.test.ts
```
Expected: All 4 tests pass.

- [ ] **Step 6: Run full test suite**

Run:
```bash
pnpm test:api
```
Expected: All tests pass (existing + new).

- [ ] **Step 7: Lint**

Run:
```bash
pnpm lint
```
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/routes/splitwise.ts packages/api/src/routes/__tests__/splitwise.test.ts packages/api/src/app.ts
git commit -m "feat: add Splitwise OAuth and sync API routes"
```

---

### Task 6: Frontend — Splitwise section on Import page

**Files:**
- Modify: `packages/dashboard/src/pages/Import.tsx`
- Modify: `packages/dashboard/src/lib/api.ts`

- [ ] **Step 1: Add API helper functions**

In `packages/dashboard/src/lib/api.ts`, add at the end of the file (before the closing):

```typescript
export interface SplitwiseStatus {
  connected: boolean;
  groupId: number | null;
  groupName: string | null;
  lastSyncAt: string | null;
}

export interface SplitwiseGroup {
  id: number;
  name: string;
}

export interface SyncResult {
  inserted: number;
  updated: number;
  deleted: number;
  categorized: number;
  exchangeRate: number | null;
}

export function getSplitwiseStatus(): Promise<SplitwiseStatus> {
  return api<SplitwiseStatus>("/splitwise/status");
}

export function getSplitwiseGroups(): Promise<{ groups: SplitwiseGroup[] }> {
  return api<{ groups: SplitwiseGroup[] }>("/splitwise/groups");
}

export function selectSplitwiseGroup(groupId: number, groupName: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>("/splitwise/group", {
    method: "POST",
    body: JSON.stringify({ groupId, groupName }),
  });
}

export function syncSplitwise(): Promise<SyncResult> {
  return api<SyncResult>("/splitwise/sync", { method: "POST" });
}

export function disconnectSplitwise(): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>("/splitwise/disconnect", { method: "POST" });
}
```

- [ ] **Step 2: Add the Splitwise section to Import.tsx**

In `packages/dashboard/src/pages/Import.tsx`, add imports at the top:

```typescript
import { useState, useCallback, useMemo, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, CheckCircle, Loader2, AlertTriangle, RefreshCw, Unlink, Link } from "lucide-react";
import {
  formatMoney,
  getSplitwiseStatus,
  getSplitwiseGroups,
  selectSplitwiseGroup,
  syncSplitwise,
  disconnectSplitwise,
  type SplitwiseStatus,
  type SplitwiseGroup,
  type SyncResult as SplitwiseSyncResult,
} from "../lib/api";
```

Inside the `Import` component, after the existing state declarations (after `excludedIndices` state), add:

```typescript
  // Splitwise state
  const [swStatus, setSwStatus] = useState<SplitwiseStatus | null>(null);
  const [swGroups, setSwGroups] = useState<SplitwiseGroup[]>([]);
  const [swSelectedGroup, setSwSelectedGroup] = useState<number | null>(null);
  const [swSyncing, setSwSyncing] = useState(false);
  const [swSyncResult, setSwSyncResult] = useState<SplitwiseSyncResult | null>(null);
  const [swError, setSwError] = useState<string | null>(null);
  const [swLoading, setSwLoading] = useState(true);
  const [swShowGroupSelect, setSwShowGroupSelect] = useState(false);

  // Load Splitwise status on mount
  useEffect(() => {
    getSplitwiseStatus()
      .then(setSwStatus)
      .catch(() => setSwStatus({ connected: false, groupId: null, groupName: null, lastSyncAt: null }))
      .finally(() => setSwLoading(false));
  }, []);

  // Handle ?splitwise=connected from OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("splitwise") === "connected") {
      window.history.replaceState({}, "", "/import");
      getSplitwiseStatus().then(setSwStatus);
    }
  }, []);

  const handleSwConnect = () => {
    const token = localStorage.getItem("auth_token");
    window.location.href = `/api/splitwise/connect?token=${token}`;
  };

  const handleSwLoadGroups = async () => {
    setSwError(null);
    try {
      const data = await getSplitwiseGroups();
      setSwGroups(data.groups);
      setSwShowGroupSelect(true);
    } catch (e: unknown) {
      setSwError(e instanceof Error ? e.message : "Error al cargar grupos");
    }
  };

  const handleSwSelectGroup = async () => {
    if (!swSelectedGroup) return;
    const group = swGroups.find((g) => g.id === swSelectedGroup);
    if (!group) return;
    setSwError(null);
    try {
      await selectSplitwiseGroup(group.id, group.name);
      setSwStatus((prev) => prev ? { ...prev, groupId: group.id, groupName: group.name, lastSyncAt: null } : prev);
      setSwShowGroupSelect(false);
      setSwSyncResult(null);
    } catch (e: unknown) {
      setSwError(e instanceof Error ? e.message : "Error al seleccionar grupo");
    }
  };

  const handleSwSync = async () => {
    setSwSyncing(true);
    setSwError(null);
    setSwSyncResult(null);
    try {
      const result = await syncSplitwise();
      setSwSyncResult(result);
      // Refresh status to update lastSyncAt
      const status = await getSplitwiseStatus();
      setSwStatus(status);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error al sincronizar";
      if (msg.includes("splitwise_auth_expired")) {
        setSwStatus({ connected: false, groupId: null, groupName: null, lastSyncAt: null });
        setSwError("La conexión con Splitwise expiró. Reconectá tu cuenta.");
      } else {
        setSwError(msg);
      }
    } finally {
      setSwSyncing(false);
    }
  };

  const handleSwDisconnect = async () => {
    try {
      await disconnectSplitwise();
      setSwStatus({ connected: false, groupId: null, groupName: null, lastSyncAt: null });
      setSwSyncResult(null);
      setSwShowGroupSelect(false);
    } catch (e: unknown) {
      setSwError(e instanceof Error ? e.message : "Error al desconectar");
    }
  };
```

In the JSX, insert the Splitwise section between `<h2>` and the dropzone `<div>`. Replace the existing return starting from `<div className="space-y-6">` to add the section before the dropzone:

```tsx
      {/* Splitwise Sync Section */}
      {!swLoading && swStatus && (
        <div className="bg-dark-card rounded-xl border border-dark-border p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-medium">Splitwise</h3>
            {swStatus.connected && (
              <span className="text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded">
                Conectado
              </span>
            )}
          </div>

          {!swStatus.connected ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">
                Sincronizá tus gastos de Splitwise automáticamente.
              </p>
              <button
                onClick={handleSwConnect}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
              >
                <Link size={16} />
                Conectar Splitwise
              </button>
            </div>
          ) : !swStatus.groupId || swShowGroupSelect ? (
            <div className="space-y-3">
              {!swShowGroupSelect && (
                <button
                  onClick={handleSwLoadGroups}
                  className="text-sm text-blue-400 hover:text-blue-300"
                >
                  Seleccioná un grupo para sincronizar
                </button>
              )}
              {swShowGroupSelect && (
                <div className="flex items-center gap-3">
                  <select
                    value={swSelectedGroup ?? ""}
                    onChange={(e) => setSwSelectedGroup(Number(e.target.value))}
                    className="bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-sm text-white flex-1"
                  >
                    <option value="">Seleccionar grupo...</option>
                    {swGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleSwSelectGroup}
                    disabled={!swSelectedGroup}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    Confirmar
                  </button>
                </div>
              )}
              <button
                onClick={handleSwDisconnect}
                className="text-xs text-gray-500 hover:text-gray-400 flex items-center gap-1"
              >
                <Unlink size={12} />
                Desconectar
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-400">
                  <span className="text-white">Grupo: {swStatus.groupName}</span>
                  <button
                    onClick={handleSwLoadGroups}
                    className="ml-2 text-xs text-blue-400 hover:text-blue-300"
                  >
                    Cambiar
                  </button>
                  {swStatus.lastSyncAt && (
                    <span className="ml-3">
                      Última sync:{" "}
                      {new Date(swStatus.lastSyncAt).toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSwSync}
                  disabled={swSyncing}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                >
                  {swSyncing ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  Sincronizar
                </button>
                <button
                  onClick={handleSwDisconnect}
                  className="text-xs text-gray-500 hover:text-gray-400 flex items-center gap-1"
                >
                  <Unlink size={12} />
                  Desconectar
                </button>
              </div>
            </div>
          )}

          {swError && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
              {swError}
            </div>
          )}

          {swSyncResult && (
            <div className="bg-green-900/20 border border-green-800 rounded-lg p-3 space-y-1">
              <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                <CheckCircle size={16} />
                Sincronización completada
              </div>
              <p className="text-sm text-gray-400">
                {swSyncResult.inserted} nuevos, {swSyncResult.updated} actualizados,{" "}
                {swSyncResult.deleted} eliminados, {swSyncResult.categorized} categorizados
                {swSyncResult.exchangeRate && (
                  <span className="ml-2">(USD blue: ${swSyncResult.exchangeRate})</span>
                )}
              </p>
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 3: Handle OAuth connect with JWT token**

The `/connect` endpoint requires a JWT since it's behind the auth middleware. But the redirect flow means we need to pass the token. Update the connect endpoint in `packages/api/src/routes/splitwise.ts` to accept the token as a query param for the initial redirect:

In the `splitwiseRoutes.get("/connect", ...)` handler, update to also read the token from query params if present. Actually, since `/api/splitwise/connect` is behind the auth middleware, the frontend needs to pass the token. The simplest approach is to open the URL with the auth header — but since it's a redirect, the frontend should use `window.location.href` which can't set headers.

Solution: Move the `/connect` endpoint before the auth middleware as a public route, but validate the token manually via query param:

In `packages/api/src/app.ts`, register connect as public too (alongside callback):

```typescript
// Public Splitwise routes (OAuth redirects can't carry JWT headers)
app.get("/api/splitwise/callback", splitwiseCallbackHandler);
```

And update `splitwiseRoutes.get("/connect", ...)` to remain behind auth middleware — the frontend will need to use a different approach. Let me simplify:

Actually, the cleanest approach: keep `/connect` behind auth middleware. The frontend opens a new window or uses an intermediate step. But for simplicity, update the frontend's `handleSwConnect` to hit the API first to get the redirect URL, then redirect:

In `packages/api/src/routes/splitwise.ts`, change the `/connect` endpoint to return a JSON response with the URL instead of redirecting:

```typescript
// GET /connect — get Splitwise OAuth URL
splitwiseRoutes.get("/connect", (c) => {
  const userId = getUserId(c);
  const state = crypto.randomUUID();

  cleanExpiredStates();
  oauthStates.set(state, { userId, createdAt: Date.now() });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.SPLITWISE_CLIENT_ID,
    redirect_uri: env.SPLITWISE_REDIRECT_URI,
    state,
  });

  return c.json({ url: `https://secure.splitwise.com/oauth/authorize?${params.toString()}` });
});
```

And update the frontend's `handleSwConnect`:

```typescript
  const handleSwConnect = async () => {
    try {
      const data = await api<{ url: string }>("/splitwise/connect");
      window.location.href = data.url;
    } catch (e: unknown) {
      setSwError(e instanceof Error ? e.message : "Error al conectar");
    }
  };
```

- [ ] **Step 4: Start the dev server and test the UI**

Run:
```bash
pnpm dev
```

Open the browser at `http://localhost:5173/import`. Verify:
- The Splitwise section appears above the dropzone
- It shows "Conectar Splitwise" button (since no token is stored)
- The existing file import dropzone still works below it
- The styling is consistent with the rest of the app

- [ ] **Step 5: Lint**

Run:
```bash
pnpm lint
```
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/pages/Import.tsx packages/dashboard/src/lib/api.ts
git commit -m "feat: add Splitwise sync UI to Import page"
```

---

### Task 7: Integration test — full sync flow

**Files:**
- Modify: `packages/api/src/routes/__tests__/splitwise.test.ts`

- [ ] **Step 1: Add integration test for the sync flow with mocked Splitwise API**

Add a new describe block to `packages/api/src/routes/__tests__/splitwise.test.ts`:

```typescript
import { describe, it, expect, beforeAll, vi, afterAll } from "vitest";
import app from "../../app.js";
import { authHeader } from "../../test/helpers.js";
import { db } from "../../db/client.js";
import { users, expenses, splitwiseSyncState } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";

let auth: Record<string, string>;
let testUserId: string;

beforeAll(async () => {
  auth = await authHeader();
  // Get the test user ID from the auth header by decoding the JWT
  const token = auth.Authorization.split(" ")[1];
  const [, payload] = token.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  testUserId = decoded.sub;
});

// ... existing tests stay ...

describe("full sync flow (mocked Splitwise API)", () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeAll(() => {
    // Set up the test user with Splitwise credentials
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("inserts new expenses from Splitwise API", async () => {
    // 1. Set Splitwise credentials on test user
    await db
      .update(users)
      .set({
        splitwiseAccessToken: "test-token",
        splitwiseUserId: 1,
        splitwiseGroupId: 100,
        splitwiseGroupName: "Test Group",
      })
      .where(eq(users.id, testUserId));

    // Clear any existing sync state
    await db.delete(splitwiseSyncState).where(eq(splitwiseSyncState.userId, testUserId));

    // 2. Mock fetch for Splitwise API + dolarapi
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (urlStr.includes("secure.splitwise.com/api/v3.0/get_expenses")) {
        return new Response(
          JSON.stringify({
            expenses: [
              {
                id: 9001,
                description: "Supermercado Coto",
                cost: "15000.00",
                currency_code: "ARS",
                date: "2026-04-15T10:00:00Z",
                created_at: "2026-04-15T10:00:00Z",
                updated_at: "2026-04-15T10:00:00Z",
                deleted_at: null,
                payment: false,
                users: [
                  { user_id: 1, paid_share: "15000.00", owed_share: "7500.00", net_balance: "-7500.00" },
                ],
              },
              {
                id: 9002,
                description: "Pago a Juan",
                cost: "5000.00",
                currency_code: "ARS",
                date: "2026-04-16T10:00:00Z",
                created_at: "2026-04-16T10:00:00Z",
                updated_at: "2026-04-16T10:00:00Z",
                deleted_at: null,
                payment: true,
                users: [],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (urlStr.includes("dolarapi.com")) {
        return new Response(JSON.stringify({ venta: 1200 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return originalFetch(url as string);
    }) as typeof fetch;

    // 3. Trigger sync
    const res = await app.request("/api/splitwise/sync", {
      method: "POST",
      headers: auth,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Payment should be filtered out, only 1 expense inserted
    expect(body.inserted).toBe(1);
    expect(body.updated).toBe(0);
    expect(body.deleted).toBe(0);
    expect(body.exchangeRate).toBe(1200);

    // Verify the expense was inserted
    const inserted = await db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.userId, testUserId),
          eq(expenses.sourceRef, "9001"),
        ),
      );

    expect(inserted).toHaveLength(1);
    expect(inserted[0].description).toBe("Supermercado Coto");
    expect(Number(inserted[0].amount)).toBe(15000);
    expect(inserted[0].source).toBe("splitwise");
    expect(Number(inserted[0].amountArs)).toBe(15000);
    expect(Number(inserted[0].amountUsd)).toBe(12.5); // 15000 / 1200

    // Clean up
    await db.delete(expenses).where(eq(expenses.sourceRef, "9001"));
    await db.delete(splitwiseSyncState).where(eq(splitwiseSyncState.userId, testUserId));
    await db
      .update(users)
      .set({
        splitwiseAccessToken: null,
        splitwiseUserId: null,
        splitwiseGroupId: null,
        splitwiseGroupName: null,
      })
      .where(eq(users.id, testUserId));
  });
});
```

- [ ] **Step 2: Run the integration test**

Run:
```bash
pnpm test:api -- src/routes/__tests__/splitwise.test.ts
```
Expected: All tests pass.

- [ ] **Step 3: Run full test suite**

Run:
```bash
pnpm test:api
```
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/__tests__/splitwise.test.ts
git commit -m "test: add integration test for Splitwise sync flow"
```

---

### Task 8: End-to-end verification

- [ ] **Step 1: Run full lint and test suite**

Run:
```bash
pnpm lint && pnpm test:api
```
Expected: All pass.

- [ ] **Step 2: Manual UI verification**

Run:
```bash
pnpm dev
```

Open `http://localhost:5173/import` and verify:
1. Splitwise section appears at the top with "Conectar Splitwise" button
2. Below it, the existing file dropzone is unchanged
3. Uploading a CSV or PDF file still works as before
4. The page styling is consistent

- [ ] **Step 3: Verify no regressions in existing features**

Navigate to:
- Dashboard (`/`) — charts and expense table render correctly
- Import (`/import`) — file upload works
- Categorize (`/categorize`) — uncategorized expenses page loads

- [ ] **Step 4: Final commit — update .env.example if it exists**

Check if `.env.example` exists and add the new env vars if so:
```
SPLITWISE_CLIENT_ID=
SPLITWISE_CLIENT_SECRET=
SPLITWISE_REDIRECT_URI=http://localhost:3001/api/splitwise/callback
```

```bash
git add .env.example
git commit -m "docs: add Splitwise env vars to .env.example"
```

---

## Summary of files

| File | Action |
|------|--------|
| `packages/api/src/db/schema.ts` | Modify: add 4 columns to users + splitwiseSyncState table |
| `packages/api/src/config/env.ts` | Modify: add 3 Splitwise env vars |
| `packages/api/src/services/exchange-rate.ts` | Create: shared fetchBlueRate function |
| `packages/api/src/routes/import.ts` | Modify: import fetchBlueRate from shared service |
| `packages/api/src/services/splitwise-client.ts` | Create: HTTP wrapper for Splitwise API |
| `packages/api/src/services/splitwise-sync.ts` | Create: sync logic (fetch, map, upsert, delete, categorize) |
| `packages/api/src/routes/splitwise.ts` | Create: OAuth + sync + status endpoints |
| `packages/api/src/app.ts` | Modify: register Splitwise routes |
| `packages/dashboard/src/lib/api.ts` | Modify: add Splitwise API helpers |
| `packages/dashboard/src/pages/Import.tsx` | Modify: add Splitwise section |
| `packages/api/src/services/__tests__/splitwise-client.test.ts` | Create: client tests |
| `packages/api/src/services/__tests__/splitwise-sync.test.ts` | Create: sync mapping tests |
| `packages/api/src/routes/__tests__/splitwise.test.ts` | Create: route + integration tests |
