import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/finbot",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
  PORT: Number(process.env.PORT ?? 3001),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
  JWT_SECRET: process.env.JWT_SECRET ?? "change-me-in-production",
  SPLITWISE_CLIENT_ID: process.env.SPLITWISE_CLIENT_ID ?? "",
  SPLITWISE_CLIENT_SECRET: process.env.SPLITWISE_CLIENT_SECRET ?? "",
  SPLITWISE_REDIRECT_URI: process.env.SPLITWISE_REDIRECT_URI ?? "http://localhost:3001/api/splitwise/callback",
};
