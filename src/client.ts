/**
 * The minimal client surface the kit's executed readers need — and the reason
 * this package still has zero runtime dependencies.
 *
 * The failure mode this exists to prevent: a library that imports viem to run
 * three `eth_call`s forces viem's version, bundle, and release cadence on every
 * consumer, including the ones using ethers or raw JSON-RPC. So the kit never
 * imports a client. It declares the two methods it calls, structurally, and any
 * viem `PublicClient` satisfies the shape without either package knowing about
 * the other. An ethers or hand-rolled client works too, as long as it answers
 * `readContract` the same way.
 *
 * `multicall` is optional. When present (and working) the readers batch through
 * it; when absent or failing they fall back to sequential `readContract` calls,
 * so a client without Multicall3 configured degrades to more round trips, never
 * to a different answer.
 */

/** One viem-style contract call: address + ABI + function, no client types. */
export interface MinimalContractCall {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

/** One viem-style `allowFailure: true` multicall slot result. */
export interface MinimalMulticallResult {
  status: "success" | "failure";
  result?: unknown;
  error?: unknown;
}

/**
 * Structural subset of a viem `PublicClient`. Any viem public client satisfies
 * this without the kit importing viem; so does anything else that can execute
 * a read call from a JSON ABI.
 *
 * `multicall` is declared loosely on purpose — `allowFailure` optional in the
 * parameter, `unknown` out — because viem's own `multicall` is a generic whose
 * parameter demands a branded `Abi`, and a tighter declaration here would
 * reject the very clients this interface exists to accept. The kit always
 * CALLS it with `allowFailure: true` and validates the result's shape at
 * runtime before trusting a single slot.
 */
export interface MinimalPublicClient {
  readContract(args: MinimalContractCall): Promise<unknown>;
  multicall?(args: {
    contracts: readonly MinimalContractCall[];
    allowFailure?: boolean;
  }): Promise<unknown>;
}

/** Multicall batches are chunked so one huge token list cannot build a single
 * oversized `eth_call`; 300 calls per aggregate stays far below every public
 * RPC's calldata and gas ceilings. */
const MULTICALL_CHUNK = 300;

const errorText = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 300) || "call failed";
};

/**
 * Execute calls through `multicall` when the client has one, sequentially
 * otherwise. Never throws for a failing individual call — each slot reports
 * `status: "failure"` with the error text, because a batched reader must be
 * able to say WHICH token or feed failed rather than losing the whole batch.
 *
 * A client whose `multicall` method exists but rejects wholesale (no
 * Multicall3 on the chain object, transport that cannot batch) falls back to
 * sequential reads instead of failing: the batching is an optimization, not a
 * correctness dependency.
 */
export async function executeContractCalls(
  client: MinimalPublicClient,
  calls: readonly MinimalContractCall[],
): Promise<MinimalMulticallResult[]> {
  if (calls.length === 0) return [];
  if (typeof client.multicall === "function") {
    try {
      const results: MinimalMulticallResult[] = [];
      for (let start = 0; start < calls.length; start += MULTICALL_CHUNK) {
        const chunk = calls.slice(start, start + MULTICALL_CHUNK);
        const settled: unknown = await client.multicall({
          contracts: chunk,
          allowFailure: true,
        });
        if (!Array.isArray(settled) || settled.length !== chunk.length) {
          throw new TypeError("multicall returned a result of the wrong length");
        }
        for (const value of settled) {
          const entry = value as MinimalMulticallResult | null;
          if (
            typeof entry !== "object" ||
            entry === null ||
            (entry.status !== "success" && entry.status !== "failure")
          ) {
            throw new TypeError("multicall returned a slot without a status");
          }
          results.push(
            entry.status === "success"
              ? { status: "success", result: entry.result }
              : { status: "failure", error: entry.error },
          );
        }
      }
      return results;
    } catch {
      // fall through to sequential reads; batching is best-effort
    }
  }
  const sequential: MinimalMulticallResult[] = [];
  for (const call of calls) {
    try {
      sequential.push({ status: "success", result: await client.readContract(call) });
    } catch (error) {
      sequential.push({ status: "failure", error });
    }
  }
  return sequential;
}

/** Failure text for a slot, bounded, for error messages that name the call. */
export function describeCallFailure(entry: MinimalMulticallResult): string {
  return errorText(entry.error);
}
