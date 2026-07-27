import {
  inspectTransaction,
  type TransactionPreflightAdapter,
} from "robinhood-chain-kit";

const FROM = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const SPENDER = "0x4444444444444444444444444444444444444444";
const MAX_UINT256 = (1n << 256n) - 1n;

const addressWord = (address: string) => address.slice(2).padStart(64, "0");
const uintWord = (value: bigint) => value.toString(16).padStart(64, "0");
const data =
  `0x095ea7b3${addressWord(SPENDER)}${uintWord(MAX_UINT256)}` as `0x${string}`;

const adapter: TransactionPreflightAdapter = {
  getChainId: async () => 4663,
  simulate: async () => ({ success: true, gasUsed: 50_000n }),
  getCode: async () => "0x60006000",
  resolveContract: async (address) =>
    address.toLowerCase() === SPENDER.toLowerCase()
      ? {
          address,
          kind: "unknown",
          verified: false,
          source: "untrusted caller input",
        }
      : {
          address,
          name: "Example token",
          kind: "erc20",
          verified: true,
          source: "example registry",
        },
  resolveAsset: async (address) => ({
    address,
    symbol: "DEMO",
    decimals: 18,
    kind: "erc20",
    verified: true,
    source: "example registry",
  }),
  getNativeBalance: async () => 1_000_000_000_000_000_000n,
  estimateGas: async () => 50_000n,
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
      blockingIssues: report.issues.filter((issue) => issue.severity === "block"),
      planStatus: report.plan.status,
      preparedSteps: report.plan.steps.length,
    },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ),
);
