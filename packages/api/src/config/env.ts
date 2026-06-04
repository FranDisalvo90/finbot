import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

// Fail fast: never sign/verify JWTs with a missing or default secret (SEC-001).
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET === "change-me-in-production") {
  throw new Error(
    "JWT_SECRET must be set to a strong secret of at least 32 characters. " +
      "Refusing to start with a missing or default signing secret.",
  );
}

export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/finbot",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
  PORT: Number(process.env.PORT ?? 3001),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
  JWT_SECRET,
  SPLITWISE_CLIENT_ID: process.env.SPLITWISE_CLIENT_ID ?? "",
  SPLITWISE_CLIENT_SECRET: process.env.SPLITWISE_CLIENT_SECRET ?? "",
  SPLITWISE_REDIRECT_URI: process.env.SPLITWISE_REDIRECT_URI ?? "http://localhost:3001/api/splitwise/callback",
};
