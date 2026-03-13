import { jwt } from "hono/jwt";
import { env } from "../config/env.js";

export const authMiddleware = jwt({ secret: env.JWT_SECRET, alg: "HS256" });
