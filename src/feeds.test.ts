import { describe, expect, it } from "vitest";
import {
  CHAINLINK_AGGREGATOR_V3_ABI,
  assessOracleHealth,
  findChainlinkFeedByAddress,
  findChainlinkFeeds,
  formatChainlinkAnswer,
  getChainlinkRoundDataCalls,
  loadChainlinkFeedDirectory,
  normalizeChainlinkRoundData,
  parseChainlinkFeedDirectory,
} from "./feeds.js";

const directoryRow = {
  name: "Robinhood GOOGL / USD",
  proxyAddress: "0xF6f373a037c30F0e5010d854385cA89185AE638b",
  secondaryProxyAddress: "0xA04EE5c4c8827F17e82f93bE9e19DeA221A749a8",
  heartbeat: 86_400,
  decimals: 8,
  path: "robinhood-googl-usd-shared-svr",
  assetName: "Alphabet (Robinhood Tokenized Equity)",
  feedCategory: "low",
  docs: {
    assetClass: "Equity",
    baseAsset: "GOOGL",
    quoteAsset: "USD",
    marketHours: "us_equities_24/5",
    productTypeCode: "primaryTokenizedPrice",
  },
};

describe("parseChainlinkFeedDirectory", () => {
  it("normalizes the stable feed metadata used by Oracle Guard", () => {
    expect(parseChainlinkFeedDirectory([directoryRow])).toEqual([
      {
        name: "Robinhood GOOGL / USD",
        proxyAddress: "0xF6f373a037c30F0e5010d854385cA89185AE638b",
        secondaryProxyAddress: "0xA04EE5c4c8827F17e82f93bE9e19DeA221A749a8",
        heartbeatSeconds: 86_400,
        decimals: 8,
        path: "robinhood-googl-usd-shared-svr",
        assetName: "Alphabet (Robinhood Tokenized Equity)",
        feedCategory: "low",
        assetClass: "Equity",
        baseAsset: "GOOGL",
        quoteAsset: "USD",
        marketHours: "us_equities_24/5",
        productTypeCode: "primaryTokenizedPrice",
      },
    ]);
  });

  it.each([
    ["non-array", {}],
    ["empty array", []],
    ["missing address", [{ ...directoryRow, proxyAddress: undefined }]],
    ["invalid heartbeat", [{ ...directoryRow, heartbeat: 0 }]],
    ["invalid decimals", [{ ...directoryRow, decimals: 256 }]],
    ["invalid docs", [{ ...directoryRow, docs: "not-an-object" }]],
  ])("rejects a malformed %s response atomically", (_label, value) => {
    expect(() => parseChainlinkFeedDirectory(value)).toThrow(TypeError);
  });

  it.each([
    ["secondaryProxyAddress", { ...directoryRow, secondaryProxyAddress: 42 }],
    ["path", { ...directoryRow, path: 42 }],
    ["assetName", { ...directoryRow, assetName: 42 }],
    ["feedCategory", { ...directoryRow, feedCategory: 42 }],
    ["docs.assetClass", { ...directoryRow, docs: { ...directoryRow.docs, assetClass: 42 } }],
    ["docs.baseAsset", { ...directoryRow, docs: { ...directoryRow.docs, baseAsset: 42 } }],
    ["docs.quoteAsset", { ...directoryRow, docs: { ...directoryRow.docs, quoteAsset: 42 } }],
    ["docs.marketHours", { ...directoryRow, docs: { ...directoryRow.docs, marketHours: 42 } }],
    [
      "docs.productTypeCode",
      { ...directoryRow, docs: { ...directoryRow.docs, productTypeCode: 42 } },
    ],
  ])("rejects a wrong-typed optional %s field", (_label, row) => {
    expect(() => parseChainlinkFeedDirectory([row])).toThrow(TypeError);
  });

  it("rejects duplicate proxy addresses case-insensitively", () => {
    expect(() =>
      parseChainlinkFeedDirectory([
        directoryRow,
        { ...directoryRow, proxyAddress: directoryRow.proxyAddress.toLowerCase() },
      ]),
    ).toThrow(/duplicate/i);
  });

  it("rejects collisions between primary and secondary proxy addresses", () => {
    expect(() =>
      parseChainlinkFeedDirectory([
        directoryRow,
        {
          ...directoryRow,
          proxyAddress: directoryRow.secondaryProxyAddress,
          secondaryProxyAddress: "0x0000000000000000000000000000000000000001",
        },
      ]),
    ).toThrow(/duplicate/i);
  });
});

