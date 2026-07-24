import { describe, expect, it } from "vitest";
import { fetchWithRetry } from "./retryfetch.js";

const res = (status: number) => new Response(null, { status });

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
  it("retries a 500 and returns the eventual success", async () => {
    const { impl, calls } = scripted([res(500), res(200)]);
    const r = await fetchWithRetry("https://x.test", {}, { timeoutMs: 1000, attempts: 2, fetchImpl: impl });
    expect(r.status).toBe(200);
    expect(calls()).toBe(2);
  });

  it("retries 429", async () => {
    const { impl, calls } = scripted([res(429), res(200)]);
    const r = await fetchWithRetry("https://x.test", {}, { timeoutMs: 1000, attempts: 2, fetchImpl: impl });
    expect(r.status).toBe(200);
    expect(calls()).toBe(2);
  });

  it("never retries a definitive 4xx — the caller decides", async () => {
    const { impl, calls } = scripted([res(404), res(200)]);
    const r = await fetchWithRetry("https://x.test", {}, { timeoutMs: 1000, attempts: 3, fetchImpl: impl });
    expect(r.status).toBe(404);
    expect(calls()).toBe(1);
  });

  it("hands back the real response when the retry budget runs out", async () => {
    const { impl, calls } = scripted([res(503), res(503)]);
    const r = await fetchWithRetry("https://x.test", {}, { timeoutMs: 1000, attempts: 2, fetchImpl: impl });
    expect(r.status).toBe(503);
    expect(calls()).toBe(2);
  });

  it("retries thrown network errors, then rethrows the last one", async () => {
    const boom = new Error("socket hang up");
    const { impl, calls } = scripted([boom, boom]);
    await expect(
      fetchWithRetry("https://x.test", {}, { timeoutMs: 1000, attempts: 2, fetchImpl: impl }),
    ).rejects.toThrow("socket hang up");
    expect(calls()).toBe(2);
  });
});
