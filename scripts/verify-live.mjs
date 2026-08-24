import {
  BLOCKSCOUT_API_V2_URL,
  CHAIN_ID,
  EXPLORER_API_URL,
  PROTOCOL_CONTRACTS,
  RHJ_ASSETS_URL,
  RPC_URL,
  TESTNET_BLOCKSCOUT_API_V2_URL,
  TESTNET_CHAIN_ID,
  TESTNET_EXPLORER_API_URL,
  TESTNET_RPC_URL,
  CHAINLINK_FEED_DIRECTORY_URL,
  USDG_ADDRESS,
  USDG_DECIMALS,
  checkOracleHealth,
  fetchWithRetry,
  findChainlinkFeeds,
  findStockToken,
  parseChainlinkFeedDirectory,
  parseStockTokenDirectory,
  readOraclePauseState,
  readScaledUiMultiplierState,
  robinhoodChain,
  underlyingSharePrice,
} from "../dist/index.js";
import { robinhoodChainActions } from "../dist/viem.js";
import { createPublicClient, http } from "viem";
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

const directory = parseStockTokenDirectory(await requestJson(RHJ_ASSETS_URL));
assert(directory.length > 0, "RHJ stock directory is empty");
const aapl = findStockToken(directory, "AAPL");
assert(aapl, "AAPL is missing from the stock directory");
console.log(`${feeds.length} Chainlink feeds and ${directory.length} stock-directory entries verified`);

/* 0.9.0 executed readers, against the live chain ------------------------- */
const client = createPublicClient({ chain: robinhoodChain, transport: http(RPC_URL) });

const state = await readScaledUiMultiplierState(client, aapl.tokenAddress);
assert(state.uiMultiplier > 0n, "AAPL uiMultiplier() must be positive");
assert(
  state.schedule.status !== "due",
  `AAPL multiplier schedule is ambiguous (due) — figures derived from it are unsafe`,
);

const pause = await readOraclePauseState(client, aapl.tokenAddress);
assert(
  pause === "active" || pause === "paused",
  `AAPL oraclePaused() should answer on a stock token, got ${pause}`,
);
const usdgPause = await readOraclePauseState(client, USDG_ADDRESS);
assert(
  usdgPause === "unknown",
  `USDG has no oraclePaused() and must fail closed to unknown, got ${usdgPause}`,
);

const usdgDecimals = await rpc(RPC_URL, "eth_call", [
  { to: USDG_ADDRESS, data: "0x313ce567" }, // decimals()
  "latest",
]);
assert(
  BigInt(usdgDecimals) === BigInt(USDG_DECIMALS),
  `USDG decimals() answered ${BigInt(usdgDecimals)}, expected ${USDG_DECIMALS}`,
);

const [aaplFeed] = findChainlinkFeeds(feeds, { baseAsset: "AAPL", quoteAsset: "USD" });
assert(aaplFeed, "no AAPL/USD feed in the Chainlink directory");
const check = await checkOracleHealth(client, { feed: aaplFeed, token: aapl.tokenAddress });
assert(check.round.answer > 0n, "AAPL feed answer must be positive");
assert(check.pauseState === pause, "checkOracleHealth pause state disagrees with the direct read");
assert(
  check.health.issues.includes("sequencer-state-unknown"),
  "with no sequencer source the verdict must carry sequencer-state-unknown",
);
const share = underlyingSharePrice(check.round.answer, aaplFeed.decimals, state.schedule.multiplier);
assert(share > 0n, "underlying share price must be positive");
console.log(
  `AAPL live: multiplier ${state.uiMultiplier}, pause ${pause}, ` +
    `token price ${check.round.answer} -> share price ${share} at ${aaplFeed.decimals} decimals`,
);

const extended = client.extend(robinhoodChainActions());
const quote = await extended.getEquityQuote("AAPL");
assert(quote.tokenPrice.value > 0n, "equity quote must carry a positive token price");
assert(quote.multiplier === state.uiMultiplier, "quote multiplier disagrees with the direct read");
assert(typeof quote.session.phase === "string", "quote must carry session context");
assert(quote.health.usable === false, "no sequencer source: the quote must not claim usable");
console.log(
  `viem extension verified: getEquityQuote(AAPL) -> ${quote.tokenPrice.formatted} token / ${quote.sharePrice.formatted} share (${quote.session.reason})`,
);
