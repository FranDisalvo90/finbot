import { Hono } from "hono";
import { db } from "../db/client.js";
import { expenses, imports, categorizationRules } from "../db/schema.js";
import { eq, isNull, and, inArray } from "drizzle-orm";
import { parseVisaGaliciaPDF } from "../services/parsers/visa-galicia.js";
import { parseSplitweiseCSV } from "../services/parsers/splitwise.js";
import { applyRules, categorizeBatch, applyCategorization } from "../services/categorizer.js";
import type { ParsedExpense } from "../services/parsers/visa-galicia.js";
import { getUserId } from "../middleware/get-user.js";

export const importRoutes = new Hono();

// In-memory store for previews (per-session, simple approach)
const previews = new Map<string, { expenses: ParsedExpense[]; source: string; fileName: string }>();

// Fetch blue dollar sell rate from dolarapi.com
async function fetchBlueRate(): Promise<number | null> {
  try {
    const res = await fetch("https://dolarapi.com/v1/dolares/blue");
    if (!res.ok) return null;
    const data = (await res.json()) as { venta: number };
    return data.venta;
  } catch {
    return null;
  }
}

// POST /upload — parse file, return preview
importRoutes.post("/upload", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return c.json({ error: "No file uploaded" }, 400);

  const fileName = file.name;
  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed: ParsedExpense[];
  let source: string;

  try {
    if (fileName.endsWith(".pdf")) {
      parsed = await parseVisaGaliciaPDF(buffer);
      source = "visa_galicia";
    } else if (fileName.endsWith(".csv")) {
      parsed = parseSplitweiseCSV(buffer.toString("utf-8"));
      source = "splitwise";
    } else {
      return c.json({ error: "Formato no soportado. Usá un archivo PDF o CSV." }, 400);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Parse error";
    return c.json({ error: `Error al parsear el archivo: ${msg}` }, 400);
  }

  if (parsed.length === 0) {
    return c.json({ error: "No se encontraron gastos en el archivo." }, 400);
  }

  // Detect duplicates against already-persisted expenses
  const userId = getUserId(c);
  const parsedDates = [...new Set(parsed.map((e) => e.date))];
  const existing = await db
    .select({
      date: expenses.date,
      amount: expenses.amount,
      description: expenses.description,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.userId, userId),
        eq(expenses.source, source),
        inArray(expenses.date, parsedDates),
      ),
    );

  const existingKeys = new Set(
    existing.map((e) => `${e.date}|${Number(e.amount).toFixed(2)}|${e.description}`),
  );

  const duplicates: number[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const key = `${parsed[i].date}|${parsed[i].amount.toFixed(2)}|${parsed[i].description}`;
    if (existingKeys.has(key)) {
      duplicates.push(i);
    }
  }

  // Extract available months
  const monthSet = new Set(parsed.map((e) => e.date.substring(0, 7)));
  const months = [...monthSet].sort();

  const previewId = crypto.randomUUID();
  previews.set(previewId, { expenses: parsed, source, fileName });

  const exchangeRate = await fetchBlueRate();

  return c.json({
    previewId,
    source,
    fileName,
    months,
    count: parsed.length,
    expenses: parsed,
    exchangeRate,
    duplicates,
    duplicateCount: duplicates.length,
  });
});

