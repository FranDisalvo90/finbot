import { sign } from "hono/jwt";
import { db } from "../db/client.js";
import { users, households, householdMembers } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { seedCategoriesForHousehold } from "../db/seed.js";

const TEST_GOOGLE_ID = "test-google-id";

let cachedUserId: string | null = null;
let cachedHouseholdId: string | null = null;

async function getOrCreateTestUser(): Promise<{ userId: string; householdId: string }> {
  if (cachedUserId && cachedHouseholdId) {
    return { userId: cachedUserId, householdId: cachedHouseholdId };
  }

  let [user] = await db.select().from(users).where(eq(users.googleId, TEST_GOOGLE_ID));
  if (!user) {
    [user] = await db
      .insert(users)
      .values({
        googleId: TEST_GOOGLE_ID,
        email: "test@example.com",
        name: "Test User",
        picture: null,
      })
      .returning();

    // Create a personal household for the test user
    const [household] = await db
      .insert(households)
      .values({ name: "Personal" })
      .returning();

    await db.insert(householdMembers).values({
      householdId: household.id,
      userId: user.id,
    });

    [user] = await db
      .update(users)
      .set({ activeHouseholdId: household.id })
      .where(eq(users.id, user.id))
      .returning();

    await seedCategoriesForHousehold(household.id);
  }

  cachedUserId = user.id;
  cachedHouseholdId = user.activeHouseholdId!;
  return { userId: cachedUserId, householdId: cachedHouseholdId };
}

export async function authHeader(): Promise<Record<string, string>> {
  const { userId, householdId } = await getOrCreateTestUser();
  const token = await sign(
    {
      sub: userId,
      email: "test@example.com",
      name: "Test User",
      picture: null,
      householdId,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    process.env.JWT_SECRET ?? "test-secret",
  );
  return { Authorization: `Bearer ${token}` };
}
