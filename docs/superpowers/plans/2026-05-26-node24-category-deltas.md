# Node 24 + Category Breakdown Deltas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update to Node 24 / ES2024 and add month-over-month delta comparison to the category breakdown page.

**Architecture:** Extract the breakdown aggregation logic into a reusable function, call it for both current and previous months, merge the deltas into the response. Frontend renders deltas inline with color coding.

**Tech Stack:** Node 24, TypeScript (ES2024 target), Hono, Drizzle, React, Tailwind CSS

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `Dockerfile` (lines 1, 23) | Node base image 22→24 |
| Modify | `tsconfig.json` (line 3) | ES target 2022→2024 |
| Modify | `packages/api/src/routes/reports.ts` (lines 128-223) | Extract `aggregateBreakdown`, add delta merging |
| Modify | `packages/api/src/routes/__tests__/reports.test.ts` | Add breakdown delta tests |
| Modify | `packages/dashboard/src/pages/CategoryBreakdown.tsx` | Render deltas on parent/child rows |

---

### Task 1: Update Node 24 and ES2024

**Files:**
- Modify: `Dockerfile` (lines 1, 23)
- Modify: `tsconfig.json` (line 3)

- [ ] **Step 1: Update Dockerfile**

Change both stages from `node:22-slim` to `node:24-slim`:

```dockerfile
# Line 1
FROM node:24-slim AS base

# Line 23
FROM node:24-slim AS production
```

- [ ] **Step 2: Update tsconfig.json**

