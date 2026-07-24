/** Enumerate every DEX pool ever created on Robinhood Chain, straight from
 * the public RPC — getLogsPaged handles the RPC's range caps automatically
 * (halves on dense windows, cools off on 429, re-grows when clear).
 *
 *   npx tsx scan-pools.mts
 */
import { createPublicClient, http, parseAbiItem } from "viem";
import {
  getLogsPaged,
  robinhoodChain,
  V2_PAIR_CREATED_EVENT,
  V3_POOL_CREATED_EVENT,
} from "robinhood-chain-kit";

const client = createPublicClient({ chain: robinhoodChain, transport: http() });
const head = await client.getBlockNumber();

for (const [label, sig] of [
  ["v2 pairs", V2_PAIR_CREATED_EVENT],
  ["v3 pools", V3_POOL_CREATED_EVENT],
] as const) {
  const logs = await getLogsPaged(
    (fromBlock, toBlock) =>
      client.getLogs({ event: parseAbiItem(sig), fromBlock, toBlock }),
    0n, // genesis — the chain is young enough to scan whole
    head,
    {
      chunkSize: 9_500n, // public RPC getLogs cap
      onPage: (l, _f, t) => l.length && console.log(`  ..block ${t}: +${l.length}`),
    },
  );
  console.log(`${label}: ${logs.length} total`);
}
