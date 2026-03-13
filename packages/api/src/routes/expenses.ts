import { Hono } from "hono";
import { db } from "../db/client.js";
import { expenses, categories } from "../db/schema.js";
import { eq, isNull, and, desc } from "drizzle-orm";
import { getUserId } from "../middleware/get-user.js";

export const expensesRoutes = new Hono();

// GET / — list with filters
expensesRoutes.get("/", async (c) => {
  const userId = getUserId(c);
  const month = c.req.query("month");
  const uncategorized = c.req.query("uncategorized");

  const conditions = [eq(expenses.userId, userId)];
  if (month) conditions.push(eq(expenses.month, month));
  if (uncategorized === "true") conditions.push(isNull(expenses.categoryId));

  const rows = await db
    .select({
      expense: expenses,
      category: categories,
    })
    .from(expenses)
    .leftJoin(categories, eq(expenses.categoryId, categories.id))
    .where(and(...conditions))
    .orderBy(desc(expenses.date));

  return c.json(rows.map((r) => ({ ...r.expense, category: r.category })));
});

// POST / — create manual
expensesRoutes.post("/", async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json();
  const currency = body.currency ?? "ARS";
  const amount = Number(body.amount);
  const exchangeRate = body.exchangeRate ? Number(body.exchangeRate) : null;

  let amountArs: number;
  let amountUsd: number;

  if (currency === "ARS") {
    amountArs = amount;
    amountUsd = exchangeRate ? amount / exchangeRate : 0;
  } else {
    amountUsd = amount;
    amountArs = exchangeRate ? amount * exchangeRate : 0;
  }

  const [created] = await db
    .insert(expenses)
    .values({
      userId,
      amount: String(amount),
      currency,
      description: body.description,
      categoryId: body.categoryId,
      type: body.type ?? "expense",
      source: "manual",
      date: body.date,
      month: body.date.substring(0, 7),
      amountArs: String(amountArs),
      amountUsd: String(amountUsd),
      exchangeRate: exchangeRate ? String(exchangeRate) : null,
    })
    .returning();
  return c.json(created, 201);
});

// PUT /:id — update
expensesRoutes.put("/:id", async (c) => {
  const userId = getUserId(c);
  const id = c.req.param("id");
  const body = await c.req.json();

  // Fetch existing expense to get currency and exchange rate for recalculation
  const [existing] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.userId, userId)));
  if (!existing) return c.json({ error: "Not found" }, 404);

  const updates: Record<string, unknown> = {};
  if (body.categoryId !== undefined) updates.categoryId = body.categoryId;
  if (body.description !== undefined) updates.description = body.description;
  if (body.date !== undefined) {
    updates.date = body.date;
    updates.month = body.date.substring(0, 7);
  }

  if (body.amount !== undefined) {
    const newAmount = Number(body.amount);
    const currency = body.currency ?? existing.currency;
    const rate = existing.exchangeRate ? Number(existing.exchangeRate) : null;

    updates.amount = String(newAmount);
    updates.currency = currency;

    if (rate) {
      if (currency === "ARS") {
        updates.amountArs = String(newAmount);
        updates.amountUsd = String(+(newAmount / rate).toFixed(2));
      } else {
        updates.amountUsd = String(newAmount);
        updates.amountArs = String(+(newAmount * rate).toFixed(2));
      }
    } else {
      if (currency === "ARS") {
        updates.amountArs = String(newAmount);
      } else {
        updates.amountUsd = String(newAmount);
      }
    }
  }

  const [updated] = await db
    .update(expenses)
    .set(updates)
    .where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
    .returning();
  return c.json(updated);
});

// DELETE /:id
expensesRoutes.delete("/:id", async (c) => {
  const userId = getUserId(c);
  const id = c.req.param("id");
  await db.delete(expenses).where(and(eq(expenses.id, id), eq(expenses.userId, userId)));
  return c.json({ ok: true });
});
