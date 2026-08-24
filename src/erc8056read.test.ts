import { describe, expect, it } from "vitest";
import {
  readOraclePauseState,
  readScaledUiMultiplierState,
  readScaledUiMultiplierStates,
} from "./erc8056read.js";
import { SCALED_UI_ONE } from "./stocktokens.js";
import type { MinimalContractCall, MinimalPublicClient } from "./client.js";

const AAPL = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9";
const TSLA = "0x1111111111111111111111111111111111111111";

/** A client whose stock tokens answer the three reads from a table. */
const tokenClient = (
  tokens: Record<string, { uiMultiplier: bigint; newUIMultiplier: bigint; effectiveAt: bigint }>,
): MinimalPublicClient => ({
  readContract: async ({ address, functionName }: MinimalContractCall) => {
    const token = tokens[address.toLowerCase()];
    if (!token) throw new Error(`execution reverted at ${address}`);
    const value = token[functionName as keyof typeof token];
    if (value === undefined) throw new Error(`execution reverted: ${functionName}`);
    return value;
  },
});

describe("readScaledUiMultiplierState executes the calls the kit only used to describe", () => {
  it("returns typed bigints and the resolved schedule", async () => {
    const client = tokenClient({
      [AAPL.toLowerCase()]: {
        uiMultiplier: 1000566080061092436n,
        newUIMultiplier: 1000566080061092436n,
        effectiveAt: 1_700_000_000n,
      },
    });
    const state = await readScaledUiMultiplierState(client, AAPL, {
      nowSeconds: 1_800_000_000,
    });
    expect(state.token).toBe(AAPL);
    expect(state.uiMultiplier).toBe(1000566080061092436n);
    expect(state.newUiMultiplier).toBe(1000566080061092436n);
    expect(state.effectiveAt).toBe(1_700_000_000n);
    expect(state.state).toEqual({
      current: 1000566080061092436n,
      pending: 1000566080061092436n,
      effectiveAtSeconds: 1_700_000_000n,
    });
    expect(state.schedule).toEqual({
      status: "applied",
      multiplier: 1000566080061092436n,
      effectiveAtSeconds: 1_700_000_000,
    });
  });

  it("resolves a pending corporate action without promoting the pending value", async () => {
    const client = tokenClient({
      [TSLA.toLowerCase()]: {
        uiMultiplier: SCALED_UI_ONE,
        newUIMultiplier: 4n * SCALED_UI_ONE,
        effectiveAt: 2_000n,
      },
    });
    const state = await readScaledUiMultiplierState(client, TSLA, { nowSeconds: 1_000 });
    expect(state.schedule).toEqual({
      status: "pending",
      multiplier: SCALED_UI_ONE,
      pending: 4n * SCALED_UI_ONE,
      effectiveAtSeconds: 2_000,
    });
  });

  it("uses one multicall for all three reads when the client has one", async () => {
    let batches = 0;
    const client: MinimalPublicClient = {
      readContract: async () => {
        throw new Error("should have used multicall");
      },
      multicall: async ({ contracts }) => {
        batches += 1;
        expect(contracts.map((contract) => contract.functionName)).toEqual([
          "uiMultiplier",
          "newUIMultiplier",
          "effectiveAt",
        ]);
        return [
          { status: "success", result: SCALED_UI_ONE },
          { status: "success", result: SCALED_UI_ONE },
          { status: "success", result: 0n },
        ];
      },
    };
    const state = await readScaledUiMultiplierState(client, TSLA, { nowSeconds: 1 });
    expect(batches).toBe(1);
    expect(state.schedule).toEqual({ status: "none", multiplier: SCALED_UI_ONE });
  });

  it("throws when any read fails: an unreadable multiplier never defaults to 1", async () => {
    const client = tokenClient({});
    await expect(readScaledUiMultiplierState(client, TSLA)).rejects.toThrow(
      /uiMultiplier\(\) failed/,
    );
  });

  it("throws when a read returns a non-uint256", async () => {
    const client: MinimalPublicClient = {
      readContract: async () => "1000000000000000000",
    };
    await expect(readScaledUiMultiplierState(client, TSLA)).rejects.toThrow(
      /did not return a uint256/,
    );
  });

  it("rejects a malformed token address before touching the client", async () => {
    const client = tokenClient({});
    await expect(readScaledUiMultiplierState(client, "0xdead")).rejects.toThrow(TypeError);
  });
});

describe("readScaledUiMultiplierStates isolates per-token failures", () => {
  it("one token that is not a stock token does not sink the batch", async () => {
    const client = tokenClient({
      [AAPL.toLowerCase()]: {
        uiMultiplier: SCALED_UI_ONE,
        newUIMultiplier: SCALED_UI_ONE,
        effectiveAt: 0n,
      },
    });
    const results = await readScaledUiMultiplierStates(client, [AAPL, TSLA], {
      nowSeconds: 1,
    });
    expect(results).toHaveLength(2);
    expect(results[0]!.status).toBe("success");
    if (results[0]!.status === "success") {
      expect(results[0]!.state.schedule).toEqual({ status: "none", multiplier: SCALED_UI_ONE });
    }
    expect(results[1]).toMatchObject({ status: "error", token: TSLA });
  });

  it("keeps results in input order across multicall chunks", async () => {
    const tokens = Array.from(
      { length: 150 },
      (_, index) => `0x${String(index).padStart(40, "0")}`,
    );
    const client: MinimalPublicClient = {
      readContract: async () => 0n,
      multicall: async ({ contracts }) =>
        contracts.map((contract) => ({
          status: "success" as const,
          result:
            contract.functionName === "effectiveAt"
              ? 0n
              : BigInt(Number.parseInt(contract.address.slice(-4), 10)) * SCALED_UI_ONE,
        })),
    };
    const results = await readScaledUiMultiplierStates(client, tokens, { nowSeconds: 1 });
    expect(results).toHaveLength(150);
    for (const [index, result] of results.entries()) {
      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.state.uiMultiplier).toBe(BigInt(index) * SCALED_UI_ONE);
      }
    }
  });
});

describe("readOraclePauseState fails closed on tokens without the method", () => {
  const pauseClient = (result: unknown, reverts = false): MinimalPublicClient => ({
    readContract: async ({ functionName }) => {
      expect(functionName).toBe("oraclePaused");
      if (reverts) throw new Error("execution reverted");
      return result;
    },
  });

  it("maps false to active and true to paused", async () => {
    expect(await readOraclePauseState(pauseClient(false), AAPL)).toBe("active");
    expect(await readOraclePauseState(pauseClient(true), AAPL)).toBe("paused");
  });

  it("maps a revert to unknown, never throwing — USDG reverts on this selector", async () => {
    expect(await readOraclePauseState(pauseClient(undefined, true), AAPL)).toBe("unknown");
  });

  it("maps a non-boolean answer to unknown rather than truthiness", async () => {
    expect(await readOraclePauseState(pauseClient(1n), AAPL)).toBe("unknown");
    expect(await readOraclePauseState(pauseClient("false"), AAPL)).toBe("unknown");
  });

  it("throws only on an invalid address argument — that is a caller bug", async () => {
    await expect(readOraclePauseState(pauseClient(false), "not-an-address")).rejects.toThrow(
      TypeError,
    );
  });
});
