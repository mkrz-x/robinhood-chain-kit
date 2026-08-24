/**
 * Executed ERC-8056 readers: the on-ramp from "here are the calls" to "here is
 * the state".
 *
 * The failure mode this module closes: 0.8.x exported `getErc8056ReadCalls`
 * but nothing that executed them, so every consumer wrote the same ten lines —
 * run three reads, hope the three results line up with the three calls, cast
 * `unknown` to `bigint`, assemble the object `resolveScaledUiMultiplier`
 * wants. Each of those steps has a silent-wrong-answer version (results
 * misaligned with calls after a partial failure is the worst one), and the
 * whole point of this package is that silent wrong answers about multipliers
 * are financial errors.
 *
 * Everything here takes a `MinimalPublicClient` — any viem `PublicClient`
 * satisfies it structurally, and the kit still imports nothing.
 */
import {
  describeCallFailure,
  executeContractCalls,
  type MinimalContractCall,
  type MinimalPublicClient,
} from "./client.js";
import {
  ERC8056_ABI,
  getErc8056ReadCalls,
  resolveScaledUiMultiplier,
  type ScaledUiMultiplierState,
  type ScaledUiSchedule,
} from "./stocktokens.js";
import type { OraclePauseState } from "./feeds.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * A stock token's authoritative multiplier state, read from the contract.
 *
 * `state` is the exact input `resolveScaledUiMultiplier` takes; `schedule` is
 * that resolution already applied at read time. Prefer `schedule.multiplier`
 * for display and calculation — it is the contract's own `uiMultiplier()`, and
 * `schedule.status` says whether a figure computed from it is currently safe.
 */
export interface ScaledUiState {
  token: `0x${string}`;
  /** `uiMultiplier()` — the current multiplier, authoritative */
  uiMultiplier: bigint;
  /** `newUIMultiplier()` — the scheduled value, NOT the current one */
  newUiMultiplier: bigint;
  /** `effectiveAt()` — unix seconds; 0 means nothing was ever scheduled */
  effectiveAt: bigint;
  /** ready-to-feed input for `resolveScaledUiMultiplier` */
  state: ScaledUiMultiplierState;
  /** `resolveScaledUiMultiplier(state, now)` applied at read time */
  schedule: ScaledUiSchedule;
}

export type ScaledUiStateResult =
  | { status: "success"; state: ScaledUiState }
  | { status: "error"; token: `0x${string}`; error: string };

export interface ReadScaledUiOptions {
  /** clock for schedule resolution, unix seconds (default: now) */
  nowSeconds?: number;
}

const asUint256 = (value: unknown, token: string, functionName: string): bigint => {
  if (typeof value !== "bigint" || value < 0n) {
    throw new TypeError(`${functionName}() on ${token} did not return a uint256`);
  }
  return value;
};

const assembleState = (
  token: `0x${string}`,
  results: readonly { status: "success" | "failure"; result?: unknown; error?: unknown }[],
  calls: readonly { functionName: string }[],
  nowSeconds: number,
): ScaledUiState => {
  const values: bigint[] = [];
  for (const [index, entry] of results.entries()) {
    const functionName = calls[index]!.functionName;
    if (entry.status !== "success") {
      throw new Error(
        `${functionName}() failed on ${token}: ${describeCallFailure(entry)} — a revert here means this deployment is not a standard stock token, not that the call is wrong`,
      );
    }
    values.push(asUint256(entry.result, token, functionName));
  }
  const [uiMultiplier, newUiMultiplier, effectiveAt] = values as [bigint, bigint, bigint];
  const state: ScaledUiMultiplierState = {
    current: uiMultiplier,
    pending: newUiMultiplier,
    effectiveAtSeconds: effectiveAt,
  };
  return {
    token,
    uiMultiplier,
    newUiMultiplier,
    effectiveAt,
    state,
    schedule: resolveScaledUiMultiplier(state, nowSeconds),
  };
};

const resolveNow = (options: ReadScaledUiOptions | undefined): number => {
  const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(now) || now < 0) {
    throw new RangeError("nowSeconds must be a non-negative finite number");
  }
  return now;
};

/**
 * Execute the three authoritative multiplier reads for one stock token.
 *
 * Uses `multicall` when the client has one (all three values then come from
 * one block, which matters around an `effectiveAt` boundary) and falls back to
 * sequential `readContract` calls otherwise. Throws when any read fails or
 * returns a non-uint256: an unreadable multiplier must never quietly become a
 * default of 1.
 */
export async function readScaledUiMultiplierState(
  client: MinimalPublicClient,
  token: string,
  options: ReadScaledUiOptions = {},
): Promise<ScaledUiState> {
  const nowSeconds = resolveNow(options);
  const calls = getErc8056ReadCalls(token);
  const results = await executeContractCalls(client, calls);
  return assembleState(token as `0x${string}`, results, calls, nowSeconds);
}

/**
 * The batched variant: one multicall-chunked pass over many tokens.
 *
 * Per-token failures are isolated — one token that is not a stock token
 * reports `status: "error"` in its slot and the other 193 still resolve.
 * Results are in input order.
 */
export async function readScaledUiMultiplierStates(
  client: MinimalPublicClient,
  tokens: readonly string[],
  options: ReadScaledUiOptions = {},
): Promise<ScaledUiStateResult[]> {
  const nowSeconds = resolveNow(options);
  const perToken = tokens.map((token) => getErc8056ReadCalls(token));
  const flat: MinimalContractCall[] = perToken.flat();
  const results = await executeContractCalls(client, flat);
  return perToken.map((calls, index) => {
    const token = tokens[index] as `0x${string}`;
    const slice = results.slice(index * 3, index * 3 + 3);
    try {
      return { status: "success", state: assembleState(token, slice, calls, nowSeconds) };
    } catch (error) {
      return {
        status: "error",
        token,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

/**
 * Read a stock token's corporate-action oracle pause flag.
 *
 * `oraclePaused()` is on the TOKEN, not the feed — documented on the official
 * oracles page and verified by eth_call on chain 4663 (see the ABI member's
 * note). Fails closed, never throws on a token without the method: a plain
 * ERC-20 reverts on this selector, and "this token has no pause flag I can
 * read" is `"unknown"`, which `assessOracleHealth` correctly refuses to trust.
 * Reserve `"not-applicable"` for assets you KNOW have no corporate-action
 * pauses; this function cannot know that for you.
 *
 * Throws only on an invalid address argument — that is a caller bug, not an
 * on-chain condition.
 */
export async function readOraclePauseState(
  client: MinimalPublicClient,
  token: string,
): Promise<OraclePauseState> {
  if (typeof token !== "string" || !ADDRESS.test(token)) {
    throw new TypeError(`Invalid token address: ${token}`);
  }
  try {
    const result = await client.readContract({
      address: token as `0x${string}`,
      abi: ERC8056_ABI,
      functionName: "oraclePaused",
    });
    if (result === true) return "paused";
    if (result === false) return "active";
    return "unknown";
  } catch {
    return "unknown";
  }
}
