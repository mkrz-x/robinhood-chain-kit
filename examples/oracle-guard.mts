/**
 * Read one Chainlink feed and apply Oracle Guard.
 *
 * Oracle Guard deliberately cannot discover corporate-action or sequencer
 * state from a price round. Supply those independent states explicitly:
 *
 *   BASE_ASSET=GOOGL PAUSE_STATE=active \
 *   SEQUENCER_STATUS=up SEQUENCER_UP_SINCE=... SEQUENCER_GRACE_SECONDS=3600 \
 *   npx tsx oracle-guard.mts
 */
import {
  CHAINLINK_AGGREGATOR_V3_ABI,
  RPC_URL,
  assessOracleHealth,
  findChainlinkFeeds,
  loadChainlinkFeedDirectory,
  normalizeChainlinkRoundData,
  robinhoodChain,
  type OraclePauseState,
  type OracleSequencerState,
} from "robinhood-chain-kit";
import { createPublicClient, http } from "viem";

const requiredNumber = (name: string) => {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
};

const pauseState = (process.env.PAUSE_STATE ?? "unknown") as OraclePauseState;
if (!["active", "paused", "unknown", "not-applicable"].includes(pauseState)) {
  throw new Error("PAUSE_STATE must be active, paused, unknown, or not-applicable");
}

const sequencerStatus = process.env.SEQUENCER_STATUS ?? "unknown";
let sequencer: OracleSequencerState;
if (sequencerStatus === "up") {
  sequencer = {
    status: "up",
    sinceSeconds: requiredNumber("SEQUENCER_UP_SINCE"),
    gracePeriodSeconds: requiredNumber("SEQUENCER_GRACE_SECONDS"),
  };
} else if (sequencerStatus === "down" || sequencerStatus === "unknown") {
  sequencer = { status: sequencerStatus };
} else {
  throw new Error("SEQUENCER_STATUS must be up, down, or unknown");
}

const baseAsset = process.env.BASE_ASSET ?? "GOOGL";
const feeds = await loadChainlinkFeedDirectory();
const matches = findChainlinkFeeds(feeds, { baseAsset, quoteAsset: "USD" });
if (matches.length !== 1) {
  throw new Error(`Expected one ${baseAsset}/USD feed, found ${matches.length}`);
}
const feed = matches[0]!;
const client = createPublicClient({ chain: robinhoodChain, transport: http(RPC_URL) });
const tuple = await client.readContract({
  address: feed.proxyAddress,
  abi: CHAINLINK_AGGREGATOR_V3_ABI,
  functionName: "latestRoundData",
});
const health = assessOracleHealth({
  feed,
  round: normalizeChainlinkRoundData(tuple),
  sequencer,
  pauseState,
});

console.log(`${feed.name}: ${health.formattedAnswer ?? "invalid answer"}`);
console.log(
  JSON.stringify({
    usable: health.usable,
    reason: health.reason,
    issues: health.issues,
    ageSeconds: health.ageSeconds,
  }),
);
