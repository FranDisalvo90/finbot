import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import path from "path";
import fs from "fs";
import { authRoutes } from "./routes/auth.js";
import { authMiddleware } from "./middleware/auth.js";
import { categoriesRoutes } from "./routes/categories.js";
import { expensesRoutes } from "./routes/expenses.js";
import { reportsRoutes } from "./routes/reports.js";
import { importRoutes } from "./routes/import.js";
import { rulesRoutes } from "./routes/rules.js";
import { splitwiseRoutes, splitwiseCallbackHandler } from "./routes/splitwise.js";
import { householdsRoutes } from "./routes/households.js";

const app = new Hono();

app.use("*", cors());

// Public routes
app.route("/api/auth", authRoutes);
app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/api/splitwise/callback", splitwiseCallbackHandler);

// Protected routes
app.use("/api/*", authMiddleware);
app.route("/api/categories", categoriesRoutes);
app.route("/api/expenses", expensesRoutes);
app.route("/api/reports", reportsRoutes);
app.route("/api/import", importRoutes);
app.route("/api/rules", rulesRoutes);
app.route("/api/splitwise", splitwiseRoutes);
app.route("/api/households", householdsRoutes);

// Serve dashboard static files in production
// root is relative to CWD (which is /app in Docker)
const dashboardDist = path.resolve(process.cwd(), "packages/dashboard/dist");
if (fs.existsSync(dashboardDist)) {
  app.use("*", serveStatic({ root: "packages/dashboard/dist" }));

  // SPA fallback: serve index.html for non-API routes
  app.get("*", (c) => {
    const html = fs.readFileSync(path.join(dashboardDist, "index.html"), "utf-8");
    return c.html(html);
  });
}

export default app;
