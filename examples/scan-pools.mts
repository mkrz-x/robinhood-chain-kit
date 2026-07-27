/**
 * Enumerate pools from independently verified DEX deployments.
 *
 * At least one address list is required:
 *   V2_FACTORIES=0x... V3_FACTORIES=0x... V4_POOL_MANAGERS=0x... \
 *     npx tsx scan-pools.mts
 *
 * Optional FROM_BLOCK and TO_BLOCK values support manual checkpoint/resume.
 */
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import {
  getDexDiscoveryTargets,
  getLogsPaged,
  robinhoodChain,
} from "robinhood-chain-kit";

const addresses = (name: string) =>
  process.env[name]?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];

const targets = getDexDiscoveryTargets({
  v2Factories: addresses("V2_FACTORIES"),
  v3Factories: addresses("V3_FACTORIES"),
  v4PoolManagers: addresses("V4_POOL_MANAGERS"),
});
if (targets.length === 0) {
  throw new Error(
    "Set V2_FACTORIES, V3_FACTORIES, or V4_POOL_MANAGERS to verified deployment addresses",
  );
}

const client = createPublicClient({ chain: robinhoodChain, transport: http() });
const head = process.env.TO_BLOCK ? BigInt(process.env.TO_BLOCK) : await client.getBlockNumber();
const fromBlock = process.env.FROM_BLOCK ? BigInt(process.env.FROM_BLOCK) : 0n;

for (const target of targets) {
  let count = 0;
  await getLogsPaged(
    (from, to) =>
      client.getLogs({
        address: target.address as Address,
        event: parseAbiItem(target.event),
        fromBlock: from,
        toBlock: to,
      }),
    fromBlock,
    head,
    {
      chunkSize: 9_500n,
      collect: false,
      onPage: (logs, _from, to) => {
        count += logs.length;
        if (logs.length) console.log(`  ${target.protocol} through block ${to}: +${logs.length}`);
      },
    },
  );
  console.log(`${target.protocol} ${target.address}: ${count} pools`);
}
