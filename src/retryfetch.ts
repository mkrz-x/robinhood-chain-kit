/**
 * Retrying fetch for flaky upstreams (twitterapi.io in particular, which sits
 * behind Cloudflare and throws 520s + stalls under load). Production showed
 * these failures are transient bursts: a single retry usually lands, but every
 * call site was a bare fetch, so one 520 lost a whole tick's work.
 *
 * Contract mirrors withRpcRetry (collectors/rpc.ts) + HttpClient's status
 * logic (pipeline/http.ts): retry on thrown fetch/timeout errors and on
 * 408/429/5xx responses; any other non-ok response (definitive 4xx) is
 * returned immediately for the caller's existing `!res.ok` handling. The
 * timeout applies PER ATTEMPT, so worst case is attempts × timeoutMs plus
 * backoff — callers all run under `protect: true` crons, so overlap is safe.
 */
export interface FetchRetryOpts {
  /** per-attempt timeout in ms (an AbortSignal.timeout per try) */
  timeoutMs: number;
  /** total attempts including the first (default 3) */
  attempts?: number;
  /** injectable for tests, mirroring the fetchImpl params already used by
   * the social package's twitterapi.io modules */
  fetchImpl?: typeof fetch;
}

const RETRYABLE_STATUS = (s: number) => s === 408 || s === 429 || s >= 500;

export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit,
  opts: FetchRetryOpts,
): Promise<Response> {
  const attempts = opts.attempts ?? 3;
  const doFetch = opts.fetchImpl ?? fetch;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs) });
      if (!RETRYABLE_STATUS(res.status)) return res; // ok OR definitive 4xx — caller decides
      lastErr = new Error(`HTTP ${res.status}`);
      if (i === attempts - 1) return res; // out of budget: hand back the real response
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) throw lastErr;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  // unreachable (loop always returns or throws on the last attempt)
  throw lastErr;
}
