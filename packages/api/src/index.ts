import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./config/env.js";
import { categoriesRoutes } from "./routes/categories.js";
import { expensesRoutes } from "./routes/expenses.js";
import { reportsRoutes } from "./routes/reports.js";
import { importRoutes } from "./routes/import.js";
import { rulesRoutes } from "./routes/rules.js";

const app = new Hono();

app.use("*", cors());

app.route("/api/categories", categoriesRoutes);
app.route("/api/expenses", expensesRoutes);
app.route("/api/reports", reportsRoutes);
app.route("/api/import", importRoutes);
app.route("/api/rules", rulesRoutes);

app.get("/api/health", (c) => c.json({ ok: true }));

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API running on http://localhost:${info.port}`);
});
