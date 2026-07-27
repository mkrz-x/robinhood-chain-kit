import {
  RPC_URL,
  inspectTransaction,
  type TransactionPreflightAdapter,
} from "robinhood-chain-kit";
import { createPublicClient, http, type Address, type Hex } from "viem";

const from = (process.env.FROM_ADDRESS ??
  "0x1111111111111111111111111111111111111111") as Address;
const to = (process.env.TO_ADDRESS ??
  "0x2222222222222222222222222222222222222222") as Address;
const value = BigInt(process.env.VALUE_WEI ?? "0");
const client = createPublicClient({ transport: http(process.env.RPC_URL ?? RPC_URL) });

const adapter: TransactionPreflightAdapter = {
  getChainId: () => client.getChainId(),
  simulate: async (request) => {
    try {
      await client.call({
        account: request.from,
        to: request.to,
        data: request.data as Hex,
        value: request.value,
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        revertReason: error instanceof Error ? error.message : String(error),
      };
    }
  },
  getCode: async (address) =>
    (await client.getBytecode({ address })) ?? "0x",
  getNativeBalance: (owner) => client.getBalance({ address: owner }),
  estimateGas: (request) =>
    client.estimateGas({
      account: request.from,
      to: request.to,
      data: request.data as Hex,
      value: request.value,
    }),
  getFeePerGas: () => client.getGasPrice(),
};

const report = await inspectTransaction(
  {
    chainId: 4663,
    from,
    to,
    value,
  },
  { adapter },
);

console.log(
  JSON.stringify(
    {
      verdict: report.verdict,
      action: report.action,
      issues: report.issues,
      estimatedFee: report.estimatedFee,
      requiredNativeBalance: report.requiredNativeBalance,
      plan: report.plan,
    },
    (_key, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  ),
);
