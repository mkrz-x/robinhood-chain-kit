/**
 * Adaptive getLogs paging for backfilling event history over a bounded RPC.
 *
 * Why this exists: indexing Robinhood Chain from genesis through a public RPC
 * hits two different failure modes that need OPPOSITE responses:
 *
 *  - "range too large" / "logs matched by query exceeds limit" — a SIZE
 *    problem. The window holds too many logs (dense late-chain ranges), so
 *    halve the span and retry.
 *  - HTTP 429 — a TIME problem. Halving makes it WORSE (more requests per
 *    block scanned); the right move is to cool off and retry the SAME span.
 *
 * And after a reduction, re-growing immediately ping-pongs (grow, fail,
 * halve, grow, fail...), burning ~half the request budget on guaranteed
 * failures — which is exactly what trips the rate limit in the first place.
 * So the span re-grows only after `regrowAfter` consecutive clean passes.
 *
 * All of this was learned the hard way running rhxbt.com's full-chain
 * swap index. Zero dependencies: you supply the getLogs function (viem,
 * ethers, raw JSON-RPC — anything that takes a block range).
 */

export interface PagedLogsOpts<T> {
  /** starting and maximum inclusive block count per request (default 10_000n) */
  chunkSize?: bigint;
  /** smallest block count before a size error is rethrown (default min(500n, chunkSize)) */
  minChunk?: bigint;
  /** consecutive clean passes at a reduced span before doubling back up (default 3) */
  regrowAfter?: number;
  /** cool-off before retrying the same span on a rate limit (default 30_000 ms) */
  cooldownMs?: number;
  /** retries permitted for one page after the first request (default 5) */
  maxRetries?: number;
  /** classify an error as a rate limit (default: /429|too many requests/i on the message) */
  isRateLimit?: (err: unknown) => boolean;
  /** classify an error as a response-size/range limit that should shrink the
   * current window. All other errors are fatal unless explicitly classified. */
  isRangeTooLarge?: (err: unknown) => boolean;
  /** called after every successful chunk — use for progress logs or streaming
   * consumption of huge ranges (pair with `collect: false`) */
  onPage?: (logs: T[], fromBlock: bigint, toBlock: bigint) => void | Promise<void>;
  /** set false to skip accumulating results (streaming via onPage); returns [] */
  collect?: boolean;
  /** injectable sleeper, for tests */
  sleep?: (ms: number) => Promise<void>;
  /** cancel before the next request or after a retry delay */
  signal?: AbortSignal;
}

/**
 * The rate-limit classifier `getLogsPaged` uses when `isRateLimit` is not
 * supplied. Exported so a caller can EXTEND it rather than replace it —
 * `isRateLimit: (err) => defaultIsRateLimit(err) || myProviderSaysSlowDown(err)`
 * — because replacing it silently drops the 429 handling this module was
 * built around.
 */
export const defaultIsRateLimit = (err: unknown): boolean =>
  /\b429\b|too many requests/i.test(err instanceof Error ? err.message : String(err));

/**
 * The provider error shapes recognized as "this window is too big", collected
 * from real RPC responses. Exported (frozen) so a caller hitting a provider
 * with a novel message can extend the classification instead of rebuilding
 * it: an unrecognized size error is FATAL by design — misclassifying a fatal
 * error as a size error would shrink-and-retry forever — so the fix for a new
 * provider is to add its pattern, not to loosen the default.
 */
export const DEFAULT_RANGE_TOO_LARGE_PATTERNS: readonly RegExp[] = Object.freeze([
  /\b(?:block )?range (?:is )?too (?:large|wide)\b/i,
  /\b(?:exceeds?|exceeded) (?:the )?(?:maximum|max|provider) (?:allowed )?(?:block )?range\b/i,
  /\b(?:maximum|max) (?:allowed )?(?:block )?range (?:is|of) [\d,]+\b/i,
  /\blimited to (?:a )?[\d,]+ blocks?(?: range)?\b/i,
  /\bresponse size (?:exceeds?|exceeded|is (?:too large|over (?:the )?limit))\b/i,
  /\bquery returned more than [\d,]+ (?:logs?|results?)\b/i,
  /\blogs matched by query exceeds? (?:the )?limit(?: of [\d,]+)?\b/i,
  /\bresults? exceeds? (?:the )?(?:maximum|max|provider) (?:allowed )?(?:limit|count)\b/i,
  /\blimit of [\d,]+ (?:logs?|results?)\b/i,
]);

