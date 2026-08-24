/**
 * The Oracle Guard on-ramp, against the live chain: one call gathers the
 * round, the token's corporate-action pause flag, and (when you can point at
 * one) the sequencer uptime feed, and returns the fail-closed verdict.
 *
 * The heart of it is three lines:
 *
 *   const [feed] = findChainlinkFeeds(await loadChainlinkFeedDirectory(), { baseAsset, quoteAsset: "USD" });
 *   const token = findStockToken(await loadStockTokenDirectory(), baseAsset);
 *   const { health } = await checkOracleHealth(client, { feed, token: token.tokenAddress });
 *
 * Expect `usable: false` with exactly `["sequencer-state-unknown"]` unless you
 * supply SEQUENCER_UPTIME_FEED: no uptime feed for chain 4663 is listed in the
 * live Chainlink directory, so the kit ships no address and the verdict says
 * honestly what has not been verified. That single remaining issue — with
 * everything else green — is this example's expected result, not a failure.
 */
import {
  checkOracleHealth,
  findChainlinkFeeds,
  findStockToken,
  formatChainlinkAnswer,
  loadChainlinkFeedDirectory,
  loadStockTokenDirectory,
  robinhoodChain,
} from "robinhood-chain-kit";
import { createPublicClient, http } from "viem";

const symbol = process.env.SYMBOL ?? "AAPL";
const sequencerFeed = process.env.SEQUENCER_UPTIME_FEED;

const client = createPublicClient({ chain: robinhoodChain, transport: http() });

const [feeds, directory] = await Promise.all([
  loadChainlinkFeedDirectory(),
  loadStockTokenDirectory(),
]);
const [feed] = findChainlinkFeeds(feeds, { baseAsset: symbol, quoteAsset: "USD" });
if (!feed) throw new Error(`no ${symbol}/USD feed in the Chainlink directory`);
const token = findStockToken(directory, symbol);
if (!token) throw new Error(`${symbol} is not in the stock-token directory`);

const { health, round, pauseState, sequencer } = await checkOracleHealth(client, {
  feed,
  token: token.tokenAddress,
  ...(sequencerFeed ? { sequencerFeed } : {}),
});

console.log(`${symbol}: ${feed.name} (${feed.proxyAddress})`);
console.log(`  answer     ${formatChainlinkAnswer(round.answer, feed.decimals)} (token price, multiplier included)`);
console.log(`  age        ${health.ageSeconds}s of a ${feed.heartbeatSeconds}s heartbeat`);
console.log(`  pause      ${pauseState} (read from ${token.tokenAddress})`);
console.log(`  sequencer  ${sequencer.status}${sequencerFeed ? "" : " (no uptime feed supplied — set SEQUENCER_UPTIME_FEED when Chainlink publishes one)"}`);
console.log(`  usable     ${health.usable}${health.issues.length ? `  issues: ${health.issues.join(", ")}` : ""}`);
