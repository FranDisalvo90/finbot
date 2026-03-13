import { Hono } from "hono";
import { db } from "../db/client.js";
import { categorizationRules, categories } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { getUserId } from "../middleware/get-user.js";

export const rulesRoutes = new Hono();

// GET /
rulesRoutes.get("/", async (c) => {
  const userId = getUserId(c);
  const rows = await db
    .select({
      rule: categorizationRules,
      category: categories,
    })
    .from(categorizationRules)
    .leftJoin(categories, eq(categorizationRules.categoryId, categories.id))
    .where(eq(categorizationRules.userId, userId));

  return c.json(rows.map((r) => ({ ...r.rule, category: r.category })));
});

// DELETE /:id
rulesRoutes.delete("/:id", async (c) => {
  const userId = getUserId(c);
  const id = c.req.param("id");
  await db
    .delete(categorizationRules)
    .where(and(eq(categorizationRules.id, id), eq(categorizationRules.userId, userId)));
  return c.json({ ok: true });
});
