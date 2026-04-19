const BASE = "/api";

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("auth_token");

  const headers: Record<string, string> = {};

  if (!(options?.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
  });

  if (res.status === 401) {
    localStorage.removeItem("auth_token");
    window.location.href = "/login";
    throw new Error("Session expired");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Request failed");
  }
  return res.json();
}

export function formatARS(amount: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatMoney(amount: number, currency: string = "ARS"): string {
  return currency === "USD" ? formatUSD(amount) : formatARS(amount);
}

export function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export interface SplitwiseStatus {
  connected: boolean;
  groupId: number | null;
  groupName: string | null;
  lastSyncAt: string | null;
}

export interface SplitwiseGroup {
  id: number;
  name: string;
}

export interface SyncResult {
  inserted: number;
  updated: number;
  deleted: number;
  categorized: number;
  exchangeRate: number | null;
}

export function getSplitwiseStatus(): Promise<SplitwiseStatus> {
  return api<SplitwiseStatus>("/splitwise/status");
}

export function getSplitwiseGroups(): Promise<{ groups: SplitwiseGroup[] }> {
  return api<{ groups: SplitwiseGroup[] }>("/splitwise/groups");
}

export function selectSplitwiseGroup(groupId: number, groupName: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>("/splitwise/group", {
    method: "POST",
    body: JSON.stringify({ groupId, groupName }),
  });
}

export function syncSplitwise(): Promise<SyncResult> {
  return api<SyncResult>("/splitwise/sync", { method: "POST" });
}

export function disconnectSplitwise(): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>("/splitwise/disconnect", { method: "POST" });
}

export async function connectSplitwise(): Promise<void> {
  const data = await api<{ url: string }>("/splitwise/connect");
  window.location.href = data.url;
}

// Household API

export interface Household {
  id: string;
  name: string;
  createdAt: string;
}

export interface HouseholdMember {
  id: string;
  name: string;
  email: string;
  picture: string | null;
}

export function getHouseholds(): Promise<Household[]> {
  return api<Household[]>("/households");
}

export function createHousehold(name: string): Promise<Household & { token: string }> {
  return api<Household & { token: string }>("/households", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateHouseholdName(id: string, name: string): Promise<Household> {
  return api<Household>(`/households/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
}

export function switchHousehold(householdId: string): Promise<{ token: string }> {
  return api<{ token: string }>("/households/switch", {
    method: "POST",
    body: JSON.stringify({ householdId }),
  });
}

export function getHouseholdMembers(id: string): Promise<HouseholdMember[]> {
  return api<HouseholdMember[]>(`/households/${id}/members`);
}

export function createInvite(id: string): Promise<{ code: string; expiresAt: string }> {
  return api<{ code: string; expiresAt: string }>(`/households/${id}/invite`, {
    method: "POST",
  });
}

export function joinHousehold(code: string): Promise<{ household: Household; token: string }> {
  return api<{ household: Household; token: string }>("/households/join", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function leaveHousehold(id: string): Promise<{ ok: boolean; token?: string }> {
  return api<{ ok: boolean; token?: string }>(`/households/${id}/leave`, {
    method: "POST",
  });
}
