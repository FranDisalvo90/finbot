import { afterEach, beforeEach } from "vitest";
import { db } from "../db/client.js";
import { expenses } from "../db/schema.js";

// Clean up test data before and after each test
// We use a dedicated cleanup approach: delete all expenses and non-seeded data
beforeEach(async () => {
  await db.delete(expenses);
});

afterEach(async () => {
  await db.delete(expenses);
});
