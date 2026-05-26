# Node 24 Update + Category Breakdown Deltas

**Date:** 2026-05-26

## Part 1: Node 24 Update

### Changes

- **Dockerfile:** Both stages (`base` and `production`) change `node:22-slim` → `node:24-slim`
- **tsconfig.json (root):** `target` from `ES2022` → `ES2024`
- No `.nvmrc`, `engines`, or other version files exist — Dockerfile is the single source of truth

## Part 2: Monthly Category Comparison with Deltas

### Goal

Show the spending delta (absolute + percentage) between the current month and the previous month for each parent category and subcategory in the CategoryBreakdown page.

### Backend — `GET /reports/breakdown`

**New query param:** `compareTo=YYYY-MM` (optional, defaults to month before `month`)

**Implementation:**

1. Extract the current aggregation logic into a reusable function `aggregateBreakdown(month, householdId)` that returns the existing breakdown structure.
2. Call it twice: once for `month`, once for `compareTo`.
3. Merge results: for each parent and child in the current month's data, look up the same ID in the comparison month and compute deltas.
4. New fields on each parent and child object:
   - `prevArs: number | null` — amount from comparison month
   - `prevUsd: number | null` — amount from comparison month
   - `deltaArs: number | null` — `totalArs - prevArs`
   - `deltaUsd: number | null` — `totalUsd - prevUsd`
   - `deltaPct: number | null` — `((totalArs - prevArs) / prevArs) * 100`
   - All fields are `null` when the category didn't exist in the comparison month

**Sorting:** Parents and children remain sorted by `totalArs` descending (current month).

**Backwards compatibility:** When `compareTo` is not provided, the endpoint still computes deltas using the previous month by default. The response shape adds optional fields — existing consumers ignore them.

### Frontend — `CategoryBreakdown.tsx`

**Delta display on parent rows:**
- After the amount, show delta in format: `+$15.000 (+25%)` or `-$8.000 (-12%)`
- Color: green text when spending decreased (negative delta = good), red text when spending increased
- Hidden when `deltaArs`/`deltaUsd` is `null`

**Delta display on child rows:**
- Same format and colors as parent rows, placed after the child amount

**Grand total delta:**
- Sum of all parent deltas, displayed next to grand total with same formatting

**Interfaces updated:**
- `ParentBreakdown` and `ChildBreakdown` gain optional `prevArs`, `prevUsd`, `deltaArs`, `deltaUsd`, `deltaPct` fields

### Edge Cases

- Category exists this month but not last month → delta fields are `null`, no delta shown
- Category existed last month but not this month → not shown (we only show current month's categories)
- First month of data (no previous month) → all deltas are `null`
- Zero spending in comparison month → `deltaPct` is `null` (avoid division by zero)
