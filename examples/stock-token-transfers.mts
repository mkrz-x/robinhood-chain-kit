/**
 * Read a stock token's ERC-8056 scaled-UI layer from live logs.
 *
 * The event is NOT the one EIP-8056 names. The spec says
 * `TransferWithUIAmount`; the deployed contracts emit `TransferWithScaledUI`.
 * Filtering on the spec's name computes a different topic0 and returns an
 * empty array, forever, which reads as a quiet chain rather than as a bug.
 *
 *   STOCK_TOKEN=0x... npx tsx stock-token-transfers.mts
 */
import { createPublicClient, http, parseAbiItem } from "viem";
import {
  RPC_URL,
  TRANSFER_WITH_SCALED_UI_EVENT,
  compareScaledUiMultiplier,
  formatScaledUiMultiplier,
  readScaledUiMultiplier,
  robinhoodChain,
} from "robinhood-chain-kit";

const token = process.env.STOCK_TOKEN;
if (!token) throw new Error("set STOCK_TOKEN to a Robinhood stock token address");

const client = createPublicClient({ chain: robinhoodChain, transport: http(RPC_URL) });

const head = await client.getBlockNumber();
const logs = await client.getLogs({
  address: token as `0x${string}`,
  event: parseAbiItem(TRANSFER_WITH_SCALED_UI_EVENT),
  fromBlock: head > 50_000n ? head - 50_000n : 0n,
  toBlock: head,
});

console.log(`${logs.length} scaled-UI transfer(s) in the last ${head > 50_000n ? 50_000 : head} blocks`);
if (logs.length === 0) {
  console.log("no transfers in the window. that is a quiet token, not a wrong topic0:");
  console.log("this example uses the deployed event name, so an empty result is real.");
  process.exit(0);
}

/**
 * Walk the window and report every point where the multiplier moved.
 *
 * Direction only. A split and a dividend adjustment both push it up, and the
 * event carries nothing that tells them apart — pair this with a corporate
 * actions calendar if you need the reason.
 */
let previous: bigint | null = null;
for (const log of logs) {
  const { value, uiValue } = log.args as { value: bigint; uiValue: bigint };
  const read = readScaledUiMultiplier({ value, uiValue });
  if (!read.known) continue; // a zero-value transfer cannot date the multiplier
  if (previous !== null) {
    const change = compareScaledUiMultiplier(previous, read.multiplier);
    if (change.moved) {
      console.log(
        `block ${log.blockNumber}: multiplier moved ${change.direction} — ` +
          `${formatScaledUiMultiplier(change.previous)} to ${formatScaledUiMultiplier(change.current)}`,
      );
      console.log("  every figure derived from raw amounts across this point has changed meaning.");
    }
  }
  previous = read.multiplier;
}

if (previous !== null) {
  console.log(`current multiplier: ${formatScaledUiMultiplier(previous)}`);
  console.log("1.000000000000000000 means unadjusted; anything else means a corporate action landed.");
}
