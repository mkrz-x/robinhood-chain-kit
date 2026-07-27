import {
  inspectTransaction,
  type TransactionPreflightAdapter,
  type TransactionMarketContext,
} from "robinhood-chain-kit";

const FROM = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const ROUTER = "0x5555555555555555555555555555555555555555";
const NOW_SECONDS = 1_000;

const adapter: TransactionPreflightAdapter = {
  getChainId: async () => 4663,
  simulate: async () => ({ success: true, gasUsed: 150_000n }),
  getCode: async () => "0x60006000",
  resolveContract: async (address) => ({
    address,
    name: "Example router",
    kind: "router",
    verified: true,
    source: "example registry",
  }),
  resolveAsset: async (address) => ({
    address,
    symbol: "DEMO",
    decimals: 18,
    kind: "erc20",
    verified: true,
    source: "example registry",
  }),
  getNativeBalance: async () => 1_000_000_000_000_000_000n,
  getTokenBalance: async () => 1_000n,
  getAllowance: async () => 1_000n,
  estimateGas: async () => 150_000n,
  getFeePerGas: async () => 2n,
};

const observation = (source: string) => ({
  baseAsset: TOKEN,
  quoteAsset: "native:4663",
  source,
  chainId: 4663,
  blockNumber: 100n,
  observedAtSeconds: NOW_SECONDS,
});

const market: TransactionMarketContext = {
  oracle: {
    ...observation("Oracle Guard"),
    assessment: {
      usable: true,
      reason: "healthy",
      issues: [],
      ageSeconds: 1,
      formattedAnswer: "100.00000000",
    },
  },
  oraclePrice: {
    ...observation("Chainlink"),
    value: 100_000_000n,
    decimals: 8,
  },
  dexPrice: {
    ...observation("router quote"),
    value: 100n,
    decimals: 2,
  },
  slippage: { ...observation("router quote"), bps: 50 },
  priceImpact: { ...observation("router quote"), bps: 75 },
};

const report = await inspectTransaction(
  {
    chainId: 4663,
    from: FROM,
    to: ROUTER,
    data: "0x12345678",
  },
  {
    adapter,
    nowSeconds: NOW_SECONDS,
    decodeAction: () => ({
      kind: "custom",
      name: "Swap exact DEMO",
      category: "swap",
      source: "example router decoder",
      selector: "0x12345678",
      target: ROUTER,
      tokenBalanceRequirements: [
        { token: TOKEN, owner: FROM, minimum: 100n, label: "swap input" },
      ],
      allowanceRequirements: [
        {
          token: TOKEN,
          owner: FROM,
          spender: ROUTER,
          minimum: 100n,
          label: "router allowance",
        },
      ],
      marketSensitive: true,
      marketPair: { baseAsset: TOKEN, quoteAsset: "native:4663" },
    }),
    market,
  },
);

console.log(
  JSON.stringify(
    {
      verdict: report.verdict,
      decodedAction: report.action,
      oracleDexDeviationBps: report.oracleDexDeviationBps,
      issues: report.issues,
      plan: report.plan,
    },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ),
);
