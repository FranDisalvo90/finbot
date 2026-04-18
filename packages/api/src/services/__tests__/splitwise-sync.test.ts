import { describe, it, expect } from "vitest";
import {
  mapSplitwiseExpenses,
  getDeletedExpenseIds,
  type SplitwiseExpense,
} from "../splitwise-sync.js";

describe("mapSplitwiseExpenses", () => {
  it("maps a regular expense to ParsedExpense using total cost", () => {
    const expense: SplitwiseExpense = {
      id: 123,
      description: "Supermercado",
      cost: "15000.50",
      currency_code: "ARS",
      date: "2026-04-10T14:30:00Z",
      created_at: "2026-04-10T14:30:00Z",
      updated_at: "2026-04-10T14:30:00Z",
      deleted_at: null,
      payment: false,
      users: [
        { user_id: 1, paid_share: "15000.50", owed_share: "7500.25", net_balance: "-7500.25" },
        { user_id: 2, paid_share: "0.0", owed_share: "7500.25", net_balance: "7500.25" },
      ],
    };

    const result = mapSplitwiseExpenses([expense]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      date: "2026-04-10",
      description: "Supermercado",
      amount: 15000.50,
      currency: "ARS",
      installment: null,
      isFinancialCharge: false,
      sourceRef: "123",
      rawLine: JSON.stringify(expense),
    });
  });

  it("filters out payment expenses", () => {
    const payment: SplitwiseExpense = {
      id: 456,
      description: "Payment",
      cost: "5000.00",
      currency_code: "ARS",
      date: "2026-04-11T10:00:00Z",
      created_at: "2026-04-11T10:00:00Z",
      updated_at: "2026-04-11T10:00:00Z",
      deleted_at: null,
      payment: true,
      users: [],
    };

    const result = mapSplitwiseExpenses([payment]);
    expect(result).toHaveLength(0);
  });

  it("filters out deleted expenses", () => {
    const deleted: SplitwiseExpense = {
      id: 789,
      description: "Deleted",
      cost: "1000.00",
      currency_code: "ARS",
      date: "2026-04-12T10:00:00Z",
      created_at: "2026-04-12T10:00:00Z",
      updated_at: "2026-04-12T10:00:00Z",
      deleted_at: "2026-04-12T12:00:00Z",
      payment: false,
      users: [],
    };

    const result = mapSplitwiseExpenses([deleted]);
    expect(result).toHaveLength(0);
  });

  it("handles USD currency", () => {
    const usdExpense: SplitwiseExpense = {
      id: 101,
      description: "Netflix",
      cost: "15.99",
      currency_code: "USD",
      date: "2026-04-01T00:00:00Z",
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
      deleted_at: null,
      payment: false,
      users: [],
    };

    const result = mapSplitwiseExpenses([usdExpense]);
    expect(result).toHaveLength(1);
    expect(result[0].currency).toBe("USD");
    expect(result[0].amount).toBe(15.99);
  });
});

describe("getDeletedExpenseIds", () => {
  it("extracts IDs of deleted expenses", () => {
    const expenses: SplitwiseExpense[] = [
      {
        id: 1, description: "Active", cost: "100", currency_code: "ARS",
        date: "2026-04-01T00:00:00Z", created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z", deleted_at: null, payment: false, users: [],
      },
      {
        id: 2, description: "Deleted", cost: "200", currency_code: "ARS",
        date: "2026-04-01T00:00:00Z", created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z", deleted_at: "2026-04-02T00:00:00Z", payment: false, users: [],
      },
    ];

    const deleted = getDeletedExpenseIds(expenses);
    expect(deleted).toEqual(["2"]);
  });
});
