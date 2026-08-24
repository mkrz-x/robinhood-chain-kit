/**
 * The shipped preflight binding: `createViemPreflightAdapter` implements the
 * firewall's read-only evidence interface over a viem public client, so the
 * forty lines of adapter glue in `preflight-transaction.mts` become one call.
 *
 * Identity resolution (`resolveContract` / `resolveAsset`) is deliberately
 * absent: viem has no independent identity source, and fabricated
 * `verified: true` evidence would hollow out the checks. With the default
 * policy a native transfer to a funded EOA reaches `safe`; token actions
 * surface explicit `unknown` identity evidence for you to fill from a source
 * you trust.
 */
import { inspectTransaction, robinhoodChain } from "robinhood-chain-kit";
import { createViemPreflightAdapter } from "robinhood-chain-kit/viem";
import { createPublicClient, http, type Address } from "viem";

const from = (process.env.FROM_ADDRESS ??
  "0x1111111111111111111111111111111111111111") as Address;
const to = (process.env.TO_ADDRESS ??
  "0x2222222222222222222222222222222222222222") as Address;

const client = createPublicClient({ chain: robinhoodChain, transport: http() });

const report = await inspectTransaction(
  { chainId: robinhoodChain.id, from, to, value: BigInt(process.env.VALUE_WEI ?? "0") },
  { adapter: createViemPreflightAdapter(client) },
);

console.log(
  JSON.stringify(
    { verdict: report.verdict, issues: report.issues, plan: report.plan },
    (_key, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  ),
);
