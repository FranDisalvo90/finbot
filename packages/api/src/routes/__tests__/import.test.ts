import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import app from "../../app.js";
import { authHeader } from "../../test/helpers.js";
import { db } from "../../db/client.js";
import { expenses } from "../../db/schema.js";
import { eq } from "drizzle-orm";

let auth: Record<string, string>;

beforeAll(async () => {
  auth = await authHeader();
});

// Build a minimal Splitwise CSV
function buildCSV(rows: { date: string; description: string; amount: number }[]): string {
  const header = "Date,Description,Category,Cost,Currency";
  const lines = rows.map((r) => `${r.date},${r.description},General,${r.amount},ARS`);
  return [header, ...lines].join("\n");
}

function uploadCSV(csv: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const form = new FormData();
  form.append("file", blob, "test.csv");
  return app.request("/api/import/upload", {
    method: "POST",
    body: form,
    headers: auth,
  });
}

async function confirmImport(previewId: string, opts: Record<string, unknown> = {}) {
  return app.request("/api/import/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ previewId, ...opts }),
  });
}

describe("Import duplicate detection", () => {
  beforeEach(async () => {
    // Clean up splitwise expenses for this user
    await db.delete(expenses).where(eq(expenses.source, "splitwise"));
  });

  it("detects duplicates against existing expenses", async () => {
    const csv = buildCSV([
      { date: "2026-01-15", description: "Supermercado", amount: 5000 },
      { date: "2026-01-16", description: "Café", amount: 1500 },
    ]);

    // First upload + confirm to persist expenses
    const res1 = await uploadCSV(csv);
    const data1 = await res1.json();
    expect(data1.duplicates).toEqual([]);
    expect(data1.duplicateCount).toBe(0);

    await confirmImport(data1.previewId);

    // Second upload of the same file — should detect duplicates
    const res2 = await uploadCSV(csv);
    const data2 = await res2.json();
    expect(data2.duplicateCount).toBe(2);
    expect(data2.duplicates).toEqual([0, 1]);
  });

  it("excludes indices on confirm", async () => {
    const csv = buildCSV([
      { date: "2026-02-10", description: "Taxi", amount: 3000 },
      { date: "2026-02-11", description: "Almuerzo", amount: 2000 },
      { date: "2026-02-12", description: "Cena", amount: 4000 },
    ]);

    // Upload and confirm with exclusions
    const uploadRes = await uploadCSV(csv);
    const uploadData = await uploadRes.json();

    const confirmRes = await confirmImport(uploadData.previewId, {
      excludeIndices: [0, 2],
    });
    const confirmData = await confirmRes.json();

    expect(confirmData.total).toBe(1); // Only index 1 inserted
    expect(confirmData.skippedDuplicates).toBe(2);
  });

  it("does not flag same-file duplicates (only persisted ones)", async () => {
    // Two identical rows within the same upload
    const csv = buildCSV([
      { date: "2026-03-01", description: "Igual", amount: 1000 },
      { date: "2026-03-01", description: "Igual", amount: 1000 },
    ]);

    const res = await uploadCSV(csv);
    const data = await res.json();

    // No duplicates because nothing is in the DB yet
    expect(data.duplicates).toEqual([]);
    expect(data.duplicateCount).toBe(0);
  });

  it("matches amount with decimal precision (1234.50 matches DB 1234.50)", async () => {
    const csv = buildCSV([
      { date: "2026-04-01", description: "Preciso", amount: 1234.5 },
    ]);

    // Insert first
    const res1 = await uploadCSV(csv);
    const data1 = await res1.json();
    await confirmImport(data1.previewId);

    // Upload again — 1234.5 should match DB's "1234.50"
    const res2 = await uploadCSV(csv);
    const data2 = await res2.json();
    expect(data2.duplicateCount).toBe(1);
    expect(data2.duplicates).toEqual([0]);
  });
});
