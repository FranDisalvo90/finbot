import { Hono } from "hono";
import { db } from "../db/client.js";
import { users, splitwiseSyncState } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { getUserId } from "../middleware/get-user.js";
import { splitwiseFetch, SplitwiseAuthError } from "../services/splitwise-client.js";
import { syncSplitwiseExpenses } from "../services/splitwise-sync.js";

export const splitwiseRoutes = new Hono();

// In-memory CSRF state store: state -> { userId, createdAt }
const oauthStates = new Map<string, { userId: string; createdAt: number }>();

// Clean expired states (older than 10 minutes)
function cleanExpiredStates() {
  const now = Date.now();
  for (const [state, data] of oauthStates) {
    if (now - data.createdAt > 10 * 60 * 1000) {
      oauthStates.delete(state);
    }
  }
}

// GET /status — connection status
splitwiseRoutes.get("/status", async (c) => {
  const userId = getUserId(c);
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  const connected = !!user?.splitwiseAccessToken;
  let lastSyncAt: string | null = null;

  if (connected) {
    const [sync] = await db
      .select()
      .from(splitwiseSyncState)
      .where(eq(splitwiseSyncState.userId, userId));
    lastSyncAt = sync?.lastSyncAt?.toISOString() ?? null;
  }

  return c.json({
    connected,
    groupId: user?.splitwiseGroupId ?? null,
    groupName: user?.splitwiseGroupName ?? null,
    lastSyncAt,
  });
});

// GET /connect — get Splitwise OAuth URL (returns JSON, frontend does the redirect)
splitwiseRoutes.get("/connect", (c) => {
  const userId = getUserId(c);
  const state = crypto.randomUUID();

  cleanExpiredStates();
  oauthStates.set(state, { userId, createdAt: Date.now() });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.SPLITWISE_CLIENT_ID,
    redirect_uri: env.SPLITWISE_REDIRECT_URI,
    state,
  });

  return c.json({ url: `https://secure.splitwise.com/oauth/authorize?${params.toString()}` });
});

// GET /groups — list user's Splitwise groups
splitwiseRoutes.get("/groups", async (c) => {
  const userId = getUserId(c);
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  if (!user?.splitwiseAccessToken) {
    return c.json({ error: "Splitwise not connected" }, 400);
  }

  const data = await splitwiseFetch<{
    groups: { id: number; name: string; members: { id: number }[] }[];
  }>("/get_groups", user.splitwiseAccessToken);

  const groups = data.groups
    .filter((g) => g.id !== 0)
    .map((g) => ({ id: g.id, name: g.name }));

  return c.json({ groups });
});

// POST /group — select active group
splitwiseRoutes.post("/group", async (c) => {
  const userId = getUserId(c);
  const { groupId, groupName } = await c.req.json();

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.splitwiseAccessToken) {
    return c.json({ error: "Splitwise not connected" }, 400);
  }

  await db
    .update(users)
    .set({ splitwiseGroupId: groupId, splitwiseGroupName: groupName })
    .where(eq(users.id, userId));

  // Reset sync state so the new group does a full sync
  await db.delete(splitwiseSyncState).where(eq(splitwiseSyncState.userId, userId));

  return c.json({ ok: true });
});

// POST /sync — trigger incremental sync
splitwiseRoutes.post("/sync", async (c) => {
  const userId = getUserId(c);
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  if (!user?.splitwiseAccessToken || !user?.splitwiseGroupId) {
    return c.json({ error: "Splitwise not connected or no group selected" }, 400);
  }

  try {
    const result = await syncSplitwiseExpenses(userId);
    return c.json(result);
  } catch (e) {
    if (e instanceof SplitwiseAuthError) {
      await db
        .update(users)
        .set({ splitwiseAccessToken: null, splitwiseUserId: null })
        .where(eq(users.id, userId));
      return c.json({ error: "splitwise_auth_expired" }, 401);
    }
    throw e;
  }
});

// POST /disconnect — clear Splitwise connection
splitwiseRoutes.post("/disconnect", async (c) => {
  const userId = getUserId(c);
  await db
    .update(users)
    .set({
      splitwiseAccessToken: null,
      splitwiseUserId: null,
      splitwiseGroupId: null,
      splitwiseGroupName: null,
    })
    .where(eq(users.id, userId));
  await db.delete(splitwiseSyncState).where(eq(splitwiseSyncState.userId, userId));
  return c.json({ ok: true });
});

// Standalone callback handler (registered as public route in app.ts)
export async function splitwiseCallbackHandler(c: import("hono").Context) {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400);
  }

  const stateData = oauthStates.get(state);
  if (!stateData) {
    return c.json({ error: "Invalid or expired state" }, 400);
  }
  oauthStates.delete(state);

  // Exchange code for access token
  const tokenRes = await fetch("https://secure.splitwise.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: env.SPLITWISE_CLIENT_ID,
      client_secret: env.SPLITWISE_CLIENT_SECRET,
      redirect_uri: env.SPLITWISE_REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    return c.json({ error: "Failed to exchange code for token" }, 500);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };

  // Get Splitwise user ID
  const swUser = await splitwiseFetch<{ user: { id: number } }>(
    "/get_current_user",
    tokenData.access_token,
  );

  // Save token and user ID
  await db
    .update(users)
    .set({
      splitwiseAccessToken: tokenData.access_token,
      splitwiseUserId: swUser.user.id,
    })
    .where(eq(users.id, stateData.userId));

  return c.redirect("/import?splitwise=connected");
}