Change target from ES2022 to ES2024:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Verify lint passes**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add Dockerfile tsconfig.json
git commit -m "chore: update to Node 24 and ES2024 target"
```

---

### Task 2: Write failing tests for breakdown deltas

**Files:**
- Modify: `packages/api/src/routes/__tests__/reports.test.ts`

Tests seed expenses in two consecutive months and verify delta fields in the breakdown response.

- [ ] **Step 1: Write tests for breakdown deltas**

Add to the end of `packages/api/src/routes/__tests__/reports.test.ts`, after the existing `describe("GET /api/reports/breakdown")` block:

```typescript
describe("GET /api/reports/breakdown — deltas", () => {
  async function seedTwoMonths() {
    // Feb: category-less expenses
    await createExpense({
      amount: 800,
      currency: "ARS",
      description: "Feb expense A",
      date: "2026-02-05",
      exchangeRate: 1200,
    });
    await createExpense({
      amount: 200,
      currency: "ARS",
      description: "Feb expense B",
      date: "2026-02-15",
      exchangeRate: 1200,
    });
    // Mar: category-less expenses (different totals to get meaningful deltas)
    await createExpense({
      amount: 1000,
      currency: "ARS",
      description: "Mar expense A",
      date: "2026-03-01",
      exchangeRate: 1200,
    });
    await createExpense({
      amount: 500,
      currency: "ARS",
      description: "Mar expense B",
      date: "2026-03-10",
      exchangeRate: 1200,
    });
  }

  it("includes delta fields comparing to previous month by default", async () => {
    await seedTwoMonths();
    const res = await app.request("/api/reports/breakdown?month=2026-03", { headers: auth });
    const body = await json(res);

    expect(res.status).toBe(200);
    // At least one category should have delta fields
    const withDelta = body.find((c: any) => c.deltaArs !== null);
    expect(withDelta).toBeDefined();
    expect(withDelta).toHaveProperty("prevArs");
    expect(withDelta).toHaveProperty("deltaArs");
    expect(withDelta).toHaveProperty("deltaPct");
  });

  it("respects explicit compareTo param", async () => {
    await seedTwoMonths();
    const res = await app.request("/api/reports/breakdown?month=2026-03&compareTo=2026-02", {
      headers: auth,
    });
    const body = await json(res);

    expect(res.status).toBe(200);
    const withDelta = body.find((c: any) => c.deltaArs !== null);
    expect(withDelta).toBeDefined();
  });

  it("returns null deltas when no previous month data", async () => {
    // Seed only January (nothing in December)
    await createExpense({
      amount: 300,
      currency: "ARS",
      description: "Jan only",
      date: "2026-01-15",
      exchangeRate: 1200,
    });
    const res = await app.request("/api/reports/breakdown?month=2026-01", { headers: auth });
    const body = await json(res);

    expect(res.status).toBe(200);
    for (const cat of body) {
      expect(cat.deltaArs).toBeNull();
      expect(cat.deltaPct).toBeNull();
      expect(cat.prevArs).toBeNull();
    }
  });

  it("computes correct delta values", async () => {
    await seedTwoMonths();
    const res = await app.request("/api/reports/breakdown?month=2026-03", { headers: auth });
    const body = await json(res);

    // Uncategorized: Mar = 1500 (1000+500), Feb = 1000 (800+200) — but seedMonth() also runs, so
    // we just check the math is internally consistent
    for (const cat of body) {
      if (cat.deltaArs !== null && cat.prevArs !== null) {
        expect(cat.deltaArs).toBeCloseTo(cat.totalArs - cat.prevArs, 2);
        if (cat.prevArs > 0) {
          expect(cat.deltaPct).toBeCloseTo(((cat.totalArs - cat.prevArs) / cat.prevArs) * 100, 1);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test:api`
Expected: New tests FAIL — `deltaArs`, `prevArs`, `deltaPct` properties not present on response objects.

---

### Task 3: Implement breakdown delta logic in backend

**Files:**
- Modify: `packages/api/src/routes/reports.ts` (lines 128-223)

- [ ] **Step 1: Extract `aggregateBreakdown` function**

In `packages/api/src/routes/reports.ts`, replace the `/breakdown` handler (lines 128-223) with a helper function + refactored handler. Insert the helper function before the route handler (before line 128):

```typescript
interface BreakdownChild {
  id: string;
  name: string;
  totalArs: number;
  totalUsd: number;
}

interface BreakdownParent {
  id: string;
  name: string;
  emoji: string | null;
  totalArs: number;
  totalUsd: number;
  children: BreakdownChild[];
}

async function aggregateBreakdown(month: string, householdId: string): Promise<BreakdownParent[]> {
  const rows = await db
    .select({
      expense: expenses,
      category: categories,
    })
    .from(expenses)
    .leftJoin(categories, eq(expenses.categoryId, categories.id))
    .where(and(eq(expenses.month, month), eq(expenses.type, "expense"), eq(expenses.householdId, householdId)));

  const allParents = await db
    .select()
    .from(categories)
    .where(and(sql`${categories.parentId} IS NULL`, eq(categories.householdId, householdId)));

  const parentMap = new Map(allParents.map((p) => [p.id, p]));

  const breakdown = new Map<
    string,
    {
      id: string;
      name: string;
      emoji: string | null;
      totalArs: number;
      totalUsd: number;
      children: Map<string, { id: string; name: string; totalArs: number; totalUsd: number }>;
    }
  >();

  for (const r of rows) {
    const cat = r.category;
    const ars = Number(r.expense.amountArs);
    const usd = Number(r.expense.amountUsd);

    let parentId: string;
    let childId: string | null = null;
    let childName: string | null = null;

    if (!cat) {
      parentId = "uncategorized";
    } else if (cat.parentId) {
      parentId = cat.parentId;
      childId = cat.id;
      childName = cat.name;
    } else {
      parentId = cat.id;
    }

    if (!breakdown.has(parentId)) {
      const parent = parentMap.get(parentId);
      breakdown.set(parentId, {
        id: parentId,
        name: parent?.name ?? "Sin categoría",
        emoji: parent?.emoji ?? null,
        totalArs: 0,
        totalUsd: 0,
        children: new Map(),
      });
    }

    const entry = breakdown.get(parentId)!;
    entry.totalArs += ars;
    entry.totalUsd += usd;

    if (childId) {
      if (!entry.children.has(childId)) {
        entry.children.set(childId, { id: childId, name: childName!, totalArs: 0, totalUsd: 0 });
      }
      const child = entry.children.get(childId)!;
      child.totalArs += ars;
      child.totalUsd += usd;
    }
  }

  return [...breakdown.values()]
    .map((p) => ({
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      totalArs: p.totalArs,
      totalUsd: p.totalUsd,
      children: [...p.children.values()].sort((a, b) => b.totalArs - a.totalArs),
    }))
    .sort((a, b) => b.totalArs - a.totalArs);
}
```

- [ ] **Step 2: Replace the breakdown route handler with delta-aware version**

Replace the existing `reportsRoutes.get("/breakdown", ...)` handler with:

```typescript
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

reportsRoutes.get("/breakdown", async (c) => {
  const householdId = getHouseholdId(c);
  const month = c.req.query("month");
  if (!month) return c.json({ error: "month query param required" }, 400);

  const compareTo = c.req.query("compareTo") ?? shiftMonth(month, -1);

  const [current, previous] = await Promise.all([
    aggregateBreakdown(month, householdId),
    aggregateBreakdown(compareTo, householdId),
  ]);

  // Index previous month by parent ID and child ID for fast lookup
  const prevParentMap = new Map(previous.map((p) => [p.id, p]));
  const prevChildMap = new Map<string, BreakdownChild>();
  for (const p of previous) {
    for (const ch of p.children) {
      prevChildMap.set(ch.id, ch);
    }
  }

  const result = current.map((parent) => {
    const prev = prevParentMap.get(parent.id);
    const prevArs = prev?.totalArs ?? null;
    const prevUsd = prev?.totalUsd ?? null;

    return {
      ...parent,
      prevArs,
      prevUsd,
      deltaArs: prevArs !== null ? parent.totalArs - prevArs : null,
      deltaUsd: prevUsd !== null ? parent.totalUsd - prevUsd : null,
      deltaPct: prevArs !== null && prevArs > 0 ? ((parent.totalArs - prevArs) / prevArs) * 100 : null,
      children: parent.children.map((child) => {
        const prevChild = prevChildMap.get(child.id);
        const childPrevArs = prevChild?.totalArs ?? null;
        const childPrevUsd = prevChild?.totalUsd ?? null;

        return {
          ...child,
          prevArs: childPrevArs,
          prevUsd: childPrevUsd,
          deltaArs: childPrevArs !== null ? child.totalArs - childPrevArs : null,
          deltaUsd: childPrevUsd !== null ? child.totalUsd - childPrevUsd : null,
          deltaPct:
            childPrevArs !== null && childPrevArs > 0
              ? ((child.totalArs - childPrevArs) / childPrevArs) * 100
              : null,
        };
      }),
    };
  });

  return c.json(result);
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm test:api`
Expected: All tests pass, including the new delta tests.

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/reports.ts packages/api/src/routes/__tests__/reports.test.ts
git commit -m "feat: add month-over-month deltas to category breakdown endpoint"
```

---

### Task 4: Update frontend to display deltas

**Files:**
- Modify: `packages/dashboard/src/pages/CategoryBreakdown.tsx`

- [ ] **Step 1: Update TypeScript interfaces**

Replace the `ChildBreakdown` and `ParentBreakdown` interfaces (lines 6-20) with:

```typescript
interface ChildBreakdown {
  id: string;
  name: string;
  totalArs: number;
  totalUsd: number;
  prevArs: number | null;
  prevUsd: number | null;
  deltaArs: number | null;
  deltaUsd: number | null;
  deltaPct: number | null;
}

interface ParentBreakdown {
  id: string;
  name: string;
  emoji: string | null;
  totalArs: number;
  totalUsd: number;
  prevArs: number | null;
  prevUsd: number | null;
  deltaArs: number | null;
  deltaUsd: number | null;
  deltaPct: number | null;
  children: ChildBreakdown[];
}
```

- [ ] **Step 2: Add delta formatting helper**

Add after the `pickTotal` function (after line 57):

```typescript
const pickDelta = (r: { deltaArs: number | null; deltaUsd: number | null }) =>
  currency === "ARS" ? r.deltaArs : r.deltaUsd;

function DeltaBadge({ delta, pct }: { delta: number | null; pct: number | null }) {
  if (delta === null) return null;
  const isUp = delta > 0;
  const color = isUp ? "text-red-400" : "text-green-400";
  const sign = isUp ? "+" : "";
  return (
    <span className={`text-xs ${color} whitespace-nowrap`}>
      {sign}{fmt(delta)} ({pct !== null ? `${sign}${pct.toFixed(1)}%` : "—"})
    </span>
  );
}
```

- [ ] **Step 3: Add grand total delta display**

Replace the grand total line (line 129) with:

```tsx
{!loading && (
  <div className="flex items-center gap-3">
    <span className="text-lg font-semibold text-white">{fmt(grandTotal)}</span>
    {(() => {
      const totalDelta = data.reduce((s, p) => {
        const d = pickDelta(p);
        return d !== null ? s + d : s;
      }, 0);
      const totalPrev = data.reduce((s, p) => {
        const prev = currency === "ARS" ? p.prevArs : p.prevUsd;
        return prev !== null ? s + prev : s;
      }, 0);
      const hasDelta = data.some((p) => pickDelta(p) !== null);
      if (!hasDelta) return null;
      const pct = totalPrev > 0 ? (totalDelta / totalPrev) * 100 : null;
      return <DeltaBadge delta={totalDelta} pct={pct} />;
    })()}
  </div>
)}
```

- [ ] **Step 4: Add delta to parent rows**

In the parent row button (around line 163), after the `fmt(parentTotal)` span, add the delta badge. Replace:

```tsx
<span className="font-mono text-white font-medium">{fmt(parentTotal)}</span>
```

With:

```tsx
<span className="font-mono text-white font-medium">{fmt(parentTotal)}</span>
<DeltaBadge delta={pickDelta(parent)} pct={parent.deltaPct} />
```

- [ ] **Step 5: Add delta to child rows**

In the child row (around line 187-189), after the child amount span, add the delta. Replace:

```tsx
<span className="font-mono text-sm text-gray-200 w-28 text-right">
  {fmt(childTotal)}
</span>
```

With:

```tsx
<span className="font-mono text-sm text-gray-200 w-28 text-right">
  {fmt(childTotal)}
</span>
<DeltaBadge delta={pickDelta(child)} pct={child.deltaPct} />
```

- [ ] **Step 6: Run lint**

Run: `pnpm lint`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/pages/CategoryBreakdown.tsx
git commit -m "feat: display month-over-month deltas in category breakdown UI"
```

---

### Task 5: Manual verification

- [ ] **Step 1: Start dev servers**

Run: `pnpm dev`

- [ ] **Step 2: Verify in browser**

Open `http://localhost:5173`, navigate to the category breakdown page. Verify:
1. Categories and subcategories are sorted by amount (descending)
2. Delta badges appear next to amounts with correct colors (red for increase, green for decrease)
3. Grand total shows aggregate delta
4. Navigating to a month with no previous data shows no delta badges
5. Currency toggle (ARS/USD) switches delta display correctly

- [ ] **Step 3: Run full test suite**

Run: `pnpm test:api && pnpm lint`
Expected: All pass.

- [ ] **Step 4: Final commit if any adjustments**

Commit any fixes found during manual verification.
