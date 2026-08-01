/**
 * Read a stock token's ERC-8056 scaled-UI layer from live logs.
 *
 * Two things this example is careful about, because both are easy to get
 * wrong and neither fails loudly:
 *
 * 1. The event is NOT the one EIP-8056 names. The spec says
 *    `TransferWithUIAmount`; the deployed contracts emit
 *    `TransferWithScaledUI`. Filtering on the spec's name computes a different
 *    topic0 and returns an empty array, forever, which reads as a quiet chain
 *    rather than as a bug.
 *
 * 2. A multiplier recovered from one transfer is an ESTIMATE. The contract
 *    computes `uiValue = floor(rawValue * multiplier / 1e18)`, so the
 *    low-order information is gone before the event is emitted. Two transfers
 *    of different sizes under one unchanged multiplier produce different point
 *    estimates — comparing those points reports corporate actions that never
 *    happened. This compares BOUNDS instead, which only claims a change when
 *    no single multiplier could explain both observations.
 *
 *   STOCK_TOKEN=0x... npx tsx stock-token-transfers.mts
 */
import { createPublicClient, http, parseAbiItem } from "viem";
import {
  RPC_URL,
  TRANSFER_WITH_SCALED_UI_EVENT,
  compareScaledUiEstimates,
  estimateScaledUiMultiplier,
  formatScaledUiMultiplier,
  getErc8056ReadCalls,
  resolveScaledUiMultiplier,
  robinhoodChain,
  type ScaledUiMultiplierEstimate,
} from "robinhood-chain-kit";

const token = process.env.STOCK_TOKEN;
if (!token) throw new Error("set STOCK_TOKEN to a Robinhood stock token address");

const client = createPublicClient({ chain: robinhoodChain, transport: http(RPC_URL) });

const head = await client.getBlockNumber();
const window = head > 50_000n ? 50_000n : head;
const logs = await client.getLogs({
  address: token as `0x${string}`,
  event: parseAbiItem(TRANSFER_WITH_SCALED_UI_EVENT),
  fromBlock: head - window,
  toBlock: head,
});

console.log(`${logs.length} scaled-UI transfer(s) in the last ${window} blocks`);
if (logs.length === 0) {
  console.log("no transfers in the window. that is a quiet token, not a wrong topic0:");
  console.log("this example uses the deployed event name, so an empty result is real.");
  process.exit(0);
}

let previous: ScaledUiMultiplierEstimate | null = null;
let latest: ScaledUiMultiplierEstimate | null = null;

for (const log of logs) {
  const { value, uiValue } = log.args as { value: bigint; uiValue: bigint };
  const estimate = estimateScaledUiMultiplier({ value, uiValue });
  if (!estimate.estimated) continue; // a zero-value transfer bounds nothing
  if (previous) {
    const change = compareScaledUiEstimates(previous, estimate);
    if (change.comparable && change.moved) {
      console.log(`block ${log.blockNumber}: multiplier provably moved ${change.direction}`);
      console.log("  every figure derived from raw amounts across this point has changed meaning.");
      console.log("  direction only: a split and a dividend adjustment both move it up.");
    }
  }
  previous = estimate;
  latest = estimate;
}

if (latest?.estimated) {
  console.log(`\nlatest estimate : ${formatScaledUiMultiplier(latest.multiplier)}`);
  console.log(`feasible range  : [${formatScaledUiMultiplier(latest.lowerBound)}, ` +
    `${formatScaledUiMultiplier(latest.upperBoundExclusive)})`);
  const width = latest.upperBoundExclusive - latest.lowerBound;
  console.log(
    width === 1n
      ? "the range is a single value: this transfer was large enough to pin the multiplier."
      : "the range is wider than one unit, so the estimate is a display value and nothing more.",
  );
}

/**
 * For a multiplier you can put in a financial calculation, read the contract.
 *
 * `newUIMultiplier()` is a SCHEDULED value, not the current one — the update
 * event announces a change and may be emitted more than once before it takes
 * effect. `resolveScaledUiMultiplier` decides which applies and flags the one
 * unsafe state: the effective time has passed and the contract has not moved.
 */
const calls = getErc8056ReadCalls(token);
const [current, pending, effectiveAt] = (await Promise.all(
  calls.map((call) =>
    client.readContract({ address: call.address, abi: call.abi, functionName: call.functionName }),
  ),
)) as [bigint, bigint, bigint];

const schedule = resolveScaledUiMultiplier(
  { current, pending, effectiveAtSeconds: effectiveAt },
  Math.floor(Date.now() / 1000),
);
console.log(`\nauthoritative : ${formatScaledUiMultiplier(schedule.multiplier)}`);
console.log(`schedule      : ${schedule.status}`);
if (schedule.status === "pending") {
  console.log(`  a change to ${formatScaledUiMultiplier(schedule.pending)} is announced for ` +
    `${new Date(schedule.effectiveAtSeconds * 1000).toISOString()}. it is NOT live yet.`);
}
if (schedule.status === "due") {
  console.log("  the effective time has passed and the contract still reports the old value.");
  console.log("  do not derive prices from either until this resolves.");
}