// POST /confirm — save preview to DB + categorize
importRoutes.post("/confirm", async (c) => {
  const userId = getUserId(c);
  const { previewId, month, overrideMonth, exchangeRate, excludeIndices } = await c.req.json();
  const preview = previews.get(previewId);
  if (!preview) return c.json({ error: "Preview not found or expired" }, 404);

  const excludeSet = new Set<number>(excludeIndices ?? []);

  // Filter by selected month, tracking original indices
  const indexed = preview.expenses.map((e, i) => ({ expense: e, originalIndex: i }));
  const afterMonth = month
    ? indexed.filter((entry) => entry.expense.date.substring(0, 7) === month)
    : indexed;
  const filtered = afterMonth.filter((entry) => !excludeSet.has(entry.originalIndex));
  const skippedDuplicates = afterMonth.length - filtered.length;

  if (filtered.length === 0 && skippedDuplicates === 0) {
    return c.json({ error: "No hay gastos para el mes seleccionado." }, 400);
  }

  const resolvedMonth =
    overrideMonth ?? month ?? filtered[0]?.expense.date.substring(0, 7) ?? "";

  // Save import record
  const [importRecord] = await db
    .insert(imports)
    .values({
      userId,
      fileName: preview.fileName,
      source: preview.source,
      month: resolvedMonth,
      expenseCount: filtered.length,
    })
    .returning();

  // Insert expenses with dual currency amounts
  const rate = exchangeRate ? Number(exchangeRate) : null;
  const toInsert = filtered.map(({ expense: e }) => {
    const amountArs = rate
      ? e.currency === "ARS"
        ? String(e.amount)
        : String(+(e.amount * rate).toFixed(2))
      : "0";
    const amountUsd = rate
      ? e.currency === "USD"
        ? String(e.amount)
        : String(+(e.amount / rate).toFixed(2))
      : "0";
    return {
      userId,
      amount: String(e.amount),
      currency: e.currency,
      description: e.description,
      source: preview.source,
      sourceRef: e.sourceRef,
      date: e.date,
      month: overrideMonth ?? e.date.substring(0, 7),
      installment: e.installment,
      isFinancialCharge: e.isFinancialCharge,
      amountArs,
      amountUsd,
      exchangeRate: rate ? String(rate) : null,
      rawData: { raw: e.rawLine },
    };
  });

  const inserted =
    toInsert.length > 0
      ? await db.insert(expenses).values(toInsert).returning()
      : [];

  // Apply rules
  const ruleMatches = await applyRules(
    inserted.map((e) => ({ id: e.id, description: e.description })),
    userId,
  );
  const ruleCount = await applyCategorization(ruleMatches);

  // AI categorization for remaining
  const uncategorized = inserted
    .filter((e) => !ruleMatches.has(e.id))
    .map((e) => ({
      id: e.id,
      description: e.description,
      amount: Number(e.amount),
    }));

  const aiResults = await categorizeBatch(uncategorized, userId);
  const aiMap = new Map(aiResults.map((r) => [r.expenseId, r.categoryId]));
  const aiCount = await applyCategorization(aiMap);

  previews.delete(previewId);

  return c.json({
    importId: importRecord.id,
    total: inserted.length,
    categorizedByRules: ruleCount,
    categorizedByAI: aiCount,
    pending: inserted.length - ruleCount - aiCount,
    skippedDuplicates,
  });
});

// POST /categorize/auto — re-run AI on uncategorized
importRoutes.post("/categorize/auto", async (c) => {
  const userId = getUserId(c);
  const uncategorized = await db
    .select()
    .from(expenses)
    .where(and(isNull(expenses.categoryId), eq(expenses.userId, userId)));

  if (uncategorized.length === 0)
    return c.json({ message: "No uncategorized expenses", categorized: 0 });

  const aiResults = await categorizeBatch(
    uncategorized.map((e) => ({
      id: e.id,
      description: e.description,
      amount: Number(e.amount),
    })),
    userId,
  );

  const aiMap = new Map(aiResults.map((r) => [r.expenseId, r.categoryId]));
  const count = await applyCategorization(aiMap);

  return c.json({ categorized: count, total: uncategorized.length });
});

// PUT /categorize/:expenseId — manual categorization + optional rule
importRoutes.put("/categorize/:expenseId", async (c) => {
  const userId = getUserId(c);
  const expenseId = c.req.param("expenseId");
  const { categoryId, createRule } = await c.req.json();

  const [expense] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.userId, userId)));

  if (!expense) return c.json({ error: "Expense not found" }, 404);

  await db.update(expenses).set({ categoryId }).where(eq(expenses.id, expenseId));

  if (createRule) {
    await db.insert(categorizationRules).values({
      userId,
      pattern: expense.description.toLowerCase(),
      categoryId,
      source: "manual",
    });
  }

  return c.json({ ok: true });
});
