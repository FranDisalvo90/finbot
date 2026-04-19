import { Hono } from "hono";
import { db } from "../db/client.js";
import { categories, expenses } from "../db/schema.js";
import { eq, and, asc } from "drizzle-orm";
import { getHouseholdId } from "../middleware/get-user.js";

export const categoriesRoutes = new Hono();

// GET / — full tree
categoriesRoutes.get("/", async (c) => {
  const householdId = getHouseholdId(c);
  const all = await db
    .select()
    .from(categories)
    .where(eq(categories.householdId, householdId))
    .orderBy(asc(categories.sortOrder));

  const parents = all.filter((cat) => !cat.parentId);
  const tree = parents.map((parent) => ({
    ...parent,
    children: all.filter((cat) => cat.parentId === parent.id),
  }));

  return c.json(tree);
});

// POST / — create
categoriesRoutes.post("/", async (c) => {
  const householdId = getHouseholdId(c);
  const body = await c.req.json();
  const [created] = await db
    .insert(categories)
    .values({
      householdId,
      name: body.name,
      emoji: body.emoji,
      parentId: body.parentId,
      sortOrder: body.sortOrder ?? 0,
    })
    .returning();
  return c.json(created, 201);
});

// PUT /:id — update
categoriesRoutes.put("/:id", async (c) => {
  const householdId = getHouseholdId(c);
  const id = c.req.param("id");
  const body = await c.req.json();
  const [updated] = await db
    .update(categories)
    .set({
      name: body.name,
      emoji: body.emoji,
      sortOrder: body.sortOrder,
    })
    .where(and(eq(categories.id, id), eq(categories.householdId, householdId)))
    .returning();
  return c.json(updated);
});

// DELETE /:id
categoriesRoutes.delete("/:id", async (c) => {
  const householdId = getHouseholdId(c);
  const id = c.req.param("id");

  // Verify ownership
  const [cat] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.householdId, householdId)));
  if (!cat) return c.json({ error: "Category not found" }, 404);

  // Check if category has expenses (scoped to household)
  const linked = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.categoryId, id), eq(expenses.householdId, householdId)))
    .limit(1);

  if (linked.length > 0) {
    return c.json({ error: "Cannot delete category with associated expenses" }, 400);
  }

  // Delete children first (scoped to household)
  await db
    .delete(categories)
    .where(and(eq(categories.parentId, id), eq(categories.householdId, householdId)));
  await db
    .delete(categories)
    .where(and(eq(categories.id, id), eq(categories.householdId, householdId)));

  return c.json({ ok: true });
});
