import { describe, it, expect, beforeAll, vi, afterAll } from "vitest";
import app from "../../app.js";
import { authHeader } from "../../test/helpers.js";
import { db } from "../../db/client.js";
import { users, expenses, splitwiseSyncState } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";

let auth: Record<string, string>;
beforeAll(async () => {
  auth = await authHeader();
});

const json = async (res: Response) => res.json();

describe("GET /api/splitwise/status", () => {
  it("returns not connected when no token stored", async () => {
    const res = await app.request("/api/splitwise/status", { headers: auth });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.connected).toBe(false);
    expect(body.groupName).toBeNull();
    expect(body.lastSyncAt).toBeNull();
  });
});

describe("POST /api/splitwise/group", () => {
  it("returns 400 when Splitwise not connected", async () => {
    const res = await app.request("/api/splitwise/group", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ groupId: 123, groupName: "Test Group" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/splitwise/sync", () => {
  it("returns 400 when Splitwise not connected", async () => {
    const res = await app.request("/api/splitwise/sync", {
      method: "POST",
      headers: auth,
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/splitwise/disconnect", () => {
  it("returns ok even when not connected", async () => {
    const res = await app.request("/api/splitwise/disconnect", {
      method: "POST",
      headers: auth,
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
  });
});

describe("full sync flow (mocked Splitwise API)", () => {
  const originalFetch = global.fetch;
  let testUserId: string;

  beforeAll(async () => {
    // Get the test user ID by decoding the JWT
    const token = auth.Authorization.split(" ")[1];
    const [, payload] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    testUserId = decoded.sub;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("inserts new expenses from Splitwise API and skips payments", async () => {
    // 1. Set Splitwise credentials on test user
    await db
      .update(users)
      .set({
        splitwiseAccessToken: "test-token",
        splitwiseUserId: 1,
        splitwiseGroupId: 100,
        splitwiseGroupName: "Test Group",
      })
      .where(eq(users.id, testUserId));

    // Clear any existing sync state
    await db.delete(splitwiseSyncState).where(eq(splitwiseSyncState.userId, testUserId));

    // 2. Mock fetch for Splitwise API + dolarapi
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (urlStr.includes("secure.splitwise.com/api/v3.0/get_expenses")) {
        return new Response(
          JSON.stringify({
            expenses: [
              {
                id: 9001,
                description: "Supermercado Coto",
                cost: "15000.00",
                currency_code: "ARS",
                date: "2026-04-15T10:00:00Z",
                created_at: "2026-04-15T10:00:00Z",
                updated_at: "2026-04-15T10:00:00Z",
                deleted_at: null,
                payment: false,
                users: [
                  { user_id: 1, paid_share: "15000.00", owed_share: "7500.00", net_balance: "-7500.00" },
                ],
              },
              {
                id: 9002,
                description: "Pago a Juan",
                cost: "5000.00",
                currency_code: "ARS",
                date: "2026-04-16T10:00:00Z",
                created_at: "2026-04-16T10:00:00Z",
                updated_at: "2026-04-16T10:00:00Z",
                deleted_at: null,
                payment: true,
                users: [],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (urlStr.includes("dolarapi.com")) {
        return new Response(JSON.stringify({ venta: 1200 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (urlStr.includes("anthropic.com")) {
        return new Response(JSON.stringify({
          content: [{ type: "text", text: "[]" }],
          model: "claude-sonnet-4-20250514",
          role: "assistant",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Fall through to original fetch for DB connections etc.
      return originalFetch(url as string | URL | Request);
    }) as typeof fetch;

    // 3. Trigger sync
    const res = await app.request("/api/splitwise/sync", {
      method: "POST",
      headers: auth,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Payment should be filtered out, only 1 expense inserted
    expect(body.inserted).toBe(1);
    expect(body.updated).toBe(0);
    expect(body.deleted).toBe(0);
    expect(body.exchangeRate).toBe(1200);

    // Verify the expense was inserted in DB
    const inserted = await db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.userId, testUserId),
          eq(expenses.sourceRef, "9001"),
        ),
      );

    expect(inserted).toHaveLength(1);
    expect(inserted[0].description).toBe("Supermercado Coto");
    expect(Number(inserted[0].amount)).toBe(15000);
    expect(inserted[0].source).toBe("splitwise");
    expect(Number(inserted[0].amountArs)).toBe(15000);
    expect(Number(inserted[0].amountUsd)).toBe(12.5); // 15000 / 1200

    // Clean up
    global.fetch = originalFetch;
    await db.delete(expenses).where(eq(expenses.sourceRef, "9001"));
    await db.delete(splitwiseSyncState).where(eq(splitwiseSyncState.userId, testUserId));
    await db
      .update(users)
      .set({
        splitwiseAccessToken: null,
        splitwiseUserId: null,
        splitwiseGroupId: null,
        splitwiseGroupName: null,
      })
      .where(eq(users.id, testUserId));
  });
});
