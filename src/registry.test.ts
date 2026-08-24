import { describe, expect, it } from "vitest";
import {
  USDG_ADDRESS,
  USDG_DECIMALS,
  findStockToken,
  loadStockTokenDirectory,
  parseStockTokenDirectory,
} from "./registry.js";
import { RHJ_ASSETS_URL } from "./chain.js";
import { sha256Hex } from "./feeds.js";

/**
 * A row captured from the live payload on 2026-08-24, verbatim. The parser is
 * tested against what the API actually publishes, not against what a schema
 * ought to say.
 */
const aaplRow = {
  id: "0x00000000000000000000000000000000c2425be3658540dd8e2424cbf3c5c649",
  tokenSymbol: "AAPL",
  tokenName: "Apple • Robinhood Token",
  deployments: [
    {
      contractAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
      chainId: 4663,
      networkName: "Robinhood Chain",
    },
  ],
  currentMultiplier: "1.000566080061092436",
  pendingMultiplier: "",
  status: "ASSET_STATUS_ACTIVE",
  logoUrl:
    "https://cdn.robinhood.com/ncw_assets/logos/0xaf3d76f1834a1d425780943c99ea8a608f8a93f9.png",
  tradingCapabilities: {
    market: { whole: "TRADING_STATUS_TRADABLE", fractional: "TRADING_STATUS_TRADABLE" },
    extended: { whole: "TRADING_STATUS_TRADABLE", fractional: "TRADING_STATUS_TRADABLE" },
    overnight: { whole: "TRADING_STATUS_TRADABLE", fractional: "TRADING_STATUS_TRADABLE" },
  },
  tokenDecimals: 18,
  isin: "US0378331005",
};

const crmRow = {
  ...aaplRow,
  id: "0x00000000000000000000000000000000022015c295294037bfe416d3e45327b9",
  tokenSymbol: "CRM",
  tokenName: "Salesforce • Robinhood Token",
  deployments: [
    {
      contractAddress: "0xd95B44124e475743a7589e68F3D74008A5536D44",
      chainId: 4663,
      networkName: "Robinhood Chain",
    },
  ],
  currentMultiplier: "4.000000000000000000",
  isin: "US79466L3024",
};

const payload = { assets: [aaplRow, crmRow] };

describe("parseStockTokenDirectory parses exactly what the API publishes", () => {
  it("normalizes the fields every live row carries", () => {
    const [aapl] = parseStockTokenDirectory(payload);
    expect(aapl).toEqual({
      id: aaplRow.id,
      symbol: "AAPL",
      name: "Apple • Robinhood Token",
      tokenAddress: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9",
      deployments: aaplRow.deployments,
      tokenDecimals: 18,
      isin: "US0378331005",
      status: "ASSET_STATUS_ACTIVE",
      currentMultiplierSnapshot: 1000566080061092436n,
      logoUrl: aaplRow.logoUrl,
    });
  });

  it("parses the decimal multiplier snapshot to the contract's 1e18 scale, exactly", () => {
    const [, crm] = parseStockTokenDirectory(payload);
    expect(crm!.currentMultiplierSnapshot).toBe(4_000_000_000_000_000_000n);
  });

  it("treats an empty pendingMultiplier as absent, and a non-empty one as a bigint", () => {
    const [aapl] = parseStockTokenDirectory(payload);
    expect(aapl!.pendingMultiplierSnapshot).toBeUndefined();
    const [pending] = parseStockTokenDirectory({
      assets: [{ ...aaplRow, pendingMultiplier: "2.5" }],
    });
    expect(pending!.pendingMultiplierSnapshot).toBe(2_500_000_000_000_000_000n);
  });

  it("ignores fields it does not model instead of failing on them", () => {
    const [aapl] = parseStockTokenDirectory({
      assets: [{ ...aaplRow, someFutureField: { anything: true } }],
    });
    expect(aapl!.symbol).toBe("AAPL");
    expect(aapl).not.toHaveProperty("tradingCapabilities");
  });

  it.each([
    ["a non-object payload", [aaplRow]],
    ["an empty assets array", { assets: [] }],
    ["a missing symbol", { assets: [{ ...aaplRow, tokenSymbol: "" }] }],
    ["an invalid address", { assets: [{ ...aaplRow, deployments: [{ ...aaplRow.deployments[0]!, contractAddress: "0xnope" }] }] }],
    ["no deployments", { assets: [{ ...aaplRow, deployments: [] }] }],
    ["invalid tokenDecimals", { assets: [{ ...aaplRow, tokenDecimals: 1.5 }] }],
    ["a malformed multiplier", { assets: [{ ...aaplRow, currentMultiplier: "1,5" }] }],
    ["a multiplier past 18 decimals", { assets: [{ ...aaplRow, currentMultiplier: "1.0000000000000000001" }] }],
    ["a duplicate address", { assets: [aaplRow, { ...crmRow, deployments: aaplRow.deployments }] }],
    ["a duplicate symbol", { assets: [aaplRow, { ...crmRow, tokenSymbol: "aapl" }] }],
  ])("rejects %s atomically", (_label, value) => {
    expect(() => parseStockTokenDirectory(value)).toThrow(TypeError);
  });

  it("rejects a row with no deployment on the requested chain", () => {
    expect(() => parseStockTokenDirectory(payload, { chainId: 1 })).toThrow(
      /no chain 1 deployment/,
    );
  });
});

