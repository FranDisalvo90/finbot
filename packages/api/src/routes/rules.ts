import { Hono } from "hono";
import { db } from "../db/client.js";
import { categorizationRules, categories } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const rulesRoutes = new Hono();

// GET /
rulesRoutes.get("/", async (c) => {
  const rows = await db
    .select({
      rule: categorizationRules,
      category: categories,
    })
    .from(categorizationRules)
    .leftJoin(categories, eq(categorizationRules.categoryId, categories.id));

  return c.json(rows.map((r) => ({ ...r.rule, category: r.category })));
});

// DELETE /:id
rulesRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await db
    .delete(categorizationRules)
    .where(eq(categorizationRules.id, id));
  return c.json({ ok: true });
});
