/**
 * Executed oracle readers, and the one-call Oracle Guard on-ramp.
 *
 * The failure mode this module closes: `assessOracleHealth` fails closed on
 * unknown sequencer and pause state — which is correct — but 0.8.x gave you no
 * way to OBTAIN either input, so in practice every consumer either passed
 * `"not-applicable"` to make the check shut up (defeating it) or never reached
 * `usable: true` at all. `checkOracleHealth` gathers the round, the token's
 * pause flag, and — when you can point at one — the sequencer uptime feed, in
 * one call, and hands the lot to the same fail-closed assessment.
 *
 * What it deliberately does NOT do is invent sequencer knowledge. No L2
 * sequencer uptime feed for chain 4663 is listed in the live Chainlink
 * directory as of 2026-08-24, so there is no address this package could verify
 * and ship. Until one is published, sequencer state is caller knowledge:
 * supply `sequencerFeed` when you have an address you trust, or `sequencer`
 * directly when you monitor liveness some other way — or omit both and read
 * the honest `sequencer-state-unknown` in the verdict.
 */
import {
  describeCallFailure,
  executeContractCalls,
  type MinimalPublicClient,
} from "./client.js";
import {
  assessOracleHealth,
  getChainlinkRoundDataCalls,
  normalizeChainlinkRoundData,
  type ChainlinkFeed,
  type ChainlinkRoundData,
  type OracleHealthAssessment,
  type OraclePauseState,
  type OracleSequencerState,
} from "./feeds.js";
import { readOraclePauseState } from "./erc8056read.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The slice of a directory entry the round readers actually need. */
export type OracleFeedRef = Pick<ChainlinkFeed, "proxyAddress">;

export type OracleRoundResult =
  | { status: "success"; feed: `0x${string}`; round: Required<ChainlinkRoundData> }
  | { status: "error"; feed: `0x${string}`; error: string };

const roundTuple = (value: unknown, feed: string): Required<ChainlinkRoundData> => {
  if (!Array.isArray(value)) {
    throw new TypeError(`latestRoundData() on ${feed} did not return a tuple`);
  }
  return normalizeChainlinkRoundData(
    value as [bigint, bigint, bigint, bigint, bigint],
  );
};

/**
 * Execute `latestRoundData()` for one feed and normalize the tuple.
 *
 * Throws when the read fails or the tuple is malformed. A revert here usually
 * means the address is not an AggregatorV3 proxy — check it against the
 * directory rather than retrying.
 */
export async function readOracleRound(
  client: MinimalPublicClient,
  feed: OracleFeedRef | string,
): Promise<Required<ChainlinkRoundData>> {
  const proxyAddress = typeof feed === "string" ? feed : feed.proxyAddress;
  if (typeof proxyAddress !== "string" || !ADDRESS.test(proxyAddress)) {
    throw new TypeError(`Invalid feed address: ${String(proxyAddress)}`);
  }
  const [call] = getChainlinkRoundDataCalls([
    { proxyAddress: proxyAddress as `0x${string}` },
  ]);
  const result = await client.readContract(call!);
  return roundTuple(result, proxyAddress);
}

/**
 * Batched rounds for many feeds, multicall-chunked, failures isolated per
 * feed and results in input order.
 */