describe("findStockToken", () => {
  const directory = parseStockTokenDirectory(payload);

  it("finds by symbol, case-insensitively", () => {
    expect(findStockToken(directory, "aapl")?.symbol).toBe("AAPL");
    expect(findStockToken(directory, "CRM")?.symbol).toBe("CRM");
  });

  it("finds by address in either casing", () => {
    expect(
      findStockToken(directory, "0xAF3D76F1834A1D425780943C99EA8A608F8A93F9")?.symbol,
    ).toBe("AAPL");
  });

  it("returns undefined for an unlisted token — an answer, not an error", () => {
    expect(findStockToken(directory, "TSLA0X")).toBeUndefined();
    expect(findStockToken(directory, "0x0000000000000000000000000000000000000001")).toBeUndefined();
  });

  it("rejects an empty query", () => {
    expect(() => findStockToken(directory, " ")).toThrow(TypeError);
  });
});

describe("loadStockTokenDirectory mirrors the feed-directory trust boundary", () => {
  const body = JSON.stringify(payload);

  const fetchOk = async (url: string | URL | Request) => {
    expect(String(url)).toBe(RHJ_ASSETS_URL);
    return new Response(body, { status: 200 });
  };

  it("loads and parses atomically through the injected fetch", async () => {
    const directory = await loadStockTokenDirectory({ fetchImpl: fetchOk as typeof fetch });
    expect(directory).toHaveLength(2);
    expect(directory[0]!.symbol).toBe("AAPL");
  });

  it("rejects a non-OK response", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    await expect(
      loadStockTokenDirectory({ fetchImpl, attempts: 1, sleep: async () => {} }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("verifies the pinned digest over the raw bytes before parsing", async () => {
    const digest = await sha256Hex(new TextEncoder().encode(body).buffer as ArrayBuffer);
    const directory = await loadStockTokenDirectory({
      fetchImpl: fetchOk as typeof fetch,
      expectedSha256: digest,
    });
    expect(directory).toHaveLength(2);
    await expect(
      loadStockTokenDirectory({
        fetchImpl: fetchOk as typeof fetch,
        expectedSha256: "0".repeat(64),
      }),
    ).rejects.toThrow(/integrity check failed/);
  });

  it("rejects a malformed expectedSha256 before making any request", async () => {
    const fetchImpl = (async () => {
      throw new Error("should not fetch");
    }) as typeof fetch;
    await expect(
      loadStockTokenDirectory({ fetchImpl, expectedSha256: "short" }),
    ).rejects.toThrow(TypeError);
  });
});

describe("USDG, verified on chain 4663", () => {
  it("pins the address and decimals the on-chain contract answered", () => {
    // eth_call on the mainnet RPC (2026-08-24): name() "Global Dollar",
    // symbol() "USDG", decimals() 6; Blockscout lists this deployment as
    // verified with live market data, unlike the same-name copycats.
    expect(USDG_ADDRESS).toBe("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
    expect(USDG_DECIMALS).toBe(6);
  });
});
