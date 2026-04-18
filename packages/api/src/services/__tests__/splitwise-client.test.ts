import { describe, it, expect, vi, beforeEach } from "vitest";
import { splitwiseFetch, SplitwiseAuthError } from "../splitwise-client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("splitwiseFetch", () => {
  it("sends GET with Bearer token and returns JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ expenses: [] }),
    });

    const result = await splitwiseFetch<{ expenses: [] }>("/get_expenses", "my-token", {
      limit: "10",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://secure.splitwise.com/api/v3.0/get_expenses?limit=10");
    expect(opts.headers.Authorization).toBe("Bearer my-token");
    expect(result).toEqual({ expenses: [] });
  });

  it("throws SplitwiseAuthError on 401", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(splitwiseFetch("/get_expenses", "bad-token")).rejects.toThrow(SplitwiseAuthError);
  });

  it("throws generic error on non-401 failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(splitwiseFetch("/get_expenses", "token")).rejects.toThrow("Splitwise API error: 500");
  });

  it("retries on 429 and succeeds on next attempt", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ expenses: [] }),
      });

    const result = await splitwiseFetch<{ expenses: [] }>("/get_expenses", "token");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ expenses: [] });
  });

  it("throws after max retries on persistent 429", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 });

    await expect(splitwiseFetch("/get_expenses", "token")).rejects.toThrow("429 (max retries exceeded)");
    expect(mockFetch).toHaveBeenCalledTimes(4); // initial + 3 retries
  });
});