export async function readOracleRounds(
  client: MinimalPublicClient,
  feeds: readonly (OracleFeedRef | string)[],
): Promise<OracleRoundResult[]> {
  const addresses = feeds.map((feed) => {
    const proxyAddress = typeof feed === "string" ? feed : feed.proxyAddress;
    if (typeof proxyAddress !== "string" || !ADDRESS.test(proxyAddress)) {
      throw new TypeError(`Invalid feed address: ${String(proxyAddress)}`);
    }
    return proxyAddress as `0x${string}`;
  });
  const calls = getChainlinkRoundDataCalls(addresses.map((proxyAddress) => ({ proxyAddress })));
  const settled = await executeContractCalls(client, calls);
  return settled.map((entry, index) => {
    const feed = addresses[index]!;
    if (entry.status !== "success") {
      return { status: "error", feed, error: describeCallFailure(entry) };
    }
    try {
      return { status: "success", feed, round: roundTuple(entry.result, feed) };
    } catch (error) {
      return {
        status: "error",
        feed,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export interface ReadSequencerUptimeOptions {
  /**
   * Seconds the sequencer must have been back up before its answers are
   * trusted again — the standard Chainlink L2 pattern. Defaults to 3600,
   * which is Chainlink's own documented example value; shorten it only with a
   * reason.
   */
  gracePeriodSeconds?: number;
}

/**
 * Read an AggregatorV3 L2 sequencer uptime feed: `answer` 0 = up, 1 = down,
 * `startedAt` = when the current status began.
 *
 * No uptime feed address for chain 4663 could be verified in the live
 * Chainlink directory, so this function takes the address rather than
 * shipping one — an unverified address baked into a package is exactly the
 * kind of silent wrong answer the kit exists to prevent. When Chainlink
 * publishes one, pass it here.
 *
 * Fails closed: a revert, a malformed tuple, or an answer that is neither 0
 * nor 1 all return `{ status: "unknown" }`, which `assessOracleHealth`
 * refuses to treat as up. Throws only on an invalid address argument.
 */
export async function readSequencerUptime(
  client: MinimalPublicClient,
  aggregatorAddress: string,
  options: ReadSequencerUptimeOptions = {},
): Promise<OracleSequencerState> {
  if (typeof aggregatorAddress !== "string" || !ADDRESS.test(aggregatorAddress)) {
    throw new TypeError(`Invalid sequencer uptime feed address: ${aggregatorAddress}`);
  }
  const gracePeriodSeconds = options.gracePeriodSeconds ?? 3600;
  if (!Number.isFinite(gracePeriodSeconds) || gracePeriodSeconds < 0) {
    throw new RangeError("gracePeriodSeconds must be a non-negative finite number");
  }
  try {
    const round = await readOracleRound(client, aggregatorAddress);
    if (round.answer === 0n) {
      return {
        status: "up",
        sinceSeconds: round.startedAtSeconds,
        gracePeriodSeconds,
      };
    }
    if (round.answer === 1n) return { status: "down" };
    return { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}

export interface CheckOracleHealthOptions {
  /** the feed to read and judge — a directory entry, or its shape by hand */
  feed: Pick<ChainlinkFeed, "proxyAddress" | "decimals" | "heartbeatSeconds">;
  /**
   * The stock token whose `oraclePaused()` flag guards this feed. Omit it and
   * pause state is `"unknown"` — fail closed — unless `pauseState` supplies
   * caller knowledge instead. Setting both throws: two sources of pause truth
   * is one too many.
   */
  token?: string;
  /** caller-known pause state (e.g. `"not-applicable"` for a crypto feed) */
  pauseState?: OraclePauseState;
  /**
   * An L2 sequencer uptime feed to read. None is shipped for chain 4663
   * because none could be verified — see `readSequencerUptime`.
   */
  sequencerFeed?: string;
  /** grace period used with `sequencerFeed` (default 3600 s) */
  sequencerGracePeriodSeconds?: number;
  /** caller-known sequencer state; mutually exclusive with `sequencerFeed` */
  sequencer?: OracleSequencerState;
  nowSeconds?: number;
  freshnessGraceSeconds?: number;
}

/** `checkOracleHealth`'s verdict plus every input it gathered to reach it. */
export interface OracleHealthCheck {
  health: OracleHealthAssessment;
  round: Required<ChainlinkRoundData>;
  pauseState: OraclePauseState;
  sequencer: OracleSequencerState;
}

/**
 * Gather round + pause + sequencer state and assess, in one call.
 *
 * ```ts
 * const feeds = await loadChainlinkFeedDirectory();
 * const [feed] = findChainlinkFeeds(feeds, { baseAsset: "AAPL", quoteAsset: "USD" });
 * const { health } = await checkOracleHealth(client, { feed: feed!, token: aaplToken });
 * ```
 *
 * The verdict is `assessOracleHealth`'s, unchanged — including its refusal to
 * mark anything usable while sequencer state is unknown. This function makes
 * the inputs obtainable; it does not soften what unknown means. With no
 * sequencer source at all, expect `issues: ["sequencer-state-unknown"]` and
 * nothing else on a healthy feed: that one remaining issue is the honest
 * statement of what you have not verified.
 */
export async function checkOracleHealth(
  client: MinimalPublicClient,
  options: CheckOracleHealthOptions,
): Promise<OracleHealthCheck> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("options must be an object");
  }
  if (options.token !== undefined && options.pauseState !== undefined) {
    throw new TypeError("set token or pauseState, not both");
  }
  if (options.sequencerFeed !== undefined && options.sequencer !== undefined) {
    throw new TypeError("set sequencerFeed or sequencer, not both");
  }

  const [round, pauseState, sequencer] = await Promise.all([
    readOracleRound(client, options.feed),
    options.token !== undefined
      ? readOraclePauseState(client, options.token)
      : Promise.resolve<OraclePauseState>(options.pauseState ?? "unknown"),
    options.sequencerFeed !== undefined
      ? readSequencerUptime(client, options.sequencerFeed, {
          ...(options.sequencerGracePeriodSeconds === undefined
            ? {}
            : { gracePeriodSeconds: options.sequencerGracePeriodSeconds }),
        })
      : Promise.resolve<OracleSequencerState>(options.sequencer ?? { status: "unknown" }),
  ]);

  const health = assessOracleHealth({
    feed: options.feed,
    round,
    sequencer,
    pauseState,
    ...(options.nowSeconds === undefined ? {} : { nowSeconds: options.nowSeconds }),
    ...(options.freshnessGraceSeconds === undefined
      ? {}
      : { freshnessGraceSeconds: options.freshnessGraceSeconds }),
  });
  return { health, round, pauseState, sequencer };
}
