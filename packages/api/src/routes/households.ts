import { Hono } from "hono";
import { sign } from "hono/jwt";
import { db } from "../db/client.js";
import { households, householdMembers, householdInvites, users } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { env } from "../config/env.js";
import { getUserId } from "../middleware/get-user.js";
import { seedCategoriesForHousehold } from "../db/seed.js";

export const householdsRoutes = new Hono();

async function issueToken(userId: string, householdId: string): Promise<string> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  return sign(
    {
      sub: userId,
      householdId,
      email: user.email,
      name: user.name,
      picture: user.picture,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    },
    env.JWT_SECRET,
  );
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// GET / — list user's households
householdsRoutes.get("/", async (c) => {
  const userId = getUserId(c);
  const rows = await db
    .select({ household: households })
    .from(householdMembers)
    .innerJoin(households, eq(householdMembers.householdId, households.id))
    .where(eq(householdMembers.userId, userId));

  return c.json(rows.map((r) => r.household));
});

// POST / — create new household
householdsRoutes.post("/", async (c) => {
  const userId = getUserId(c);
  const { name } = await c.req.json();

  if (!name || typeof name !== "string") {
    return c.json({ error: "name (string) required" }, 400);
  }

  const [household] = await db.insert(households).values({ name }).returning();

  await db.insert(householdMembers).values({
    householdId: household.id,
    userId,
  });

  await db
    .update(users)
    .set({ activeHouseholdId: household.id })
    .where(eq(users.id, userId));

  await seedCategoriesForHousehold(household.id);

  const token = await issueToken(userId, household.id);

  return c.json({ ...household, token }, 201);
});

// PUT /:id — update household name
householdsRoutes.put("/:id", async (c) => {
  const userId = getUserId(c);
  const id = c.req.param("id");
  const { name } = await c.req.json();

  // Verify membership
  const [member] = await db
    .select()
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, id), eq(householdMembers.userId, userId)));
  if (!member) return c.json({ error: "Not a member" }, 403);

  const [updated] = await db
    .update(households)
    .set({ name })
    .where(eq(households.id, id))
    .returning();

  return c.json(updated);
});

// POST /switch — switch active household
householdsRoutes.post("/switch", async (c) => {
  const userId = getUserId(c);
  const { householdId } = await c.req.json();

  // Verify membership
  const [member] = await db
    .select()
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));
  if (!member) return c.json({ error: "Not a member of this household" }, 403);

  await db
    .update(users)
    .set({ activeHouseholdId: householdId })
    .where(eq(users.id, userId));

  const token = await issueToken(userId, householdId);

  return c.json({ token });
});

// GET /:id/members — list household members
householdsRoutes.get("/:id/members", async (c) => {
  const userId = getUserId(c);
  const id = c.req.param("id");

  // Verify membership
  const [member] = await db
    .select()
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, id), eq(householdMembers.userId, userId)));
  if (!member) return c.json({ error: "Not a member" }, 403);

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      picture: users.picture,
    })
    .from(householdMembers)
    .innerJoin(users, eq(householdMembers.userId, users.id))
    .where(eq(householdMembers.householdId, id));

  return c.json(rows);
});

// POST /:id/invite — generate invite code
householdsRoutes.post("/:id/invite", async (c) => {
  const userId = getUserId(c);
  const id = c.req.param("id");

  // Verify membership
  const [member] = await db
    .select()
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, id), eq(householdMembers.userId, userId)));
  if (!member) return c.json({ error: "Not a member" }, 403);

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  await db.insert(householdInvites).values({
    householdId: id,
    code,
    createdBy: userId,
    expiresAt,
  });

  return c.json({ code, expiresAt: expiresAt.toISOString() });
});

// POST /join — join household by invite code
householdsRoutes.post("/join", async (c) => {
  const userId = getUserId(c);
  const { code } = await c.req.json();

  if (!code || typeof code !== "string") {
    return c.json({ error: "code (string) required" }, 400);
  }

  const [invite] = await db
    .select()
    .from(householdInvites)
    .where(eq(householdInvites.code, code));

  if (!invite) {
    return c.json({ error: "Codigo invalido" }, 400);
  }

  if (new Date() > invite.expiresAt) {
    await db.delete(householdInvites).where(eq(householdInvites.id, invite.id));
    return c.json({ error: "Codigo expirado" }, 400);
  }

  // Check if already a member
  const [existing] = await db
    .select()
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, invite.householdId),
        eq(householdMembers.userId, userId),
      ),
    );

  if (existing) {
    return c.json({ error: "Ya sos miembro de este hogar" }, 400);
  }

  await db.insert(householdMembers).values({
    householdId: invite.householdId,
    userId,
  });

  // Delete used invite
  await db.delete(householdInvites).where(eq(householdInvites.id, invite.id));

  // Switch to the joined household
  await db
    .update(users)
    .set({ activeHouseholdId: invite.householdId })
    .where(eq(users.id, userId));

  const token = await issueToken(userId, invite.householdId);

  const [household] = await db
    .select()
    .from(households)
    .where(eq(households.id, invite.householdId));

  return c.json({ household, token });
});

// POST /:id/leave — leave a household
householdsRoutes.post("/:id/leave", async (c) => {
  const userId = getUserId(c);
  const id = c.req.param("id");

  // Count user's total households
  const memberCount = await db
    .select()
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId));

  if (memberCount.length <= 1) {
    return c.json({ error: "No podes abandonar tu unico hogar" }, 400);
  }

  await db
    .delete(householdMembers)
    .where(and(eq(householdMembers.householdId, id), eq(householdMembers.userId, userId)));

  // If this was the active household, switch to another one
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (user.activeHouseholdId === id) {
    const [other] = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, userId));

    await db
      .update(users)
      .set({ activeHouseholdId: other.householdId })
      .where(eq(users.id, userId));

    const token = await issueToken(userId, other.householdId);
    return c.json({ ok: true, token });
  }

  return c.json({ ok: true });
});
