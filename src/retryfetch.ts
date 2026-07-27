/**
 * Retrying fetch for transient HTTP failures.
 *
 * Retries thrown network/per-attempt-timeout failures and 408/429/5xx
 * responses. Definitive 4xx responses are returned immediately. POST/PATCH
 * requests are attempted once unless `retryUnsafeMethods` is explicitly set;
 * callers should use that option only with an idempotency key or equivalent.
 * Retryable one-shot bodies require `bodyFactory` so every attempt gets a
 * fresh stream or async iterable.
 * The caller's AbortSignal always wins over per-attempt timeouts and backoff.
 */
export interface FetchRetryOpts {
  /** per-attempt timeout in ms (an AbortSignal.timeout per try) */
  timeoutMs: number;
  /** total attempts including the first (default 3) */
  attempts?: number;
  /** permit retries for non-idempotent methods such as POST/PATCH (default false).
   * Use only when the operation is protected by an idempotency key or equivalent. */
  retryUnsafeMethods?: boolean;
  /** initial exponential-backoff delay in ms (default 500) */
  baseDelayMs?: number;
  /** maximum backoff or Retry-After delay in ms (default 30_000) */
  maxDelayMs?: number;
  /** proportional random jitter from 0 to 1 (default 0.2) */
  jitter?: number;
  /** injectable for tests, mirroring the fetchImpl params already used by
   * the social package's twitterapi.io modules */
  fetchImpl?: typeof fetch;
  /** injectable sleeper and random source for deterministic tests */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /**
   * Create a fresh body for every attempt. Required when a retryable request
   * uses a one-shot stream or async iterable; do not also set init.body.
   */
  bodyFactory?: () => BodyInit | null;
}

const RETRYABLE_STATUS = (s: number) => s === 408 || s === 429 || s >= 500;
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);
const isOneShotBody = (body: BodyInit | null | undefined) =>
  (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) ||
  (typeof body === "object" &&
    body !== null &&
    (("getReader" in body && typeof body.getReader === "function") ||
      (Symbol.asyncIterator in body &&
        typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
          "function")));
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

const retryAfterMs = (response: Response): number | undefined => {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
};

const validateOptions = (
  timeoutMs: number,
  attempts: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: number,
) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a positive finite number");
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError("attempts must be a positive integer");
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new RangeError("baseDelayMs must be a non-negative finite number");
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < 0) {
    throw new RangeError("maxDelayMs must be a non-negative finite number");
  }
  if (baseDelayMs > maxDelayMs) {
    throw new RangeError("baseDelayMs cannot exceed maxDelayMs");
  }
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
    throw new RangeError("jitter must be between 0 and 1");
  }
};

export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit,
  opts: FetchRetryOpts,
): Promise<Response> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const jitter = opts.jitter ?? 0.2;
  validateOptions(opts.timeoutMs, attempts, baseDelayMs, maxDelayMs, jitter);

  const method = (init.method ?? "GET").toUpperCase();
  const allowedAttempts =
    opts.retryUnsafeMethods || IDEMPOTENT_METHODS.has(method) ? attempts : 1;
  if (opts.bodyFactory !== undefined && typeof opts.bodyFactory !== "function") {
    throw new TypeError("bodyFactory must be a function");
  }
  if (opts.bodyFactory && init.body != null) {
    throw new TypeError("Set bodyFactory or init.body, not both");
  }
  if (allowedAttempts > 1 && !opts.bodyFactory && isOneShotBody(init.body)) {
    throw new TypeError("Retrying a streamed body requires bodyFactory");
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => defaultSleep(ms, init.signal ?? undefined));
  const random = opts.random ?? Math.random;
  let lastErr: unknown;
  for (let i = 0; i < allowedAttempts; i++) {
    init.signal?.throwIfAborted();
    const attemptBody = opts.bodyFactory ? opts.bodyFactory() : init.body;
    let discardedResponse: Response | undefined;
    let serverDelayMs: number | undefined;
    try {
      const timeoutSignal = AbortSignal.timeout(opts.timeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
      const res = await doFetch(url, { ...init, body: attemptBody, signal });
      if (!RETRYABLE_STATUS(res.status)) return res; // ok OR definitive 4xx — caller decides
      lastErr = new Error(`HTTP ${res.status}`);
      if (i === allowedAttempts - 1) return res; // out of budget: hand back the real response
      discardedResponse = res;
      serverDelayMs = retryAfterMs(res);
    } catch (err) {
      init.signal?.throwIfAborted();
      lastErr = err;
      if (i === allowedAttempts - 1) throw lastErr;
    }
    if (discardedResponse?.body) {
      await discardedResponse.body.cancel().catch(() => undefined);
    }
    const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** i);
    const sample = random();
    const boundedSample = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0.5;
    const jitteredDelay = exponentialDelay * (1 - jitter + 2 * jitter * boundedSample);
    const delay = Math.min(maxDelayMs, Math.max(serverDelayMs ?? 0, jitteredDelay));
    await sleep(delay);
    init.signal?.throwIfAborted();
  }
  // unreachable (loop always returns or throws on the last attempt)
  throw lastErr;
}
