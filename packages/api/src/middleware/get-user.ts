import type { Context } from "hono";

export function getUserId(c: Context): string {
  const payload = c.get("jwtPayload") as { sub: string };
  return payload.sub;
}
