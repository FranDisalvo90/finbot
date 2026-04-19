import { Hono } from "hono";
import { sign } from "hono/jwt";
import { OAuth2Client } from "google-auth-library";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { users, households, householdMembers } from "../db/schema.js";
import { seedCategoriesForHousehold } from "../db/seed.js";

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

export const authRoutes = new Hono();

authRoutes.get("/config", (c) => {
  return c.json({ clientId: env.GOOGLE_CLIENT_ID });
});

authRoutes.post("/google", async (c) => {
  const { credential } = await c.req.json();

  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    return c.json({ error: "Token inválido" }, 401);
  }

  // Find or create user
  let [user] = await db.select().from(users).where(eq(users.googleId, payload.sub));

  if (!user) {
    [user] = await db
      .insert(users)
      .values({
        googleId: payload.sub,
        email: payload.email,
        name: payload.name ?? payload.email,
        picture: payload.picture ?? null,
      })
      .returning();

    // Create a personal household for the new user
    const [household] = await db
      .insert(households)
      .values({ name: "Personal" })
      .returning();

    // Add user as a member of the household
    await db.insert(householdMembers).values({
      householdId: household.id,
      userId: user.id,
    });

    // Set the user's active household
    [user] = await db
      .update(users)
      .set({ activeHouseholdId: household.id })
      .where(eq(users.id, user.id))
      .returning();

    await seedCategoriesForHousehold(household.id);
  }

  const token = await sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      householdId: user.activeHouseholdId,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    },
    env.JWT_SECRET,
  );

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      activeHouseholdId: user.activeHouseholdId,
    },
  });
});
