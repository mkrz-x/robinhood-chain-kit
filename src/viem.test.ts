import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  multicall3Abi,
  parseAbiParameters,
  toFunctionSelector,
  type Hex,
} from "viem";
import { createViemPreflightAdapter, robinhoodChainActions } from "./viem.js";
import { CHAIN_ID, MULTICALL3_ADDRESS, RHJ_ASSETS_URL, robinhoodChain } from "./chain.js";
import { CHAINLINK_FEED_DIRECTORY_URL } from "./feeds.js";
import { inspectTransaction } from "./preflight.js";
import { SCALED_UI_ONE } from "./stocktokens.js";
import type { MinimalPublicClient } from "./client.js";

const AAPL_TOKEN = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9";
const AAPL_FEED = "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0";
const HOLDER = "0x1111111111111111111111111111111111111111";
const SPENDER = "0x2222222222222222222222222222222222222222";

const NOW = 1_800_000_000;
const MULTIPLIER = 1_250_000_000_000_000_000n; // 1.25
const TOKEN_PRICE = 125_00000000n; // $125.00 at 8 decimals — so the share is $100

const selector = (signature: string) => toFunctionSelector(signature).toLowerCase();
const SELECTORS = {
  uiMultiplier: selector("function uiMultiplier() view returns (uint256)"),
  newUIMultiplier: selector("function newUIMultiplier() view returns (uint256)"),
  effectiveAt: selector("function effectiveAt() view returns (uint256)"),
  oraclePaused: selector("function oraclePaused() view returns (bool)"),
  latestRoundData: selector(
    "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  ),
  balanceOf: selector("function balanceOf(address) view returns (uint256)"),
  allowance: selector("function allowance(address, address) view returns (uint256)"),
};

const uint256 = (value: bigint): Hex => encodeAbiParameters([{ type: "uint256" }], [value]);
const bool = (value: boolean): Hex => encodeAbiParameters([{ type: "bool" }], [value]);
const round = (answer: bigint, updatedAt: bigint): Hex =>
  encodeAbiParameters(parseAbiParameters("uint80, int256, uint256, uint256, uint80"), [
    10n,
    answer,
    updatedAt,
    updatedAt,
    10n,
  ]);

/** Answer one eth_call by target address + selector, like a tiny chain. */
const answerCall = (to: string, data: string): Hex => {
  const target = to.toLowerCase();
  const fn = data.slice(0, 10).toLowerCase();
  if (target === MULTICALL3_ADDRESS.toLowerCase()) {
    const { args } = decodeFunctionData({ abi: multicall3Abi, data: data as Hex });
    const calls = args[0] as readonly { target: string; callData: Hex }[];
    return encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result: calls.map((call) => {
        try {
          return { success: true, returnData: answerCall(call.target, call.callData) };
        } catch {
          return { success: false, returnData: "0x" as Hex };
        }
      }),
    });
  }
  if (target === AAPL_TOKEN.toLowerCase()) {
    if (fn === SELECTORS.uiMultiplier) return uint256(MULTIPLIER);
    if (fn === SELECTORS.newUIMultiplier) return uint256(MULTIPLIER);
    if (fn === SELECTORS.effectiveAt) return uint256(0n);
    if (fn === SELECTORS.oraclePaused) return bool(false);
    if (fn === SELECTORS.balanceOf) return uint256(1_000n);
    if (fn === SELECTORS.allowance) return uint256(500n);
  }
  if (target === AAPL_FEED.toLowerCase() && fn === SELECTORS.latestRoundData) {
    return round(TOKEN_PRICE, BigInt(NOW) - 600n);
  }
  if (data === "0x" || data === undefined) return "0x"; // plain value transfer
  throw new Error(`unexpected eth_call to ${target} with ${fn}`);
};

