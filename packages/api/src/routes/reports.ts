import { Hono } from "hono";
import { db } from "../db/client.js";
import { expenses, categories } from "../db/schema.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { getHouseholdId } from "../middleware/get-user.js";

export const reportsRoutes = new Hono();

// GET /monthly?month=2026-02
reportsRoutes.get("/monthly", async (c) => {
  const householdId = getHouseholdId(c);
  const month = c.req.query("month");
  if (!month) return c.json({ error: "month query param required" }, 400);

  const rows = await db
    .select({
      expense: expenses,
      category: categories,
    })
    .from(expenses)
    .leftJoin(categories, eq(expenses.categoryId, categories.id))
    .where(and(eq(expenses.month, month), eq(expenses.householdId, householdId)));

  const expenseRows = rows.filter((r) => r.expense.type === "expense");
  const incomeRows = rows.filter((r) => r.expense.type === "income");

  const totalArs = expenseRows.reduce((s, r) => s + Number(r.expense.amountArs), 0);
  const totalUsd = expenseRows.reduce((s, r) => s + Number(r.expense.amountUsd), 0);
  const total = totalArs; // backward compat
  const count = expenseRows.length;
  const avgDailyArs = count > 0 ? totalArs / 30 : 0;
  const avgDailyUsd = count > 0 ? totalUsd / 30 : 0;

  const incomeTotalArs = incomeRows.reduce((s, r) => s + Number(r.expense.amountArs), 0);
  const incomeTotalUsd = incomeRows.reduce((s, r) => s + Number(r.expense.amountUsd), 0);
  const savingsArs = incomeTotalArs - totalArs;
  const savingsUsd = incomeTotalUsd - totalUsd;

  // Group by parent category (expenses only)
  const byCategory = new Map<
    string,
    {
      id: string;
      name: string;
      emoji: string | null;
      total: number;
      totalArs: number;
      totalUsd: number;
    }
  >();

  for (const r of expenseRows) {
    const cat = r.category;
    const parentId = cat?.parentId ?? cat?.id ?? "uncategorized";
    const existing = byCategory.get(parentId);
    if (existing) {
      existing.total += Number(r.expense.amount);
      existing.totalArs += Number(r.expense.amountArs);
      existing.totalUsd += Number(r.expense.amountUsd);
    } else {
      byCategory.set(parentId, {
        id: parentId,
        name: cat?.parentId ? "" : (cat?.name ?? "Sin categoría"),
        emoji: cat?.parentId ? null : (cat?.emoji ?? null),
        total: Number(r.expense.amount),
        totalArs: Number(r.expense.amountArs),
        totalUsd: Number(r.expense.amountUsd),
      });
    }
  }

  // Resolve parent names for child categories
  const parentIds = [...byCategory.keys()].filter((id) => id !== "uncategorized");
  if (parentIds.length > 0) {
    const parents = await db
      .select()
      .from(categories)
      .where(sql`${categories.id} IN ${parentIds}`);
    for (const p of parents) {
      const entry = byCategory.get(p.id);
      if (entry && !entry.name) {
        entry.name = p.name;
        entry.emoji = p.emoji;
      }
    }
  }

  return c.json({
    month,
    total,
    totalArs,
    totalUsd,
    count,
    avgDaily: avgDailyArs,
    avgDailyArs,
    avgDailyUsd,
    incomeTotalArs,
    incomeTotalUsd,
    savingsArs,
    savingsUsd,
    byCategory: [...byCategory.values()].sort((a, b) => b.total - a.total),
  });
});

// GET /trend?months=6
reportsRoutes.get("/trend", async (c) => {
  const householdId = getHouseholdId(c);
  const monthCount = Number(c.req.query("months") ?? 6);

  const result = await db
    .select({
      month: expenses.month,
      total: sql<number>`sum(${expenses.amount})::numeric`,
      totalArs: sql<number>`sum(${expenses.amountArs})::numeric`,
      totalUsd: sql<number>`sum(${expenses.amountUsd})::numeric`,
      count: sql<number>`count(*)::int`,
    })
    .from(expenses)
    .where(and(eq(expenses.type, "expense"), eq(expenses.householdId, householdId)))
    .groupBy(expenses.month)
    .orderBy(desc(expenses.month))
    .limit(monthCount);

  return c.json(result.reverse());
});

// GET /breakdown?month=2026-03
reportsRoutes.get("/breakdown", async (c) => {
  const householdId = getHouseholdId(c);
  const month = c.req.query("month");
  if (!month) return c.json({ error: "month query param required" }, 400);

  // Get all expenses for the month with their category (expenses only, no income)
  const rows = await db
    .select({
      expense: expenses,
      category: categories,
    })
    .from(expenses)
    .leftJoin(categories, eq(expenses.categoryId, categories.id))
    .where(and(eq(expenses.month, month), eq(expenses.type, "expense"), eq(expenses.householdId, householdId)));

  // Get all parent categories (for name/emoji resolution)
  const allParents = await db
    .select()
    .from(categories)
    .where(and(sql`${categories.parentId} IS NULL`, eq(categories.householdId, householdId)));

  const parentMap = new Map(allParents.map((p) => [p.id, p]));

  // Build: parentId -> { childId -> totals }
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

    // Determine parent and child
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

  // Convert to array, sort parents and children by total desc
  const result = [...breakdown.values()]
    .map((p) => ({
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      totalArs: p.totalArs,
      totalUsd: p.totalUsd,
      children: [...p.children.values()].sort((a, b) => b.totalArs - a.totalArs),
    }))
    .sort((a, b) => b.totalArs - a.totalArs);

  return c.json(result);
});

// GET /category/:id?month=2026-02
reportsRoutes.get("/category/:id", async (c) => {
  const householdId = getHouseholdId(c);
  const categoryId = c.req.param("id");
  const month = c.req.query("month");

  // Get child categories
  const children = await db
    .select()
    .from(categories)
    .where(and(eq(categories.parentId, categoryId), eq(categories.householdId, householdId)));

  const childIds = children.map((ch) => ch.id);
  const allIds = [categoryId, ...childIds];

  const conditions = [sql`${expenses.categoryId} IN ${allIds}`, eq(expenses.householdId, householdId)];
  if (month) conditions.push(eq(expenses.month, month));

  const rows = await db
    .select({
      expense: expenses,
      category: categories,
    })
    .from(expenses)
    .leftJoin(categories, eq(expenses.categoryId, categories.id))
    .where(and(...conditions))
    .orderBy(desc(expenses.date));

  // Subtotals by child
  const subtotals = children.map((ch) => {
    const childRows = rows.filter((r) => r.expense.categoryId === ch.id);
    return {
      ...ch,
      total: childRows.reduce((s, r) => s + Number(r.expense.amount), 0),
      totalArs: childRows.reduce((s, r) => s + Number(r.expense.amountArs), 0),
      totalUsd: childRows.reduce((s, r) => s + Number(r.expense.amountUsd), 0),
    };
  });

  return c.json({
    categoryId,
    subtotals: subtotals.sort((a, b) => b.total - a.total),
    expenses: rows.map((r) => ({ ...r.expense, category: r.category })),
  });
});

// GET /exchange-rate — fetch blue dollar rate
reportsRoutes.get("/exchange-rate", async (c) => {
  try {
    const res = await fetch("https://dolarapi.com/v1/dolares/blue");
    if (!res.ok) return c.json({ rate: null });
    const data = (await res.json()) as { venta: number };
    return c.json({ rate: data.venta });
  } catch {
    return c.json({ rate: null });
  }
});