/** The size classifier built from {@link DEFAULT_RANGE_TOO_LARGE_PATTERNS}. */
export const defaultIsRangeTooLarge = (err: unknown): boolean => {
  const message = err instanceof Error ? err.message : String(err);
  return DEFAULT_RANGE_TOO_LARGE_PATTERNS.some((pattern) => pattern.test(message));
};

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();

    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
    }
    function done() {
      cleanup();
      resolve();
    }
    function aborted() {
      cleanup();
      try {
        signal?.throwIfAborted();
      } catch (error) {
        reject(error);
      }
    }
  });

/**
 * Fetch logs over [fromBlock, toBlock] inclusive, adapting the request block
 * count to provider result limits. Fatal errors are rethrown immediately;
 * rate limits retry the same page within `maxRetries`; recognized size errors
 * shrink to `minChunk`. Resolves with every page in order (or [] when
 * `collect: false`).
 */
export async function getLogsPaged<T>(
  getLogs: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  fromBlock: bigint,
  toBlock: bigint,
  opts: PagedLogsOpts<T> = {},
): Promise<T[]> {
  const chunk = opts.chunkSize ?? 10_000n;
  const minChunk = opts.minChunk ?? (chunk < 500n ? chunk : 500n);
  const regrowAfter = opts.regrowAfter ?? 3;
  const cooldownMs = opts.cooldownMs ?? 30_000;
  const maxRetries = opts.maxRetries ?? 5;
  if (fromBlock < 0n || toBlock < 0n) {
    throw new RangeError("fromBlock and toBlock must be non-negative");
  }
  if (chunk <= 0n) throw new RangeError("chunkSize must be greater than zero");
  if (minChunk <= 0n) throw new RangeError("minChunk must be greater than zero");
  if (minChunk > chunk) throw new RangeError("minChunk cannot exceed chunkSize");
  if (!Number.isInteger(regrowAfter) || regrowAfter < 1) {
    throw new RangeError("regrowAfter must be a positive integer");
  }
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new RangeError("cooldownMs must be a non-negative finite number");
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError("maxRetries must be a non-negative integer");
  }
  const isRateLimit = opts.isRateLimit ?? defaultIsRateLimit;
  const isRangeTooLarge = opts.isRangeTooLarge ?? defaultIsRangeTooLarge;
  const sleep = opts.sleep ?? ((ms: number) => defaultSleep(ms, opts.signal));
  const collect = opts.collect ?? true;

  const out: T[] = [];
  let start = fromBlock;
  let span = chunk;
  let streak = 0; // consecutive successes at reduced span before re-growing
  while (start <= toBlock) {
    opts.signal?.throwIfAborted();
    const end = start + span - 1n < toBlock ? start + span - 1n : toBlock;
    let retries = 0;
    let logs: T[] | undefined;
    while (true) {
      opts.signal?.throwIfAborted();
      try {
        logs = await getLogs(start, end);
        break;
      } catch (err) {
        streak = 0;
        if (isRateLimit(err)) {
          if (retries >= maxRetries) throw err;
          retries += 1;
          await sleep(cooldownMs); // time problem: same span, later
          opts.signal?.throwIfAborted();
          continue;
        }
        if (isRangeTooLarge(err) && span > minChunk) {
          const halved = span / 2n;
          span = halved < minChunk ? minChunk : halved; // size problem: smaller window, now
          break;
        }
        throw err;
      }
    }
    if (logs === undefined) continue;
    if (opts.onPage) await opts.onPage(logs, start, end);
    if (collect) out.push(...logs);
    start = end + 1n;
    streak += 1;
    if (span < chunk && streak >= regrowAfter) {
      span = span * 2n > chunk ? chunk : span * 2n;
      streak = 0;
    }
  }
  return out;
}
