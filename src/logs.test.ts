import { describe, expect, it } from "vitest";
import { getLogsPaged } from "./logs.js";

const noSleep = async () => {};

describe("getLogsPaged", () => {
  it("collects every log across chunks, in order", async () => {
    const ranges: [bigint, bigint][] = [];
    const logs = await getLogsPaged(
      async (from, to) => {
        ranges.push([from, to]);
        return [Number(from)];
      },
      0n,
      25n,
      { chunkSize: 10n, sleep: noSleep },
    );
    expect(ranges).toEqual([[0n, 9n], [10n, 19n], [20n, 25n]]);
    expect(logs).toEqual([0, 10, 20]);
  });

  it("halves the span on a size error and still covers the full range", async () => {
    const served: [bigint, bigint][] = [];
    await getLogsPaged(
      async (from, to) => {
        if (to - from > 5n) throw new Error("logs matched by query exceeds limit of 10000");
        served.push([from, to]);
        return [];
      },
      0n,
      20n,
      { chunkSize: 20n, minChunk: 1n, sleep: noSleep },
    );
    // every successful window is small, and together they tile [0, 20]
    expect(served[0]![0]).toBe(0n);
    expect(served[served.length - 1]![1]).toBe(20n);
    for (let i = 1; i < served.length; i++) expect(served[i]![0]).toBe(served[i - 1]![1] + 1n);
    for (const [f, t] of served) expect(t - f).toBeLessThanOrEqual(5n);
  });

  it("a 429 cools off and retries the SAME span (never halves)", async () => {
    let calls = 0;
    const slept: number[] = [];
    const spans: bigint[] = [];
    await getLogsPaged(
      async (from, to) => {
        spans.push(to - from);
        if (calls++ === 0) throw new Error("HTTP 429");
        return [];
      },
      0n,
      9n,
      { chunkSize: 10n, cooldownMs: 123, sleep: async (ms) => void slept.push(ms) },
    );
    expect(slept).toEqual([123]);
    expect(spans).toEqual([9n, 9n]); // same window retried at full size
  });

  it("re-grows only after the clean-pass streak, back up to the cap", async () => {
    const spans: bigint[] = [];
    let failed = false;
    await getLogsPaged(
      async (from, to) => {
        if (!failed && to - from > 4n) {
          failed = true;
          throw new Error("range too large");
        }
        spans.push(to - from);
        return [];
      },
      0n,
      100n,
      { chunkSize: 8n, minChunk: 1n, regrowAfter: 3, sleep: noSleep },
    );
    // after halving to 4, three clean passes must complete before span doubles
    const firstBig = spans.findIndex((s) => s > 4n);
    expect(firstBig).toBeGreaterThanOrEqual(3);
    expect(Math.max(...spans.map(Number))).toBeLessThanOrEqual(8);
  });

  it("rethrows once the span floor is hit", async () => {
    await expect(
      getLogsPaged(
        async () => {
          throw new Error("range too large");
        },
        0n,
        100n,
        { chunkSize: 4n, minChunk: 4n, sleep: noSleep },
      ),
    ).rejects.toThrow("range too large");
  });

  it("streams via onPage with collect: false", async () => {
    const pages: number[][] = [];
    const out = await getLogsPaged(
      async (from) => [Number(from)],
      0n,
      15n,
      { chunkSize: 10n, collect: false, onPage: (l) => void pages.push(l), sleep: noSleep },
    );
    expect(out).toEqual([]);
    expect(pages).toEqual([[0], [10]]);
  });

  it("does not retry or duplicate a page when the consumer callback fails", async () => {
    let calls = 0;
    await expect(
      getLogsPaged(
        async () => {
          calls += 1;
          return [42];
        },
        0n,
        0n,
        {
          chunkSize: 4n,
          minChunk: 1n,
          sleep: noSleep,
          onPage: async () => {
            throw new Error("sink failed");
          },
        },
      ),
    ).rejects.toThrow("sink failed");
    expect(calls).toBe(1);
  });

  it("rethrows fatal errors without shrinking the requested range", async () => {
    const ranges: [bigint, bigint][] = [];
    await expect(
      getLogsPaged(
        async (from, to) => {
          ranges.push([from, to]);
          throw new Error("401 unauthorized");
        },
        0n,
        20n,
        { chunkSize: 8n, minChunk: 2n, sleep: noSleep },
      ),
    ).rejects.toThrow("401 unauthorized");
    expect(ranges).toEqual([[0n, 7n]]);
  });

  it("does not mistake an invalid block-range query for a provider size limit", async () => {
    const ranges: [bigint, bigint][] = [];
    await expect(
      getLogsPaged(
        async (from, to) => {
          ranges.push([from, to]);
          throw new Error("invalid block range parameters");
        },
        0n,
        20n,
        { chunkSize: 8n, minChunk: 1n, sleep: noSleep },
      ),
    ).rejects.toThrow("invalid block range parameters");
    expect(ranges).toEqual([[0n, 7n]]);
  });

  it("stops retrying a rate-limited page when its retry budget is exhausted", async () => {
    let calls = 0;
    await expect(
      getLogsPaged(
        async () => {
          calls += 1;
          if (calls <= 2) throw new Error("HTTP 429");
          return [];
        },
        0n,
        0n,
        { maxRetries: 1, sleep: noSleep },
      ),
    ).rejects.toThrow("HTTP 429");
    expect(calls).toBe(2);
  });

  it("honors an already-aborted signal before requesting a page", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    let calls = 0;
    await expect(
      getLogsPaged(
        async () => {
          calls += 1;
          return [];
        },
        0n,
        0n,
        { signal: controller.signal, sleep: noSleep },
      ),
    ).rejects.toThrow("stop");
    expect(calls).toBe(0);
  });

  it.each([
    ["chunkSize", { chunkSize: 0n }],
    ["minChunk", { minChunk: 0n }],
    ["minimum greater than maximum", { chunkSize: 4n, minChunk: 5n }],
    ["regrowAfter", { regrowAfter: 0 }],
    ["cooldownMs", { cooldownMs: -1 }],
    ["maxRetries", { maxRetries: -1 }],
  ])("rejects invalid %s options", async (_label, options) => {
    await expect(
      getLogsPaged(async () => [], 1n, 0n, { ...options, sleep: noSleep }),
    ).rejects.toThrow(RangeError);
  });

  it("rejects negative absolute block ranges", async () => {
    await expect(getLogsPaged(async () => [], -1n, 0n, { sleep: noSleep })).rejects.toThrow(
      RangeError,
    );
  });
});
