import { sign } from "hono/jwt";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { seedCategoriesForUser } from "../db/seed.js";

const TEST_GOOGLE_ID = "test-google-id";

let cachedUserId: string | null = null;

async function getOrCreateTestUser(): Promise<string> {
  if (cachedUserId) return cachedUserId;

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
    await seedCategoriesForUser(user.id);
  }
  cachedUserId = user.id;
  return user.id;
}

export async function authHeader(): Promise<Record<string, string>> {
  const userId = await getOrCreateTestUser();
  const token = await sign(
    {
      sub: userId,
      email: "test@example.com",
      name: "Test User",
      picture: null,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    process.env.JWT_SECRET ?? "test-secret",
  );
  return { Authorization: `Bearer ${token}` };
}
