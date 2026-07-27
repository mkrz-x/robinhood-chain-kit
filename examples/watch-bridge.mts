/**
 * Watch recent canonical ERC-20 deposits into Robinhood Chain.
 *
 * ETHEREUM_RPC_URL=https://your-ethereum-rpc.example npx tsx watch-bridge.mts
 * Optional: FROM_BLOCK=<absolute L1 block>; otherwise the last 1,000 blocks.
 */
import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  http,
  parseAbiItem,
  type Address,
} from "viem";
import { mainnet } from "viem/chains";
import {
  DEPOSIT_INITIATED_EVENT,
  L1_GATEWAYS,
  getLogsPaged,
} from "robinhood-chain-kit";

const rpcUrl = process.env.ETHEREUM_RPC_URL;
if (!rpcUrl) {
  throw new Error("Set ETHEREUM_RPC_URL to an Ethereum RPC endpoint with eth_getLogs access");
}

const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
const head = await client.getBlockNumber();
const fromBlock = process.env.FROM_BLOCK ? BigInt(process.env.FROM_BLOCK) : head - 1_000n;

const logs = await getLogsPaged(
  (from, to) =>
    client.getLogs({
      address: [...L1_GATEWAYS],
      event: parseAbiItem(DEPOSIT_INITIATED_EVENT),
      fromBlock: from,
      toBlock: to,
    }),
  fromBlock,
  head,
  { chunkSize: 1_000n },
);

const metadata = new Map<Address, Promise<{ symbol: string; decimals: number } | undefined>>();
const tokenMetadata = (address: Address) => {
  let pending = metadata.get(address);
  if (!pending) {
    pending = Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    ])
      .then(([symbol, decimals]) => ({ symbol, decimals }))
      .catch(() => undefined);
    metadata.set(address, pending);
  }
  return pending;
};

console.log(`${logs.length} ERC-20 deposits in L1 blocks ${fromBlock}–${head}`);
for (const log of logs.slice(-10)) {
  const { l1Token, _from, _amount } = log.args;
  if (!l1Token || _amount === undefined) continue;
  const token = await tokenMetadata(l1Token);
  const amount = token ? `${formatUnits(_amount, token.decimals)} ${token.symbol}` : `${_amount} raw`;
  console.log(`  block ${log.blockNumber}: ${_from} deposited ${amount} (${l1Token})`);
}
