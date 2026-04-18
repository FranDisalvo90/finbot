const SPLITWISE_BASE = "https://secure.splitwise.com/api/v3.0";

export class SplitwiseAuthError extends Error {
  constructor() {
    super("Splitwise token expired or revoked");
    this.name = "SplitwiseAuthError";
  }
}

export async function splitwiseFetch<T>(
  path: string,
  accessToken: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${SPLITWISE_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401) throw new SplitwiseAuthError();
  if (!res.ok) throw new Error(`Splitwise API error: ${res.status}`);

  return res.json() as Promise<T>;
}
