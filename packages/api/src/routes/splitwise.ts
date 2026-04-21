import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "../db/client.js";
import { users, splitwiseSyncState, householdMembers } from "../db/schema.js";
import { eq, and, isNotNull } from "drizzle-orm";
import { env } from "../config/env.js";
import { getUserId, getHouseholdId } from "../middleware/get-user.js";
import { splitwiseFetch, SplitwiseAuthError } from "../services/splitwise-client.js";
import { syncSplitwiseExpenses } from "../services/splitwise-sync.js";

export const splitwiseRoutes = new Hono();

// In-memory CSRF state store: state -> { userId, createdAt }
const oauthStates = new Map<string, { userId: string; createdAt: number }>();

// Find any household member with a Splitwise connection
async function findSplitwiseUser(householdId: string) {
  const [row] = await db
    .select({ user: users })
    .from(householdMembers)
    .innerJoin(users, eq(householdMembers.userId, users.id))
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        isNotNull(users.splitwiseAccessToken),
      ),
    )
    .limit(1);
  return row?.user ?? null;
}

// Clean expired states (older than 10 minutes)
function cleanExpiredStates() {
  const now = Date.now();
  for (const [state, data] of oauthStates) {
    if (now - data.createdAt > 10 * 60 * 1000) {
      oauthStates.delete(state);
    }
  }
}

// GET /status — connection status (household-level)
splitwiseRoutes.get("/status", async (c) => {
  const householdId = getHouseholdId(c);
  const swUser = await findSplitwiseUser(householdId);

  const connected = !!swUser;
  let lastSyncAt: string | null = null;

  if (connected) {
    const [sync] = await db
      .select()
      .from(splitwiseSyncState)
      .where(eq(splitwiseSyncState.householdId, householdId));
    lastSyncAt = sync?.lastSyncAt?.toISOString() ?? null;
  }

  return c.json({
    connected,
    groupId: swUser?.splitwiseGroupId ?? null,
    groupName: swUser?.splitwiseGroupName ?? null,
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

// GET /groups — list Splitwise groups (uses any connected member's token)
splitwiseRoutes.get("/groups", async (c) => {
  const householdId = getHouseholdId(c);
  const swUser = await findSplitwiseUser(householdId);

  if (!swUser) {
    return c.json({ error: "Splitwise not connected" }, 400);
  }

  const data = await splitwiseFetch<{
    groups: { id: number; name: string; members: { id: number }[] }[];
  }>("/get_groups", swUser.splitwiseAccessToken!);

  const groups = data.groups
    .filter((g) => g.id !== 0)
    .map((g) => ({ id: g.id, name: g.name }));

  return c.json({ groups });
});

// POST /group — select active group (updates the connected member)
splitwiseRoutes.post("/group", async (c) => {
  const householdId = getHouseholdId(c);
  const { groupId, groupName } = await c.req.json();

  if (typeof groupId !== "number" || typeof groupName !== "string") {
    return c.json({ error: "groupId (number) and groupName (string) required" }, 400);
  }

  const swUser = await findSplitwiseUser(householdId);
  if (!swUser) {
    return c.json({ error: "Splitwise not connected" }, 400);
  }

  await db
    .update(users)
    .set({ splitwiseGroupId: groupId, splitwiseGroupName: groupName })
    .where(eq(users.id, swUser.id));

  // Reset sync state so the new group does a full sync
  await db.delete(splitwiseSyncState).where(eq(splitwiseSyncState.householdId, householdId));

  return c.json({ ok: true });
});

// POST /sync — trigger incremental sync (uses any connected member's token)
splitwiseRoutes.post("/sync", async (c) => {
  const householdId = getHouseholdId(c);
  const swUser = await findSplitwiseUser(householdId);

  if (!swUser?.splitwiseAccessToken || !swUser?.splitwiseGroupId) {
    return c.json({ error: "Splitwise not connected or no group selected" }, 400);
  }

  try {
    const result = await syncSplitwiseExpenses(swUser.id, householdId);
    return c.json(result);
  } catch (e) {
    if (e instanceof SplitwiseAuthError) {
      await db
        .update(users)
        .set({ splitwiseAccessToken: null, splitwiseUserId: null })
        .where(eq(users.id, swUser.id));
      return c.json({ error: "splitwise_auth_expired" }, 401);
    }
    throw e;
  }
});

// POST /disconnect — clear Splitwise connection (disconnects the connected member)
splitwiseRoutes.post("/disconnect", async (c) => {
  const householdId = getHouseholdId(c);
  const swUser = await findSplitwiseUser(householdId);

  if (swUser) {
    await db
      .update(users)
      .set({
        splitwiseAccessToken: null,
        splitwiseUserId: null,
        splitwiseGroupId: null,
        splitwiseGroupName: null,
      })
      .where(eq(users.id, swUser.id));
  }
  await db.delete(splitwiseSyncState).where(eq(splitwiseSyncState.householdId, householdId));
  return c.json({ ok: true });
});

// Standalone callback handler (registered as public route in app.ts)
export async function splitwiseCallbackHandler(c: Context) {
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
    const errBody = await tokenRes.text().catch(() => "no body");
    console.error("Splitwise token exchange failed:", tokenRes.status, errBody);
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
