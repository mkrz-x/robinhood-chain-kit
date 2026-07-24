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
  /** starting and maximum span per request (default 10_000n — the common public-RPC cap) */
  chunkSize?: bigint;
  /** smallest span before the error is rethrown as fatal (default 500n) */
  minChunk?: bigint;
  /** consecutive clean passes at a reduced span before doubling back up (default 3) */
  regrowAfter?: number;
  /** cool-off before retrying the same span on a rate limit (default 30_000 ms) */
  cooldownMs?: number;
  /** classify an error as a rate limit (default: /429|too many requests/i on the message) */
  isRateLimit?: (err: unknown) => boolean;
  /** called after every successful chunk — use for progress logs or streaming
   * consumption of huge ranges (pair with `collect: false`) */
  onPage?: (logs: T[], fromBlock: bigint, toBlock: bigint) => void | Promise<void>;
  /** set false to skip accumulating results (streaming via onPage); returns [] */
  collect?: boolean;
  /** injectable sleeper, for tests */
  sleep?: (ms: number) => Promise<void>;
}

const defaultIsRateLimit = (err: unknown): boolean =>
  /\b429\b|too many requests/i.test(err instanceof Error ? err.message : String(err));

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Fetch logs over [fromBlock, toBlock] inclusive, adapting the request span
 * to whatever the provider will actually serve. Resolves with every log in
 * block order (or [] when `collect: false`); rejects only when a non-rate-limit
 * error persists at the minimum span.
 */
export async function getLogsPaged<T>(
  getLogs: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  fromBlock: bigint,
  toBlock: bigint,
  opts: PagedLogsOpts<T> = {},
): Promise<T[]> {
  const chunk = opts.chunkSize ?? 10_000n;
  const minChunk = opts.minChunk ?? 500n;
  const regrowAfter = opts.regrowAfter ?? 3;
  const cooldownMs = opts.cooldownMs ?? 30_000;
  const isRateLimit = opts.isRateLimit ?? defaultIsRateLimit;
  const sleep = opts.sleep ?? defaultSleep;
  const collect = opts.collect ?? true;

  const out: T[] = [];
  let start = fromBlock;
  let span = chunk;
  let streak = 0; // consecutive successes at reduced span before re-growing
  while (start <= toBlock) {
    const end = start + span < toBlock ? start + span : toBlock;
    try {
      const logs = await getLogs(start, end);
      if (collect) out.push(...logs);
      if (opts.onPage) await opts.onPage(logs, start, end);
      start = end + 1n;
      streak += 1;
      if (span < chunk && streak >= regrowAfter) {
        span = span * 2n > chunk ? chunk : span * 2n;
        streak = 0;
      }
    } catch (err) {
      streak = 0;
      if (isRateLimit(err)) {
        await sleep(cooldownMs); // time problem: same span, later
        continue;
      }
      if (span > minChunk) {
        span = span / 2n; // size problem: smaller window, now
        continue;
      }
      throw err;
    }
  }
  return out;
}
