const SPLITWISE_BASE = "https://secure.splitwise.com/api/v3.0";

export class SplitwiseAuthError extends Error {
  constructor() {
    super("Splitwise token expired or revoked");
    this.name = "SplitwiseAuthError";
  }
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = process.env.NODE_ENV === "test" ? 1 : 1000;

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

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 401) throw new SplitwiseAuthError();

    if (res.status === 429) {
      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * RETRY_BASE_MS;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw new Error("Splitwise API error: 429 (max retries exceeded)");
    }

    if (!res.ok) throw new Error(`Splitwise API error: ${res.status}`);

    return res.json() as Promise<T>;
  }

  throw new Error("Splitwise API error: unreachable");
}