describe("loadChainlinkFeedDirectory", () => {
  it("loads through the injected fetch boundary and validates before returning", async () => {
    const feeds = await loadChainlinkFeedDirectory({
      fetchImpl: async () =>
        new Response(JSON.stringify([directoryRow]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      sleep: async () => {},
    });
    expect(feeds).toHaveLength(1);
    expect(feeds[0]).toMatchObject({ baseAsset: "GOOGL", heartbeatSeconds: 86_400 });
  });

  it("rejects definitive HTTP failures with the status", async () => {
    await expect(
      loadChainlinkFeedDirectory({
        fetchImpl: async () => new Response(null, { status: 404 }),
        sleep: async () => {},
      }),
    ).rejects.toThrow("HTTP 404");
  });
});

describe("loadChainlinkFeedDirectory — integrity", () => {
  /**
   * Schema validation proves SHAPE, not authorship. A hijacked mirror can
   * serve a perfectly-shaped directory pointing every feed at addresses it
   * chose, and every assertion in the parser would pass.
   */
  const body = JSON.stringify([directoryRow]);
  const serve = () =>
    async () =>
      new Response(body, { status: 200, headers: { "content-type": "application/json" } });

  const digestOf = async (text: string) => {
    const bytes = new TextEncoder().encode(text);
    const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  it("accepts a body whose digest matches the pin", async () => {
    const feeds = await loadChainlinkFeedDirectory({
      fetchImpl: serve(),
      sleep: async () => {},
      expectedSha256: await digestOf(body),
    });
    expect(feeds).toHaveLength(1);
    expect(feeds[0]).toMatchObject({ baseAsset: "GOOGL" });
  });

  it("refuses a well-formed document that is not the pinned one", async () => {
    // the attack this exists for: valid schema, attacker-chosen addresses
    const swapped = JSON.stringify([
      { ...directoryRow, proxyAddress: "0x000000000000000000000000000000000000dEaD" },
    ]);
    await expect(
      loadChainlinkFeedDirectory({
        fetchImpl: async () => new Response(swapped, { status: 200 }),
        sleep: async () => {},
        expectedSha256: await digestOf(body),
      }),
    ).rejects.toThrow(/integrity check failed/i);
  });

  it("names both digests so the mismatch can be investigated", async () => {
    const expected = await digestOf(body);
    await expect(
      loadChainlinkFeedDirectory({
        fetchImpl: async () => new Response(JSON.stringify([]), { status: 200 }),
        sleep: async () => {},
        expectedSha256: expected,
      }),
    ).rejects.toThrow(new RegExp(expected));
  });

  it("is case-insensitive about the pin's hex", async () => {
    const feeds = await loadChainlinkFeedDirectory({
      fetchImpl: serve(),
      sleep: async () => {},
      expectedSha256: (await digestOf(body)).toUpperCase(),
    });
    expect(feeds).toHaveLength(1);
  });

  it("rejects a malformed digest before making any request", async () => {
    let called = false;
    await expect(
      loadChainlinkFeedDirectory({
        fetchImpl: async () => {
          called = true;
          return new Response(body, { status: 200 });
        },
        expectedSha256: "not-a-digest",
      }),
    ).rejects.toThrow(TypeError);
    expect(called).toBe(false);
  });

  it("leaves the unpinned path untouched", async () => {
    // pinning is opt-in; the default must stay a plain validated load
    const feeds = await loadChainlinkFeedDirectory({ fetchImpl: serve(), sleep: async () => {} });
    expect(feeds).toHaveLength(1);
  });
});

describe("feed lookup and ABI", () => {
  it("looks up proxy and secondary addresses case-insensitively", () => {
    const feeds = parseChainlinkFeedDirectory([directoryRow]);
    expect(findChainlinkFeedByAddress(feeds, directoryRow.proxyAddress.toLowerCase())).toBe(feeds[0]);
    expect(
      findChainlinkFeedByAddress(feeds, directoryRow.secondaryProxyAddress.toLowerCase()),
    ).toBe(feeds[0]);
    expect(findChainlinkFeedByAddress(feeds, "0x0000000000000000000000000000000000000001")).toBe(
      undefined,
    );
  });

  it("publishes read-only Aggregator V3 calls for client-neutral consumers", () => {
    expect(CHAINLINK_AGGREGATOR_V3_ABI.map((item) => item.name)).toEqual([
      "latestRoundData",
      "decimals",
      "description",
    ]);
  });

  it("filters by normalized symbol and directory metadata", () => {
    const feeds = parseChainlinkFeedDirectory([
      directoryRow,
      {
        ...directoryRow,
        name: "ETH / USD",
        proxyAddress: "0x0000000000000000000000000000000000000001",
        secondaryProxyAddress: "",
        docs: { baseAsset: "ETH", quoteAsset: "USD", assetClass: "Crypto" },
      },
    ]);
    expect(findChainlinkFeeds(feeds, { baseAsset: "googl", assetClass: "equity" })).toEqual([
      feeds[0],
    ]);
    expect(() => findChainlinkFeeds(feeds, {})).toThrow(RangeError);
  });

  it("builds batch-read calls and normalizes the contract tuple", () => {
    const feeds = parseChainlinkFeedDirectory([directoryRow]);
    expect(getChainlinkRoundDataCalls(feeds)).toEqual([
      {
        address: directoryRow.proxyAddress,
        abi: CHAINLINK_AGGREGATOR_V3_ABI,
        functionName: "latestRoundData",
      },
    ]);
    expect(normalizeChainlinkRoundData([10n, 123n, 900n, 1_000n, 10n])).toEqual({
      roundId: 10n,
      answer: 123n,
      startedAtSeconds: 900n,
      updatedAtSeconds: 1_000n,
      answeredInRound: 10n,
    });
  });
});

describe("formatChainlinkAnswer", () => {
  it.each([
    [123_456_789n, 8, "1.23456789"],
    [100_000_000n, 8, "1.00000000"],
    [1n, 8, "0.00000001"],
    [-123n, 2, "-1.23"],
    [42n, 0, "42"],
  ])("formats %s at %i decimals without number precision loss", (answer, decimals, expected) => {
    expect(formatChainlinkAnswer(answer, decimals)).toBe(expected);
  });

  it.each([-1, 1.5, 256])("rejects invalid decimal count %s", (decimals) => {
    expect(() => formatChainlinkAnswer(1n, decimals)).toThrow(RangeError);
  });
});

const healthyInput = {
  feed: { decimals: 8, heartbeatSeconds: 300 },
  round: {
    roundId: 10n,
    answer: 12_345_678_900n,
    updatedAtSeconds: 1_000,
    answeredInRound: 10n,
  },
  nowSeconds: 1_200,
  sequencer: { status: "up", sinceSeconds: 100, gracePeriodSeconds: 60 } as const,
  pauseState: "active" as const,
};

describe("assessOracleHealth", () => {
  it("returns an exact, usable snapshot only when every guard is explicit and healthy", () => {
    expect(assessOracleHealth(healthyInput)).toEqual({
      usable: true,
      reason: "healthy",
      issues: [],
      ageSeconds: 200,
      formattedAnswer: "123.45678900",
    });
  });

  it("fails closed and reports every independent issue", () => {
    expect(
      assessOracleHealth({
        ...healthyInput,
        round: { ...healthyInput.round, answer: 0n, updatedAtSeconds: 100 },
        nowSeconds: 1_000,
        sequencer: { status: "unknown" },
        pauseState: "unknown",
      }),
    ).toEqual({
      usable: false,
      reason: "pause-state-unknown",
      issues: ["pause-state-unknown", "sequencer-state-unknown", "invalid-answer", "stale"],
      ageSeconds: 900,
    });
  });

  it.each([
    ["missing", { ...healthyInput.round, answer: undefined }],
    ["number", { ...healthyInput.round, answer: 12_345_678_900 }],
  ])("fails closed for a %s answer supplied by JavaScript", (_label, round) => {
    expect(
      assessOracleHealth({
        ...healthyInput,
        round,
      } as never),
    ).toMatchObject({
      usable: false,
      issues: ["invalid-answer"],
    });
    expect(
      assessOracleHealth({
        ...healthyInput,
        round,
      } as never),
    ).not.toHaveProperty("formattedAnswer");
  });

  it.each([
    ["roundId", { ...healthyInput.round, roundId: 10 }],
    ["answeredInRound", { ...healthyInput.round, answeredInRound: 10 }],
  ])("fails closed for a wrong-typed optional %s", (_label, round) => {
    expect(
      assessOracleHealth({
        ...healthyInput,
        round,
      } as never),
    ).toMatchObject({
      usable: false,
      issues: ["invalid-round"],
    });
  });

  it("blocks while the sequencer is down and during its configured recovery grace period", () => {
    expect(
      assessOracleHealth({ ...healthyInput, sequencer: { status: "down" } }),
    ).toMatchObject({
      usable: false,
      reason: "sequencer-down",
      issues: ["sequencer-down"],
    });
    expect(
      assessOracleHealth({
        ...healthyInput,
        sequencer: { status: "up", sinceSeconds: 1_180, gracePeriodSeconds: 60 },
      }),
    ).toMatchObject({
      usable: false,
      reason: "sequencer-grace-period",
      issues: ["sequencer-grace-period"],
      sequencerGracePeriodRemainingSeconds: 40,
    });
  });

  it("distinguishes paused, incomplete, future, and invalid rounds", () => {
    expect(
      assessOracleHealth({ ...healthyInput, pauseState: "paused" }),
    ).toMatchObject({ reason: "corporate-action-paused" });
    expect(
      assessOracleHealth({
        ...healthyInput,
        round: { ...healthyInput.round, answeredInRound: 9n },
      }),
    ).toMatchObject({ issues: ["incomplete-round"] });
    expect(
      assessOracleHealth({
        ...healthyInput,
        round: { ...healthyInput.round, roundId: 0n },
      }),
    ).toMatchObject({ issues: ["invalid-round"] });
    expect(
      assessOracleHealth({
        ...healthyInput,
        round: { ...healthyInput.round, updatedAtSeconds: 1_201 },
      }),
    ).toMatchObject({ issues: ["future-timestamp"], ageSeconds: -1 });
    expect(
      assessOracleHealth({
        ...healthyInput,
        round: { ...healthyInput.round, updatedAtSeconds: 0 },
      }),
    ).toMatchObject({ issues: ["invalid-timestamp"] });
  });

  it("requires valid caller policy values but permits explicit non-applicable pauses", () => {
    expect(
      assessOracleHealth({ ...healthyInput, pauseState: "not-applicable" }),
    ).toMatchObject({ usable: true });
    expect(() =>
      assessOracleHealth({
        ...healthyInput,
        feed: { ...healthyInput.feed, heartbeatSeconds: 0 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      assessOracleHealth({ ...healthyInput, pauseState: undefined } as never),
    ).toThrow(TypeError);
    expect(() =>
      assessOracleHealth({
        ...healthyInput,
        sequencer: { status: "recovering" },
      } as never),
    ).toThrow(TypeError);
  });
});
