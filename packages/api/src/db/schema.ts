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
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const householdMembers = pgTable("household_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .references(() => households.id)
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("household_members_household_user").on(table.householdId, table.userId),
]);

export const householdInvites = pgTable("household_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .references(() => households.id)
    .notNull(),
  code: text("code").notNull().unique(),
  createdBy: uuid("created_by")
    .references(() => users.id)
    .notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleId: text("google_id").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  picture: text("picture"),
  splitwiseAccessToken: text("splitwise_access_token"),
  splitwiseUserId: integer("splitwise_user_id"),
  splitwiseGroupId: integer("splitwise_group_id"),
  splitwiseGroupName: text("splitwise_group_name"),
  activeHouseholdId: uuid("active_household_id").references(() => households.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").references(() => households.id),
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
  householdId: uuid("household_id").references(() => households.id),
  createdBy: uuid("created_by").references(() => users.id),
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
  householdId: uuid("household_id").references(() => households.id),
  pattern: text("pattern").notNull(),
  categoryId: uuid("category_id")
    .references(() => categories.id)
    .notNull(),
  source: text("source").default("manual").notNull(), // 'manual' | 'learned'
  createdAt: timestamp("created_at").defaultNow(),
});

export const categorizationRulesRelations = relations(categorizationRules, ({ one }) => ({
  category: one(categories, {
    fields: [categorizationRules.categoryId],
    references: [categories.id],
  }),
}));

export const imports = pgTable("imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").references(() => households.id),
  fileName: text("file_name"),
  source: text("source").notNull(), // 'splitwise' | 'visa_galicia'
  month: text("month"),
  expenseCount: integer("expense_count"),
  importedAt: timestamp("imported_at").defaultNow(),
});

export const splitwiseSyncState = pgTable("splitwise_sync_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .references(() => households.id)
    .notNull()
    .unique(),
  lastSyncAt: timestamp("last_sync_at"),
  lastUpdatedAt: timestamp("last_updated_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
