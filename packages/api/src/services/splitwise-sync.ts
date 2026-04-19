import { db } from "../db/client.js";
import { expenses, users, splitwiseSyncState } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { splitwiseFetch } from "./splitwise-client.js";
import { fetchBlueRate } from "./exchange-rate.js";
import { computeDualAmounts } from "./currency.js";
import { applyRules, categorizeBatch, applyCategorization } from "./categorizer.js";
import type { ParsedExpense } from "./parsers/visa-galicia.js";

export interface SplitwiseExpense {
  id: number;
  description: string;
  cost: string;
  currency_code: string;
  date: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  payment: boolean;
  users: {
    user_id: number;
    paid_share: string;
    owed_share: string;
    net_balance: string;
  }[];
}

export function mapSplitwiseExpenses(raw: SplitwiseExpense[]): ParsedExpense[] {
  return raw
    .filter((e) => !e.payment && !e.deleted_at)
    .map((e) => ({
      date: e.date.substring(0, 10),
      description: e.description,
      amount: parseFloat(e.cost),
      currency: e.currency_code as "ARS" | "USD",
      installment: null,
      isFinancialCharge: false,
      sourceRef: String(e.id),
      rawLine: JSON.stringify(e),
    }));
}

export function getDeletedExpenseIds(raw: SplitwiseExpense[]): string[] {
  return raw.filter((e) => e.deleted_at !== null).map((e) => String(e.id));
}

async function fetchAllExpenses(
  accessToken: string,
  groupId: number,
  updatedAfter: string | null,
): Promise<SplitwiseExpense[]> {
  const all: SplitwiseExpense[] = [];
  let offset = 0;
  const limit = 100;

  const params: Record<string, string> = {
    group_id: String(groupId),
    limit: String(limit),
  };

  if (updatedAfter) {
    params.updated_after = updatedAfter;
  } else {
    // First sync: fetch last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    params.dated_after = sixMonthsAgo.toISOString();
  }

  while (true) {
    params.offset = String(offset);
    const data = await splitwiseFetch<{ expenses: SplitwiseExpense[] }>(
      "/get_expenses",
      accessToken,
      params,
    );

    if (data.expenses.length === 0) break;
    all.push(...data.expenses);

    if (data.expenses.length < limit) break;
    offset += limit;
  }

  return all;
}

export interface SyncResult {
  inserted: number;
  updated: number;
  deleted: number;
  categorized: number;
  exchangeRate: number | null;
}

export async function syncSplitwiseExpenses(userId: string, householdId: string): Promise<SyncResult> {
  // 1. Read user's Splitwise config
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.splitwiseAccessToken || !user?.splitwiseGroupId) {
    throw new Error("Splitwise not connected or no group selected");
  }

  // 2. Read sync cursor
  const [syncState] = await db
    .select()
    .from(splitwiseSyncState)
    .where(eq(splitwiseSyncState.householdId, householdId));

  const cursor = syncState?.lastUpdatedAt?.toISOString() ?? null;

  // 3. Fetch expenses from Splitwise API
  const rawExpenses = await fetchAllExpenses(
    user.splitwiseAccessToken,
    user.splitwiseGroupId,
    cursor,
  );

  if (rawExpenses.length === 0) {
    return { inserted: 0, updated: 0, deleted: 0, categorized: 0, exchangeRate: null };
  }

  // 4. Map active expenses to ParsedExpense[]
  const parsed = mapSplitwiseExpenses(rawExpenses);
  const deletedIds = getDeletedExpenseIds(rawExpenses);

  // 5. Fetch exchange rate
  const rate = await fetchBlueRate();

  // 6. Dedup against DB via sourceRef
  const allSourceRefs = parsed.map((p) => p.sourceRef!);
  const existingExpenses =
    allSourceRefs.length > 0
      ? await db
          .select()
          .from(expenses)
          .where(
            and(
              eq(expenses.householdId, householdId),
              eq(expenses.source, "splitwise"),
              inArray(expenses.sourceRef, allSourceRefs),
            ),
          )
      : [];

  const existingByRef = new Map(existingExpenses.map((e) => [e.sourceRef, e]));

  // 7. Insert new, update changed
  const toInsert: (typeof expenses.$inferInsert)[] = [];
  const updatePromises: Promise<unknown>[] = [];

  for (const p of parsed) {
    const existing = existingByRef.get(p.sourceRef!);
    const { amountArs, amountUsd } = computeDualAmounts(p.amount, p.currency, rate);

    if (existing) {
      if (
        Number(existing.amount) !== p.amount ||
        existing.description !== p.description ||
        existing.date !== p.date
      ) {
        updatePromises.push(
          db
            .update(expenses)
            .set({
              amount: String(p.amount),
              description: p.description,
              date: p.date,
              month: p.date.substring(0, 7),
              currency: p.currency,
              amountArs,
              amountUsd,
              exchangeRate: rate ? String(rate) : null,
              rawData: { raw: p.rawLine },
            })
            .where(eq(expenses.id, existing.id)),
        );
      }
    } else {
      toInsert.push({
        householdId,
        createdBy: userId,
        amount: String(p.amount),
        currency: p.currency,
        description: p.description,
        source: "splitwise",
        sourceRef: p.sourceRef,
        date: p.date,
        month: p.date.substring(0, 7),
        installment: null,
        isFinancialCharge: false,
        amountArs,
        amountUsd,
        exchangeRate: rate ? String(rate) : null,
        rawData: { raw: p.rawLine },
      });
    }
  }

  const insertedRows =
    toInsert.length > 0
      ? await db.insert(expenses).values(toInsert).returning()
      : [];
  await Promise.all(updatePromises);

  const inserted = insertedRows.length;
  const updated = updatePromises.length;

  // 8. Handle deletions
  let deletedCount = 0;
  if (deletedIds.length > 0) {
    const deleteResult = await db
      .delete(expenses)
      .where(
        and(
          eq(expenses.householdId, householdId),
          eq(expenses.source, "splitwise"),
          inArray(expenses.sourceRef, deletedIds),
        ),
      )
      .returning();
    deletedCount = deleteResult.length;
  }

  // 9. Update sync cursor
  const maxUpdatedAt = rawExpenses.reduce((max, e) => {
    const t = new Date(e.updated_at).getTime();
    return t > max ? t : max;
  }, 0);

  if (syncState) {
    await db
      .update(splitwiseSyncState)
      .set({
        lastSyncAt: new Date(),
        lastUpdatedAt: new Date(maxUpdatedAt),
      })
      .where(eq(splitwiseSyncState.householdId, householdId));
  } else {
    await db.insert(splitwiseSyncState).values({
      householdId,
      lastSyncAt: new Date(),
      lastUpdatedAt: new Date(maxUpdatedAt),
    });
  }

  // 10. Categorize newly inserted expenses
  let categorized = 0;
  if (insertedRows.length > 0) {
    const ruleMatches = await applyRules(
      insertedRows.map((e) => ({ id: e.id, description: e.description })),
      householdId,
    );
    const ruleCount = await applyCategorization(ruleMatches);

    const uncategorized = insertedRows
      .filter((e) => !ruleMatches.has(e.id))
      .map((e) => ({ id: e.id, description: e.description, amount: Number(e.amount) }));

    const aiResults = await categorizeBatch(uncategorized, householdId);
    const aiMap = new Map(aiResults.map((r) => [r.expenseId, r.categoryId]));
    const aiCount = await applyCategorization(aiMap);

    categorized = ruleCount + aiCount;
  }

  return { inserted, updated, deleted: deletedCount, categorized, exchangeRate: rate };
}