const transport = custom({
  request: async ({ method, params }: { method: string; params?: unknown[] }) => {
    switch (method) {
      case "eth_chainId":
        return `0x${CHAIN_ID.toString(16)}`;
      case "eth_call": {
        const call = (params as [{ to: string; data?: string }])[0];
        return answerCall(call.to, call.data ?? "0x");
      }
      case "eth_getCode":
        return "0x"; // every target is an EOA in the preflight test
      case "eth_getBalance":
        return "0x56bc75e2d63100000"; // 100 ETH
      case "eth_estimateGas":
        return "0x5208"; // 21000
      case "eth_gasPrice":
        return "0x3b9aca00"; // 1 gwei
      default:
        throw new Error(`unexpected method ${method}`);
    }
  },
});

const stockDirectoryFixture = {
  assets: [
    {
      id: "0x00000000000000000000000000000000c2425be3658540dd8e2424cbf3c5c649",
      tokenSymbol: "AAPL",
      tokenName: "Apple • Robinhood Token",
      deployments: [
        { contractAddress: AAPL_TOKEN, chainId: 4663, networkName: "Robinhood Chain" },
      ],
      currentMultiplier: "1.250000000000000000",
      pendingMultiplier: "",
      status: "ASSET_STATUS_ACTIVE",
      tokenDecimals: 18,
      isin: "US0378331005",
    },
  ],
};

const feedDirectoryFixture = [
  {
    name: "Robinhood AAPL / USD",
    proxyAddress: AAPL_FEED,
    heartbeat: 86_400,
    decimals: 8,
    assetName: "Apple (Robinhood Tokenized Equity)",
    docs: { assetClass: "Equity", baseAsset: "AAPL", quoteAsset: "USD" },
  },
];

const fetchImpl = (async (url: string | URL | Request) => {
  const href = String(url);
  if (href === RHJ_ASSETS_URL) {
    return new Response(JSON.stringify(stockDirectoryFixture), { status: 200 });
  }
  if (href === CHAINLINK_FEED_DIRECTORY_URL) {
    return new Response(JSON.stringify(feedDirectoryFixture), { status: 200 });
  }
  throw new Error(`unexpected fetch ${href}`);
}) as typeof fetch;

describe("a real viem PublicClient satisfies the kit's structural client", () => {
  it("assigns without casts, with and without a chain", () => {
    const withChain: MinimalPublicClient = createPublicClient({
      chain: robinhoodChain,
      transport,
    });
    const chainless: MinimalPublicClient = createPublicClient({ transport });
    expect(typeof withChain.readContract).toBe("function");
    expect(typeof chainless.readContract).toBe("function");
  });
});

describe("robinhoodChainActions extends a viem client", () => {
  const client = createPublicClient({ chain: robinhoodChain, transport }).extend(
    robinhoodChainActions({ fetchImpl }),
  );

  it("getScaledUiMultiplierState reads through the real multicall3 path", async () => {
    const state = await client.getScaledUiMultiplierState(AAPL_TOKEN);
    expect(state.uiMultiplier).toBe(MULTIPLIER);
    expect(state.schedule).toEqual({ status: "none", multiplier: MULTIPLIER });
  });

  it("getScaledUiMultiplierState also works on a chainless client via the sequential fallback", async () => {
    const chainless = createPublicClient({ transport }).extend(robinhoodChainActions());
    const state = await chainless.getScaledUiMultiplierState(AAPL_TOKEN);
    expect(state.uiMultiplier).toBe(MULTIPLIER);
  });

  it("getStockDirectory loads the strictly parsed registry", async () => {
    const directory = await client.getStockDirectory();
    expect(directory).toHaveLength(1);
    expect(directory[0]!.tokenAddress).toBe(AAPL_TOKEN.toLowerCase());
  });

  it("getOracleHealth reaches usable: true when every input is supplied", async () => {
    const { health } = await client.getOracleHealth({
      feed: { proxyAddress: AAPL_FEED as `0x${string}`, decimals: 8, heartbeatSeconds: 86_400 },
      token: AAPL_TOKEN,
      sequencer: { status: "up", sinceSeconds: NOW - 7_200, gracePeriodSeconds: 3_600 },
      nowSeconds: NOW,
    });
    expect(health.usable).toBe(true);
    expect(health.formattedAnswer).toBe("125.00000000");
  });

  it("getEquityQuote composes directory, feed, round, pause, and session", async () => {
    const quote = await client.getEquityQuote("AAPL", { nowSeconds: NOW });
    expect(quote.symbol).toBe("AAPL");
    expect(quote.tokenAddress).toBe(AAPL_TOKEN.toLowerCase());
    expect(quote.tokenPrice).toEqual({
      value: TOKEN_PRICE,
      decimals: 8,
      formatted: "125.00000000",
    });
    // the docs' direction: share price = token price * 1e18 / multiplier
    expect(quote.sharePrice.formatted).toBe("100.00000000");
    expect(quote.multiplier).toBe(MULTIPLIER);
    expect(quote.schedule).toEqual({ status: "none", multiplier: MULTIPLIER });
    expect(quote.pauseState).toBe("active");
    expect(quote.session.phase === "regular" || quote.session.phase === "closed").toBe(true);
    // no sequencer source was configured, so the quote is a report, not a
    // green light — exactly one honest issue remains
    expect(quote.health.usable).toBe(false);
    expect(quote.health.issues).toEqual(["sequencer-state-unknown"]);
  });

  it("getEquityQuote resolves an address the same as its symbol", async () => {
    const quote = await client.getEquityQuote(AAPL_TOKEN.toUpperCase().replace("0X", "0x"), {
      nowSeconds: NOW,
      sequencer: { status: "up", sinceSeconds: NOW - 7_200, gracePeriodSeconds: 3_600 },
    });
    expect(quote.symbol).toBe("AAPL");
    expect(quote.health.usable).toBe(true);
  });

  it("getEquityQuote refuses an unlisted symbol rather than guessing", async () => {
    await expect(client.getEquityQuote("TSLA0X", { nowSeconds: NOW })).rejects.toThrow(
      /not in the stock-token directory/,
    );
  });
});

