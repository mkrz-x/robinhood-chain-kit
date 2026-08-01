/** Chainlink price-feed discovery and Oracle Guard primitives for Robinhood Chain. */
import { fetchWithRetry } from "./retryfetch.js";
import { isFeedFresh } from "./markethours.js";

export const CHAINLINK_FEED_DIRECTORY_URL =
  "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";

export type ChainlinkFeedAddress = `0x${string}`;

/** Client-neutral ABI for the feed reads required by Oracle Guard. */
export const CHAINLINK_AGGREGATOR_V3_ABI = [
  {
    type: "function",
    stateMutability: "view",
    name: "latestRoundData",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "description",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/** Stable, normalized subset of the external Chainlink feed-directory schema. */
export interface ChainlinkFeed {
  name: string;
  proxyAddress: ChainlinkFeedAddress;
  secondaryProxyAddress?: ChainlinkFeedAddress;
  heartbeatSeconds: number;
  decimals: number;
  path?: string;
  assetName?: string;
  feedCategory?: string;
  assetClass?: string;
  baseAsset?: string;
  quoteAsset?: string;
  marketHours?: string;
  productTypeCode?: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (row: Record<string, unknown>, field: string, index: number) => {
  const value = row[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Feed directory row ${index} has invalid ${field}`);
  }
  return value;
};

const optionalString = (
  row: Record<string, unknown>,
  field: string,
  index: number,
  label = field,
) => {
  const value = row[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`Feed directory row ${index} has invalid ${label}`);
  }
  return value.trim() === "" ? undefined : value;
};

const address = (value: string, field: string, index: number): ChainlinkFeedAddress => {
  if (!ADDRESS.test(value)) {
    throw new TypeError(`Feed directory row ${index} has invalid ${field}`);
  }
  return value as ChainlinkFeedAddress;
};

/**
 * Validate and normalize an entire Chainlink directory response. Parsing is
 * atomic: one malformed or duplicate row rejects the directory.
 */
export function parseChainlinkFeedDirectory(value: unknown): ChainlinkFeed[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("Feed directory must be a non-empty array");
  }

  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new TypeError(`Feed directory row ${index} must be an object`);
    const name = requiredString(entry, "name", index);
    const proxyAddress = address(requiredString(entry, "proxyAddress", index), "proxyAddress", index);
    const secondaryValue = optionalString(entry, "secondaryProxyAddress", index);
    const secondaryProxyAddress = secondaryValue
      ? address(secondaryValue, "secondaryProxyAddress", index)
      : undefined;
    for (const candidate of [proxyAddress, secondaryProxyAddress]) {
      if (!candidate) continue;
      const key = candidate.toLowerCase();
      if (seen.has(key)) throw new TypeError(`Feed directory contains duplicate ${candidate}`);
      seen.add(key);
    }

    const heartbeatSeconds = entry.heartbeat;
    const decimals = entry.decimals;
    if (!Number.isInteger(heartbeatSeconds) || (heartbeatSeconds as number) <= 0) {
      throw new TypeError(`Feed directory row ${index} has invalid heartbeat`);
    }
    if (!Number.isInteger(decimals) || (decimals as number) < 0 || (decimals as number) > 255) {
      throw new TypeError(`Feed directory row ${index} has invalid decimals`);
    }

    if (entry.docs !== undefined && !isRecord(entry.docs)) {
      throw new TypeError(`Feed directory row ${index} has invalid docs`);
    }
    const docs = isRecord(entry.docs) ? entry.docs : {};
    const path = optionalString(entry, "path", index);
    const assetName = optionalString(entry, "assetName", index);
    const feedCategory = optionalString(entry, "feedCategory", index);
    const assetClass = optionalString(docs, "assetClass", index, "docs.assetClass");
    const baseAsset = optionalString(docs, "baseAsset", index, "docs.baseAsset");
    const quoteAsset = optionalString(docs, "quoteAsset", index, "docs.quoteAsset");
    const marketHours = optionalString(docs, "marketHours", index, "docs.marketHours");
    const productTypeCode = optionalString(
      docs,
      "productTypeCode",
      index,
      "docs.productTypeCode",
    );
    return {
      name,
      proxyAddress,
      ...(secondaryProxyAddress ? { secondaryProxyAddress } : {}),
      heartbeatSeconds: heartbeatSeconds as number,
      decimals: decimals as number,
      ...(path ? { path } : {}),
      ...(assetName ? { assetName } : {}),
      ...(feedCategory ? { feedCategory } : {}),
      ...(assetClass ? { assetClass } : {}),
      ...(baseAsset ? { baseAsset } : {}),
      ...(quoteAsset ? { quoteAsset } : {}),
      ...(marketHours ? { marketHours } : {}),
      ...(productTypeCode ? { productTypeCode } : {}),
    };
  });
}

export interface LoadChainlinkFeedDirectoryOptions {
  /** Override for mirrors or fixtures. */
  url?: string | URL;
  signal?: AbortSignal;
  timeoutMs?: number;
  attempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Lowercase hex SHA-256 of the response body, pinned by the caller.
   *
   * `parseChainlinkFeedDirectory` proves the document is well-SHAPED. It
   * cannot prove it is the document the operator published — a compromised
   * mirror, a hijacked CDN entry or an intercepting proxy can serve a
   * schema-perfect directory pointing every feed at addresses it chose.
   * Supplying a digest turns "this parses" into "this is the exact file I
   * reviewed".
   *
   * No digest is hardcoded in this package. A pinned constant goes stale the
   * moment the operator adds a feed, and one that nobody maintains breaks for
   * every consumer at once, so pinning is the caller's decision and the
   * caller's upkeep.
   */
  expectedSha256?: string;
}

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("expectedSha256 requires WebCrypto (globalThis.crypto.subtle)");
  }
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Load and atomically validate the Robinhood Chain feed directory. This makes
 * no request until explicitly called.
 *
 * Structural validation is not authentication. Pass `expectedSha256` when the
 * directory's contents are load-bearing — see the option's own note.
 */
export async function loadChainlinkFeedDirectory(
  options: LoadChainlinkFeedDirectoryOptions = {},
): Promise<ChainlinkFeed[]> {
  const { expectedSha256 } = options;
  if (expectedSha256 !== undefined && !HEX_SHA256.test(expectedSha256)) {
    throw new TypeError("expectedSha256 must be a 64-character hex SHA-256 digest");
  }
  const response = await fetchWithRetry(
    options.url ?? CHAINLINK_FEED_DIRECTORY_URL,
    { method: "GET", signal: options.signal },
    {
      timeoutMs: options.timeoutMs ?? 10_000,
      attempts: options.attempts ?? 3,
      fetchImpl: options.fetchImpl,
      sleep: options.sleep,
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Feed directory returned HTTP ${response.status}`);
  }
  if (expectedSha256 === undefined) return parseChainlinkFeedDirectory(await response.json());

  // hash the bytes actually received, BEFORE parsing. a digest taken over
  // re-serialized JSON would match a document whose key order, whitespace or
  // number formatting differs from the one that was reviewed, which is not
  // the property anyone pins a digest for
  const bytes = await response.arrayBuffer();
  const actual = await sha256Hex(bytes);
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Feed directory integrity check failed: expected sha256 ${expectedSha256.toLowerCase()}, received ${actual}`,
    );
  }
  return parseChainlinkFeedDirectory(JSON.parse(new TextDecoder().decode(bytes)));
}

/** Find a primary or secondary proxy without assuming address checksum casing. */
export function findChainlinkFeedByAddress(
  feeds: readonly ChainlinkFeed[],
  addressValue: string,
): ChainlinkFeed | undefined {
  if (!ADDRESS.test(addressValue)) throw new TypeError(`Invalid feed address: ${addressValue}`);
  const key = addressValue.toLowerCase();
  return feeds.find(
    (feed) =>
      feed.proxyAddress.toLowerCase() === key ||
      feed.secondaryProxyAddress?.toLowerCase() === key,
  );
}

export interface ChainlinkFeedQuery {
  baseAsset?: string;
  quoteAsset?: string;
  assetClass?: string;
  marketHours?: string;
  productTypeCode?: string;
}

/** Filter metadata without assuming that a symbol maps to only one feed. */
export function findChainlinkFeeds(
  feeds: readonly ChainlinkFeed[],
  query: ChainlinkFeedQuery,
): ChainlinkFeed[] {
  const criteria = Object.entries(query).filter(
    (entry): entry is [keyof ChainlinkFeedQuery, string] =>
      typeof entry[1] === "string" && entry[1].trim() !== "",
  );
  if (criteria.length === 0) throw new RangeError("At least one feed query field is required");
  return feeds.filter((feed) =>
    criteria.every(
      ([field, expected]) =>
        feed[field]?.toLowerCase() === expected.trim().toLowerCase(),
    ),
  );
}

export interface ChainlinkRoundDataCall {
  address: ChainlinkFeedAddress;
  abi: typeof CHAINLINK_AGGREGATOR_V3_ABI;
  functionName: "latestRoundData";
}

/** Build viem-compatible calls for one multicall without adding a viem dependency. */
export function getChainlinkRoundDataCalls(
  feeds: readonly ChainlinkFeed[],
): ChainlinkRoundDataCall[] {
  return feeds.map((feed) => ({
    address: feed.proxyAddress,
    abi: CHAINLINK_AGGREGATOR_V3_ABI,
    functionName: "latestRoundData",
  }));
}

/** Format a signed Chainlink answer at its declared scale without using Number. */
export function formatChainlinkAnswer(answer: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError("decimals must be an integer between 0 and 255");
  }
  const negative = answer < 0n;
  const absolute = negative ? -answer : answer;
  if (decimals === 0) return `${negative ? "-" : ""}${absolute}`;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = String(absolute % scale).padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export interface ChainlinkRoundData {
  roundId?: bigint;
  answer: bigint;
  startedAtSeconds?: number | bigint;
  updatedAtSeconds: number | bigint;
  answeredInRound?: bigint;
}

export type ChainlinkLatestRoundDataResult = readonly [
  roundId: bigint,
  answer: bigint,
  startedAt: bigint,
  updatedAt: bigint,
  answeredInRound: bigint,
];

/** Convert the Aggregator V3 return tuple to the named Oracle Guard shape. */
export function normalizeChainlinkRoundData(
  result: ChainlinkLatestRoundDataResult,
): Required<ChainlinkRoundData> {
  if (result.length !== 5 || result.some((value) => typeof value !== "bigint")) {
    throw new TypeError("latestRoundData result must contain five bigint values");
  }
  return {
    roundId: result[0],
    answer: result[1],
    startedAtSeconds: result[2],
    updatedAtSeconds: result[3],
    answeredInRound: result[4],
  };
}

export type OraclePauseState = "active" | "paused" | "unknown" | "not-applicable";

export type OracleSequencerState =
  | { status: "up"; sinceSeconds: number | bigint; gracePeriodSeconds: number }
  | { status: "down" }
  | { status: "unknown" };

export type OracleHealthIssue =
  | "pause-state-unknown"
  | "corporate-action-paused"
  | "sequencer-state-unknown"
  | "sequencer-down"
  | "sequencer-grace-period"
  | "invalid-answer"
  | "invalid-round"
  | "incomplete-round"
  | "invalid-timestamp"
  | "future-timestamp"
  | "stale";

export type OracleHealthReason = "healthy" | OracleHealthIssue;

export interface OracleHealthAssessment {
  usable: boolean;
  reason: OracleHealthReason;
  issues: OracleHealthIssue[];
  ageSeconds?: number;
  formattedAnswer?: string;
  sequencerGracePeriodRemainingSeconds?: number;
}

export interface AssessOracleHealthInput {
  feed: Pick<ChainlinkFeed, "decimals" | "heartbeatSeconds">;
  round: ChainlinkRoundData;
  /** Required caller knowledge. Use unknown to fail closed. */
  sequencer: OracleSequencerState;
  /** Required caller knowledge. Use not-applicable only for assets without pauses. */
  pauseState: OraclePauseState;
  nowSeconds?: number;
  freshnessGraceSeconds?: number;
}

const safeSeconds = (value: number | bigint): number | undefined => {
  if (typeof value === "bigint") {
    if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    return Number(value);
  }
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

/**
 * Assess feed usability without making a trading decision. Unknown sequencer
 * or corporate-action state is deliberately unusable, and all independent
 * issues are returned so callers do not lose diagnostics to reason ordering.
 */
export function assessOracleHealth(input: AssessOracleHealthInput): OracleHealthAssessment {
  const { feed, round, sequencer, pauseState } = input;
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const freshnessGraceSeconds = input.freshnessGraceSeconds ?? 0;
  if (!Number.isInteger(feed.decimals) || feed.decimals < 0 || feed.decimals > 255) {
    throw new RangeError("feed.decimals must be an integer between 0 and 255");
  }
  if (!Number.isInteger(feed.heartbeatSeconds) || feed.heartbeatSeconds <= 0) {
    throw new RangeError("feed.heartbeatSeconds must be a positive integer");
  }
  if (!Number.isFinite(nowSeconds) || nowSeconds < 0) {
    throw new RangeError("nowSeconds must be a non-negative finite number");
  }
  if (!Number.isFinite(freshnessGraceSeconds) || freshnessGraceSeconds < 0) {
    throw new RangeError("freshnessGraceSeconds must be a non-negative finite number");
  }
  if (!["active", "paused", "unknown", "not-applicable"].includes(pauseState)) {
    throw new TypeError("pauseState is invalid");
  }
  if (
    typeof sequencer !== "object" ||
    sequencer === null ||
    !["up", "down", "unknown"].includes(sequencer.status)
  ) {
    throw new TypeError("sequencer state is invalid");
  }

  const issues: OracleHealthIssue[] = [];
  let sequencerGracePeriodRemainingSeconds: number | undefined;
  if (pauseState === "unknown") issues.push("pause-state-unknown");
  else if (pauseState === "paused") issues.push("corporate-action-paused");

  if (sequencer.status === "unknown") {
    issues.push("sequencer-state-unknown");
  } else if (sequencer.status === "down") {
    issues.push("sequencer-down");
  } else {
    if (
      !Number.isFinite(sequencer.gracePeriodSeconds) ||
      sequencer.gracePeriodSeconds < 0
    ) {
      throw new RangeError("sequencer.gracePeriodSeconds must be non-negative");
    }
    const sinceSeconds = safeSeconds(sequencer.sinceSeconds);
    if (sinceSeconds === undefined || sinceSeconds > nowSeconds) {
      issues.push("sequencer-state-unknown");
    } else {
      const recoveredFor = nowSeconds - sinceSeconds;
      if (recoveredFor < sequencer.gracePeriodSeconds) {
        issues.push("sequencer-grace-period");
        sequencerGracePeriodRemainingSeconds = sequencer.gracePeriodSeconds - recoveredFor;
      }
    }
  }

  const validAnswer = typeof round.answer === "bigint" && round.answer > 0n;
  if (!validAnswer) issues.push("invalid-answer");
  const validRoundId =
    round.roundId === undefined || (typeof round.roundId === "bigint" && round.roundId > 0n);
  const validAnsweredInRound =
    round.answeredInRound === undefined ||
    (typeof round.answeredInRound === "bigint" && round.answeredInRound > 0n);
  if (!validRoundId || !validAnsweredInRound) {
    issues.push("invalid-round");
  }
  if (
    typeof round.roundId === "bigint" &&
    typeof round.answeredInRound === "bigint" &&
    round.answeredInRound < round.roundId
  ) {
    issues.push("incomplete-round");
  }

  let ageSeconds: number | undefined;
  const updatedAtSeconds = safeSeconds(round.updatedAtSeconds);
  if (updatedAtSeconds === undefined) {
    issues.push("invalid-timestamp");
  } else {
    const freshness = isFeedFresh(
      updatedAtSeconds,
      feed.heartbeatSeconds,
      nowSeconds,
      freshnessGraceSeconds,
    );
    ageSeconds = freshness.ageSeconds;
    if (freshness.reason === "future") issues.push("future-timestamp");
    else if (freshness.reason === "stale") issues.push("stale");
    else if (freshness.reason === "invalid") issues.push("invalid-timestamp");
  }

  const assessment: OracleHealthAssessment = {
    usable: issues.length === 0,
    reason: issues[0] ?? "healthy",
    issues,
  };
  if (ageSeconds !== undefined) assessment.ageSeconds = ageSeconds;
  if (validAnswer) {
    assessment.formattedAnswer = formatChainlinkAnswer(round.answer, feed.decimals);
  }
  if (sequencerGracePeriodRemainingSeconds !== undefined) {
    assessment.sequencerGracePeriodRemainingSeconds =
      sequencerGracePeriodRemainingSeconds;
  }
  return assessment;
}
