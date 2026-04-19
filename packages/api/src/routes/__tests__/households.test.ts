import { describe, it, expect, beforeAll } from "vitest";
import app from "../../app.js";
import { authHeader } from "../../test/helpers.js";

let auth: Record<string, string>;
beforeAll(async () => {
  auth = await authHeader();
});

describe("GET /api/households", () => {
  it("returns list of user households", async () => {
    const res = await app.request("/api/households", { headers: auth });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]).toHaveProperty("name");
    expect(body[0]).toHaveProperty("id");
  });
});

describe("POST /api/households", () => {
  it("creates a new household", async () => {
    const res = await app.request("/api/households", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ name: "Casa" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Casa");
    expect(body.token).toBeDefined();
  });
});

describe("POST /api/households/switch", () => {
  it("switches active household and returns new token", async () => {
    const listRes = await app.request("/api/households", { headers: auth });
    const households = await listRes.json();

    const res = await app.request("/api/households/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ householdId: households[0].id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();
  });
});

describe("POST /api/households/:id/invite", () => {
  it("generates an invite code", async () => {
    const listRes = await app.request("/api/households", { headers: auth });
    const households = await listRes.json();

    const res = await app.request(`/api/households/${households[0].id}/invite`, {
      method: "POST",
      headers: auth,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBeDefined();
    expect(body.code.length).toBe(8);
  });
});

describe("POST /api/households/join", () => {
  it("rejects already-a-member joining with invite code", async () => {
    const listRes = await app.request("/api/households", { headers: auth });
    const households = await listRes.json();

    // Generate invite for a household the user already belongs to
    const inviteRes = await app.request(`/api/households/${households[0].id}/invite`, {
      method: "POST",
      headers: auth,
    });
    const { code } = await inviteRes.json();

    // Try to join the same household — should fail
    const res = await app.request("/api/households/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Ya sos miembro de este hogar");
  });

  it("rejects invalid invite code", async () => {
    const res = await app.request("/api/households/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ code: "BADCODE1" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Codigo invalido");
  });
});

describe("GET /api/households/:id/members", () => {
  it("lists members of a household", async () => {
    const listRes = await app.request("/api/households", { headers: auth });
    const households = await listRes.json();

    const res = await app.request(`/api/households/${households[0].id}/members`, {
      headers: auth,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]).toHaveProperty("name");
    expect(body[0]).toHaveProperty("email");
  });
});

describe("PUT /api/households/:id", () => {
  it("updates household name", async () => {
    const listRes = await app.request("/api/households", { headers: auth });
    const households = await listRes.json();

    const res = await app.request(`/api/households/${households[0].id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ name: "Mi Casa Actualizada" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Mi Casa Actualizada");
  });
});
