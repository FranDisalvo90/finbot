import { describe, it, expect, vi, beforeAll } from "vitest";
import app from "../../app.js";
import { authHeader } from "../../test/helpers.js";

let auth: Record<string, string>;
beforeAll(async () => {
  auth = await authHeader();
});

const json = async (res: Response) => res.json();

const createExpense = (body: Record<string, unknown>) =>
  app.request("/api/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify(body),
  });

async function seedMonth() {
  // Two expenses + one income for 2026-03
  await createExpense({
    amount: 1000,
    currency: "ARS",
    description: "Alquiler",
    date: "2026-03-01",
    exchangeRate: 1200,
  });
  await createExpense({
    amount: 500,
    currency: "ARS",
    description: "Comida",
    date: "2026-03-10",
    exchangeRate: 1200,
  });
  await createExpense({
    amount: 50000,
    currency: "ARS",
    description: "Sueldo",
    date: "2026-03-01",
    type: "income",
    exchangeRate: 1200,
  });
}

describe("GET /api/reports/monthly", () => {
  it("returns 400 without month param", async () => {
    const res = await app.request("/api/reports/monthly", { headers: auth });
    expect(res.status).toBe(400);
  });

  it("separates expenses from income in totals", async () => {
    await seedMonth();
    const res = await app.request("/api/reports/monthly?month=2026-03", { headers: auth });
    const body = await json(res);

    // totalArs should only count expenses (1000 + 500 = 1500)
    expect(body.totalArs).toBe(1500);
    expect(body.count).toBe(2);

    // incomeTotalArs should only count income
    expect(body.incomeTotalArs).toBe(50000);
  });

  it("calculates savings = income - expenses", async () => {
    await seedMonth();
    const res = await app.request("/api/reports/monthly?month=2026-03", { headers: auth });
    const body = await json(res);

    expect(body.savingsArs).toBe(50000 - 1500);
  });

  it("byCategory excludes income", async () => {
    await seedMonth();
    const res = await app.request("/api/reports/monthly?month=2026-03", { headers: auth });
    const body = await json(res);

    // byCategory entries should only represent expense amounts
    const categoryTotal = body.byCategory.reduce(
      (sum: number, cat: { totalArs: number }) => sum + cat.totalArs,
      0,
    );
    expect(categoryTotal).toBe(1500);
  });
});

describe("GET /api/reports/breakdown", () => {
  it("returns 400 without month param", async () => {
    const res = await app.request("/api/reports/breakdown", { headers: auth });
    expect(res.status).toBe(400);
  });

  it("excludes income rows", async () => {
    await seedMonth();
    const res = await app.request("/api/reports/breakdown?month=2026-03", { headers: auth });
    const body = await json(res);

    // Total across all breakdown categories should equal expense total only
    const total = body.reduce((sum: number, cat: { totalArs: number }) => sum + cat.totalArs, 0);
    expect(total).toBe(1500);
  });
});

describe("GET /api/reports/trend", () => {
  it("excludes income rows", async () => {
    await seedMonth();
    const res = await app.request("/api/reports/trend", { headers: auth });
    const body = await json(res);

    const march = body.find((m: { month: string }) => m.month === "2026-03");
    expect(march).toBeDefined();
    // totalArs should only be expenses
    expect(Number(march.totalArs)).toBe(1500);
  });
});

describe("GET /api/reports/exchange-rate", () => {
  it("returns a rate from the API", async () => {
    // Mock global fetch for the external API call
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("dolarapi.com")) {
        return new Response(JSON.stringify({ venta: 1250 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input);
    }) as typeof fetch;

    try {
      const res = await app.request("/api/reports/exchange-rate", { headers: auth });
      const body = await json(res);
      expect(body.rate).toBe(1250);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
