import {
  inspectTransaction,
  type TransactionPreflightAdapter,
} from "robinhood-chain-kit";

const FROM = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";

const addressWord = (address: string) => address.slice(2).padStart(64, "0");
const uintWord = (value: bigint) => value.toString(16).padStart(64, "0");
const data =
  `0xa9059cbb${addressWord(RECIPIENT)}${uintWord(100n)}` as `0x${string}`;

const adapter: TransactionPreflightAdapter = {
  getChainId: async () => 4663,
  simulate: async () => ({ success: true, gasUsed: 65_000n }),
  getCode: async () => "0x60006000",
  resolveContract: async (address) => ({
    address,
    name: "Example token",
    kind: "erc20",
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
  estimateGas: async () => 65_000n,
  getFeePerGas: async () => 2n,
};

const report = await inspectTransaction(
  {
    chainId: 4663,
    from: FROM,
    to: TOKEN,
    data,
  },
  { adapter },
);

console.log(
  JSON.stringify(
    {
      verdict: report.verdict,
      decodedAction: report.action,
      tokenChecks: report.evidence.tokenBalances,
      issues: report.issues,
      plan: report.plan,
    },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ),
);
