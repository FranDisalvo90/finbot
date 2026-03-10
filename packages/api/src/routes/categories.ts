import { Hono } from "hono";
import { db } from "../db/client.js";
import { categories, expenses } from "../db/schema.js";
import { eq, isNull, asc } from "drizzle-orm";

export const categoriesRoutes = new Hono();

// GET / — full tree
categoriesRoutes.get("/", async (c) => {
  const all = await db
    .select()
    .from(categories)
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
  const body = await c.req.json();
  const [created] = await db
    .insert(categories)
    .values({
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
  const id = c.req.param("id");
  const body = await c.req.json();
  const [updated] = await db
    .update(categories)
    .set({
      name: body.name,
      emoji: body.emoji,
      sortOrder: body.sortOrder,
    })
    .where(eq(categories.id, id))
    .returning();
  return c.json(updated);
});

// DELETE /:id
categoriesRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  // Check if category has expenses
  const linked = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(eq(expenses.categoryId, id))
    .limit(1);

  if (linked.length > 0) {
    return c.json(
      { error: "Cannot delete category with associated expenses" },
      400
    );
  }

  // Delete children first
  await db.delete(categories).where(eq(categories.parentId, id));
  await db.delete(categories).where(eq(categories.id, id));

  return c.json({ ok: true });
});
