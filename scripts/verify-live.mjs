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
  fetchWithRetry,
  parseChainlinkFeedDirectory,
} from "../dist/index.js";
import {
  validateBlockscoutStats,
  validateEtherscanBlockNumber,
} from "./live-canary-validation.mjs";

const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL ?? "https://ethereum-rpc.publicnode.com";
const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

let rpcId = 0;
async function requestJson(url, init = {}) {
  const response = await fetchWithRetry(url, init, {
    timeoutMs: 10_000,
    attempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 5_000,
    retryUnsafeMethods: init.method === "POST",
  });
  assert(response.ok, `${url} returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${url} returned invalid JSON`, { cause: error });
  }
}

async function rpc(url, method, params = []) {
  const body = await requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  assert(typeof body === "object" && body !== null, `${url} ${method}: malformed JSON-RPC`);
  if (body.error) throw new Error(`${url} ${method}: ${JSON.stringify(body.error)}`);
  assert("result" in body, `${url} ${method}: missing JSON-RPC result`);
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

await verifyNetwork("mainnet", RPC_URL, CHAIN_ID, PROTOCOL_CONTRACTS.mainnet.l2);
await verifyNetwork("testnet", TESTNET_RPC_URL, TESTNET_CHAIN_ID, PROTOCOL_CONTRACTS.testnet.l2);
await verifyL1("mainnet L1", ETHEREUM_RPC_URL, PROTOCOL_CONTRACTS.mainnet.l1);
await verifyL1("testnet L1", SEPOLIA_RPC_URL, PROTOCOL_CONTRACTS.testnet.l1);

for (const url of [
  `${EXPLORER_API_URL}?module=block&action=eth_block_number`,
  `${TESTNET_EXPLORER_API_URL}?module=block&action=eth_block_number`,
]) {
  validateEtherscanBlockNumber(await requestJson(url));
}
for (const url of [
  `${BLOCKSCOUT_API_V2_URL}/stats`,
  `${TESTNET_BLOCKSCOUT_API_V2_URL}/stats`,
]) {
  validateBlockscoutStats(await requestJson(url));
}
console.log("Blockscout Etherscan-compatible and REST endpoints verified");

const feeds = parseChainlinkFeedDirectory(await requestJson(CHAINLINK_FEED_DIRECTORY_URL));

const assets = await requestJson("https://api.robinhood.com/rhj/assets");
assert(Array.isArray(assets.assets) && assets.assets.length > 0, "RHJ assets response is malformed");
console.log(`${feeds.length} Chainlink feeds and ${assets.assets.length} RHJ assets verified`);
