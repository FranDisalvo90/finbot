import type { Context } from "hono";

interface JwtPayload {
  sub: string;
  householdId: string;
}

export function getUserId(c: Context): string {
  const payload = c.get("jwtPayload") as JwtPayload;
  return payload.sub;
}

export function getHouseholdId(c: Context): string {
  const payload = c.get("jwtPayload") as JwtPayload;
  return payload.householdId;
}
