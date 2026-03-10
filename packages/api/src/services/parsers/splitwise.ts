import { parse } from "csv-parse/sync";
import type { ParsedExpense } from "./visa-galicia.js";

// Map Spanish headers to English
const HEADER_MAP: Record<string, string> = {
  Fecha: "Date",
  Descripción: "Date", // handled below
  Categoría: "Category",
  Coste: "Cost",
  Moneda: "Currency",
};

function normalizeHeaders(
  row: Record<string, string>
): Record<string, string> {
  // Try English first, fall back to Spanish
  return {
    Date: row.Date ?? row.Fecha ?? "",
    Description: row.Description ?? row["Descripción"] ?? "",
    Category: row.Category ?? row["Categoría"] ?? "",
    Cost: row.Cost ?? row.Coste ?? "",
    Currency: row.Currency ?? row.Moneda ?? "",
  };
}

export function parseSplitweiseCSV(content: string): ParsedExpense[] {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const expenses: ParsedExpense[] = [];

  for (const rawRow of records) {
    const row = normalizeHeaders(rawRow);
    const date = row.Date;
    const description = row.Description;
    const cost = parseFloat(row.Cost);
    const currency = (row.Currency || "ARS").toUpperCase();

    if (!date || !description || isNaN(cost) || cost === 0) continue;

    // Skip payment settlements (e.g. "Francisco D. pagó Clara C.")
    const category = row.Category;
    if (category === "Pago" || category === "Payment") continue;

    expenses.push({
      date,
      description,
      amount: Math.abs(cost),
      currency: currency as "ARS" | "USD",
      installment: null,
      isFinancialCharge: false,
      sourceRef: null,
      rawLine: JSON.stringify(rawRow),
    });
  }

  return expenses;
}
