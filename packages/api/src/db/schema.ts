import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  decimal,
  boolean,
  jsonb,
  date,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  emoji: text("emoji"),
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "parentChild",
  }),
  children: many(categories, { relationName: "parentChild" }),
  expenses: many(expenses),
  rules: many(categorizationRules),
}));

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").default("ARS").notNull(),
  description: text("description").notNull(),
  categoryId: uuid("category_id").references(() => categories.id),
  type: text("type").notNull().default("expense"), // 'expense' | 'income'
  source: text("source").notNull(), // 'splitwise' | 'visa_galicia' | 'manual'
  sourceRef: text("source_ref"),
  date: date("date").notNull(),
  month: text("month").notNull(), // 'YYYY-MM'
  installment: text("installment"),
  isFinancialCharge: boolean("is_financial_charge").default(false),
  amountArs: decimal("amount_ars", { precision: 12, scale: 2 }).notNull().default("0"),
  amountUsd: decimal("amount_usd", { precision: 12, scale: 2 }).notNull().default("0"),
  exchangeRate: decimal("exchange_rate", { precision: 10, scale: 2 }),
  rawData: jsonb("raw_data"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const expensesRelations = relations(expenses, ({ one }) => ({
  category: one(categories, {
    fields: [expenses.categoryId],
    references: [categories.id],
  }),
}));

export const categorizationRules = pgTable("categorization_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  pattern: text("pattern").notNull(),
  categoryId: uuid("category_id")
    .references(() => categories.id)
    .notNull(),
  source: text("source").default("manual").notNull(), // 'manual' | 'learned'
  createdAt: timestamp("created_at").defaultNow(),
});

export const categorizationRulesRelations = relations(
  categorizationRules,
  ({ one }) => ({
    category: one(categories, {
      fields: [categorizationRules.categoryId],
      references: [categories.id],
    }),
  })
);

export const imports = pgTable("imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileName: text("file_name"),
  source: text("source").notNull(), // 'splitwise' | 'visa_galicia'
  month: text("month"),
  expenseCount: integer("expense_count"),
  importedAt: timestamp("imported_at").defaultNow(),
});
