import { describe, expect, it } from "vitest";
import { fetchWithRetry } from "./retryfetch.js";

const res = (status: number) => new Response(null, { status });
const noSleep = async () => {};

/** fetchImpl returning a scripted sequence of responses/errors */
function scripted(seq: (Response | Error)[]) {
  let i = 0;
  const calls = () => i;
  const impl: typeof fetch = async () => {
    const s = seq[Math.min(i++, seq.length - 1)]!;
    if (s instanceof Error) throw s;
    return s.clone();
  };
  return { impl, calls };
}

describe("fetchWithRetry", () => {
  it("honors a caller abort before starting the first attempt", async () => {
    const controller = new AbortController();
    controller.abort(new Error("caller stopped"));
    const { impl, calls } = scripted([res(200)]);

    await expect(
      fetchWithRetry(
        "https://x.test",
        { signal: controller.signal },
        { timeoutMs: 1000, attempts: 2, fetchImpl: impl, sleep: noSleep },
      ),
    ).rejects.toThrow("caller stopped");
    expect(calls()).toBe(0);
  });

  it("retries a 500 and returns the eventual success", async () => {
    const { impl, calls } = scripted([res(500), res(200)]);
    const r = await fetchWithRetry(
      "https://x.test",
      {},
      { timeoutMs: 1000, attempts: 2, fetchImpl: impl, sleep: noSleep },
    );
    expect(r.status).toBe(200);
    expect(calls()).toBe(2);
  });

  it("retries 429", async () => {
    const { impl, calls } = scripted([res(429), res(200)]);
    const r = await fetchWithRetry(
      "https://x.test",
      {},
      { timeoutMs: 1000, attempts: 2, fetchImpl: impl, sleep: noSleep },
    );
    expect(r.status).toBe(200);
    expect(calls()).toBe(2);
  });

  it("does not retry an unsafe method without explicit authorization", async () => {
    const { impl, calls } = scripted([res(503), res(200)]);
    const r = await fetchWithRetry(
      "https://x.test",
      { method: "POST" },
      { timeoutMs: 1000, attempts: 2, fetchImpl: impl, sleep: noSleep },
    );
    expect(r.status).toBe(503);
    expect(calls()).toBe(1);
  });

  it("never retries a definitive 4xx — the caller decides", async () => {
    const { impl, calls } = scripted([res(404), res(200)]);
    const r = await fetchWithRetry(
      "https://x.test",
      {},
      { timeoutMs: 1000, attempts: 3, fetchImpl: impl, sleep: noSleep },
    );
    expect(r.status).toBe(404);
    expect(calls()).toBe(1);
  });

  it("hands back the real response when the retry budget runs out", async () => {
    const { impl, calls } = scripted([res(503), res(503)]);
    const r = await fetchWithRetry(
      "https://x.test",
      {},
      { timeoutMs: 1000, attempts: 2, fetchImpl: impl, sleep: noSleep },
    );
    expect(r.status).toBe(503);
    expect(calls()).toBe(2);
  });

  it("retries thrown network errors, then rethrows the last one", async () => {
    const boom = new Error("socket hang up");
    const { impl, calls } = scripted([boom, boom]);
    await expect(
      fetchWithRetry("https://x.test", {}, {
        timeoutMs: 1000,
        attempts: 2,
        fetchImpl: impl,
        sleep: noSleep,
      }),
    ).rejects.toThrow("socket hang up");
    expect(calls()).toBe(2);
  });

  it("honors Retry-After and disposes a discarded response body", async () => {
    let canceled = 0;
    let calls = 0;
    const slept: number[] = [];
    const first = new Response(
      new ReadableStream({
        cancel() {
          canceled += 1;
        },
      }),
      { status: 429, headers: { "Retry-After": "2" } },
    );
    const impl: typeof fetch = async () => (calls++ === 0 ? first : res(200));

    const response = await fetchWithRetry("https://x.test", {}, {
      timeoutMs: 1000,
      attempts: 2,
      baseDelayMs: 100,
      jitter: 0,
      fetchImpl: impl,
      sleep: async (ms) => void slept.push(ms),
    });

    expect(response.status).toBe(200);
    expect(slept).toEqual([2000]);
    expect(canceled).toBe(1);
  });

  it("allows an explicitly idempotent unsafe request to retry", async () => {
    const { impl, calls } = scripted([res(503), res(200)]);
    const response = await fetchWithRetry(
      "https://x.test",
      { method: "POST", headers: { "Idempotency-Key": "request-1" } },
      {
        timeoutMs: 1000,
        attempts: 2,
        retryUnsafeMethods: true,
        fetchImpl: impl,
        sleep: noSleep,
      },
    );
    expect(response.status).toBe(200);
    expect(calls()).toBe(2);
  });

  it.each([
    ["timeoutMs", { timeoutMs: 0 }],
    ["attempts", { timeoutMs: 1000, attempts: 0 }],
    ["baseDelayMs", { timeoutMs: 1000, baseDelayMs: -1 }],
    ["maxDelayMs", { timeoutMs: 1000, maxDelayMs: -1 }],
    ["jitter", { timeoutMs: 1000, jitter: 1.1 }],
  ])("rejects invalid %s options", async (_label, options) => {
    await expect(
      fetchWithRetry("https://x.test", {}, { ...options, fetchImpl: async () => res(200) }),
    ).rejects.toThrow(RangeError);
  });
});
