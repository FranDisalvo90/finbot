import { describe, it, expect, beforeAll } from "vitest";
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

describe("POST /api/expenses", () => {
  it("creates an expense with default type='expense'", async () => {
    const res = await createExpense({
      amount: 1500,
      currency: "ARS",
      description: "Café",
      date: "2026-03-01",
    });

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.type).toBe("expense");
    expect(body.source).toBe("manual");
    expect(body.description).toBe("Café");
    expect(body.month).toBe("2026-03");
  });

  it("creates income with type='income'", async () => {
    const res = await createExpense({
      amount: 500000,
      currency: "ARS",
      description: "Sueldo",
      date: "2026-03-01",
      type: "income",
    });

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.type).toBe("income");
  });

  it("computes amountArs and amountUsd from ARS amount + exchangeRate", async () => {
    const res = await createExpense({
      amount: 12000,
      currency: "ARS",
      description: "Supermercado",
      date: "2026-03-05",
      exchangeRate: 1200,
    });

    const body = await json(res);
    expect(Number(body.amountArs)).toBe(12000);
    expect(Number(body.amountUsd)).toBe(10); // 12000 / 1200
    expect(Number(body.exchangeRate)).toBe(1200);
  });

  it("computes amountArs and amountUsd from USD amount + exchangeRate", async () => {
    const res = await createExpense({
      amount: 50,
      currency: "USD",
      description: "Subscription",
      date: "2026-03-10",
      exchangeRate: 1200,
    });

    const body = await json(res);
    expect(Number(body.amountUsd)).toBe(50);
    expect(Number(body.amountArs)).toBe(60000); // 50 * 1200
  });
});

describe("GET /api/expenses", () => {
  it("returns expenses for a given month", async () => {
    await createExpense({
      amount: 100,
      currency: "ARS",
      description: "Marzo",
      date: "2026-03-01",
    });
    await createExpense({
      amount: 200,
      currency: "ARS",
      description: "Febrero",
      date: "2026-02-15",
    });

    const res = await app.request("/api/expenses?month=2026-03", { headers: auth });
    expect(res.status).toBe(200);
    const body = await json(res);

    expect(body).toHaveLength(1);
    expect(body[0].description).toBe("Marzo");
  });

  it("returns all expenses when no month filter", async () => {
    await createExpense({
      amount: 100,
      currency: "ARS",
      description: "Expense 1",
      date: "2026-03-01",
    });
    await createExpense({
      amount: 200,
      currency: "ARS",
      description: "Expense 2",
      date: "2026-02-15",
    });

    const res = await app.request("/api/expenses", { headers: auth });
    const body = await json(res);
    expect(body).toHaveLength(2);
  });
});
