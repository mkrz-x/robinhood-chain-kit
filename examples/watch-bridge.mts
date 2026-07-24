/** Watch capital entering Robinhood Chain: DepositInitiated events on the
 * canonical L1 gateways (Ethereum mainnet).
 *
 *   npx tsx watch-bridge.mts
 */
import { createPublicClient, http, parseAbiItem, formatUnits } from "viem";
import { mainnet } from "viem/chains";
import { DEPOSIT_INITIATED_EVENT, L1_GATEWAYS } from "robinhood-chain-kit";

const client = createPublicClient({
  chain: mainnet,
  transport: http("https://ethereum-rpc.publicnode.com"),
});

const head = await client.getBlockNumber();
const logs = await client.getLogs({
  address: [...L1_GATEWAYS],
  event: parseAbiItem(DEPOSIT_INITIATED_EVENT),
  fromBlock: head - 5000n, // ~17 hours of L1
  toBlock: head,
});

console.log(`${logs.length} deposits into Robinhood Chain in the last ~17h`);
for (const log of logs.slice(-10)) {
  const { l1Token, _from, _amount } = log.args;
  console.log(`  block ${log.blockNumber}: ${_from} bridged ${formatUnits(_amount!, 18)} of ${l1Token}`);
}