describe("createViemPreflightAdapter is the shipped inspectTransaction binding", () => {
  const client = createPublicClient({ chain: robinhoodChain, transport });
  const adapter = createViemPreflightAdapter(client);

  it("implements the read-only evidence methods with viem calls", async () => {
    expect(await adapter.getChainId!({})).toBe(CHAIN_ID);
    expect(await adapter.getCode!(HOLDER, {})).toBe("0x");
    expect(await adapter.getNativeBalance!(HOLDER, {})).toBe(100_000_000_000_000_000_000n);
    expect(await adapter.getTokenBalance!(AAPL_TOKEN as `0x${string}`, HOLDER, {})).toBe(1_000n);
    expect(
      await adapter.getAllowance!(AAPL_TOKEN as `0x${string}`, HOLDER, SPENDER, {}),
    ).toBe(500n);
  });

  it("carries a native transfer to a safe verdict end to end", async () => {
    const report = await inspectTransaction(
      { chainId: CHAIN_ID, from: HOLDER, to: SPENDER, value: 1_000_000_000_000_000n },
      { adapter },
    );
    expect(report.verdict).toBe("safe");
    expect(report.plan.status).toBe("ready");
    expect(report.evidence.gasEstimate).toEqual({ status: "available", value: 21_000n });
  });

  it("reports a revert as a failed simulation, not an exception", async () => {
    const failing = createViemPreflightAdapter(
      createPublicClient({
        transport: custom({
          request: async ({ method }: { method: string }) => {
            if (method === "eth_call") throw new Error("execution reverted: nope");
            throw new Error(`unexpected ${method}`);
          },
        }),
      }),
    );
    const simulation = await failing.simulate(
      {
        chainId: CHAIN_ID,
        from: HOLDER,
        to: SPENDER,
        data: "0x",
        value: 0n,
      },
      {},
    );
    expect(simulation.success).toBe(false);
    expect(simulation.revertReason).toMatch(/reverted/);
  });

  it("omits identity resolution rather than fabricating verified evidence", () => {
    expect(adapter.resolveContract).toBeUndefined();
    expect(adapter.resolveAsset).toBeUndefined();
  });
});

describe("multiplier scale sanity", () => {
  it("the fixtures use the contract's 1e18 scale", () => {
    expect(MULTIPLIER * 4n).toBe(5n * SCALED_UI_ONE);
  });
});
