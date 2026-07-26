import {
  BLOCKSCOUT_API_V2_URL,
  CHAIN_ID,
  EXPLORER_API_URL,
  PROTOCOL_CONTRACTS,
  RPC_URL,
  TESTNET_BLOCKSCOUT_API_V2_URL,
  TESTNET_CHAIN_ID,
  TESTNET_EXPLORER_API_URL,
  TESTNET_RPC_URL,
  CHAINLINK_FEED_DIRECTORY_URL,
} from "../dist/index.js";

const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL ?? "https://ethereum-rpc.publicnode.com";
const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

let rpcId = 0;
async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  assert(response.ok, `${url} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${url} ${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function verifyNetwork(name, rpcUrl, chainId, l2Contracts) {
  const actualChainId = Number.parseInt(await rpc(rpcUrl, "eth_chainId"), 16);
  assert(actualChainId === chainId, `${name}: expected chain ${chainId}, got ${actualChainId}`);
  for (const [contract, address] of Object.entries(l2Contracts)) {
    const code = await rpc(rpcUrl, "eth_getCode", [address, "latest"]);
    assert(code && code !== "0x", `${name}: ${contract} has no code at ${address}`);
  }
  console.log(`${name}: chain id and ${Object.keys(l2Contracts).length} L2 deployments verified`);
}

async function verifyL1(name, rpcUrl, contracts) {
  for (const [contract, address] of Object.entries(contracts)) {
    const code = await rpc(rpcUrl, "eth_getCode", [address, "latest"]);
    assert(code && code !== "0x", `${name}: ${contract} has no code at ${address}`);
  }
  console.log(`${name}: ${Object.keys(contracts).length} L1 deployments verified`);
}

async function expectJson(url) {
  const response = await fetch(url);
  assert(response.ok, `${url} returned HTTP ${response.status}`);
  return response.json();
}

await verifyNetwork("mainnet", RPC_URL, CHAIN_ID, PROTOCOL_CONTRACTS.mainnet.l2);
await verifyNetwork("testnet", TESTNET_RPC_URL, TESTNET_CHAIN_ID, PROTOCOL_CONTRACTS.testnet.l2);
await verifyL1("mainnet L1", ETHEREUM_RPC_URL, PROTOCOL_CONTRACTS.mainnet.l1);
await verifyL1("testnet L1", SEPOLIA_RPC_URL, PROTOCOL_CONTRACTS.testnet.l1);

for (const url of [
  `${EXPLORER_API_URL}?module=block&action=eth_block_number`,
  `${TESTNET_EXPLORER_API_URL}?module=block&action=eth_block_number`,
  `${BLOCKSCOUT_API_V2_URL}/stats`,
  `${TESTNET_BLOCKSCOUT_API_V2_URL}/stats`,
]) {
  await expectJson(url);
}
console.log("Blockscout Etherscan-compatible and REST endpoints verified");

const feeds = await expectJson(CHAINLINK_FEED_DIRECTORY_URL);
assert(Array.isArray(feeds) && feeds.length > 0, "Chainlink feed directory is empty or malformed");
assert(
  feeds.every((feed) => /^0x[0-9a-fA-F]{40}$/.test(feed.proxyAddress ?? "")),
  "Chainlink feed directory contains an invalid proxyAddress",
);

const assets = await expectJson("https://api.robinhood.com/rhj/assets");
assert(Array.isArray(assets.assets) && assets.assets.length > 0, "RHJ assets response is malformed");
console.log(`${feeds.length} Chainlink feeds and ${assets.assets.length} RHJ assets verified`);
