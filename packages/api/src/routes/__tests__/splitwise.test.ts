import { describe, it, expect, beforeAll } from "vitest";
import app from "../../app.js";
import { authHeader } from "../../test/helpers.js";

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
