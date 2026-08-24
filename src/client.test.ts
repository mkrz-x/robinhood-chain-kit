import { describe, expect, it } from "vitest";
import {
  describeCallFailure,
  executeContractCalls,
  type MinimalContractCall,
  type MinimalPublicClient,
} from "./client.js";

const call = (functionName: string): MinimalContractCall => ({
  address: "0x1111111111111111111111111111111111111111",
  abi: [],
  functionName,
});

describe("executeContractCalls prefers multicall and never depends on it", () => {
  it("routes through multicall when the client has one", async () => {
    let readContractCalls = 0;
    const client: MinimalPublicClient = {
      readContract: async () => {
        readContractCalls += 1;
        return 0n;
      },
      multicall: async ({ contracts }) =>
        contracts.map((contract) => ({
          status: "success" as const,
          result: `via-multicall:${contract.functionName}`,
        })),
    };
    const results = await executeContractCalls(client, [call("a"), call("b")]);
    expect(results).toEqual([
      { status: "success", result: "via-multicall:a" },
      { status: "success", result: "via-multicall:b" },
    ]);
    expect(readContractCalls).toBe(0);
  });

  it("chunks large batches instead of building one oversized aggregate", async () => {
    const batchSizes: number[] = [];
    const client: MinimalPublicClient = {
      readContract: async () => 0n,
      multicall: async ({ contracts }) => {
        batchSizes.push(contracts.length);
        return contracts.map(() => ({ status: "success" as const, result: 1n }));
      },
    };
    const calls = Array.from({ length: 650 }, (_, i) => call(`f${i}`));
    const results = await executeContractCalls(client, calls);
    expect(results).toHaveLength(650);
    expect(batchSizes).toEqual([300, 300, 50]);
  });

  it("keeps per-call failures in their slots rather than failing the batch", async () => {
    const client: MinimalPublicClient = {
      readContract: async () => 0n,
      multicall: async ({ contracts }) =>
        contracts.map((contract, index) =>
          index === 1
            ? { status: "failure" as const, error: new Error(`no ${contract.functionName}`) }
            : { status: "success" as const, result: 7n },
        ),
    };
    const results = await executeContractCalls(client, [call("a"), call("b"), call("c")]);
    expect(results[0]).toEqual({ status: "success", result: 7n });
    expect(results[1]!.status).toBe("failure");
    expect(describeCallFailure(results[1]!)).toBe("no b");
    expect(results[2]).toEqual({ status: "success", result: 7n });
  });

  it("falls back to sequential reads when multicall rejects wholesale", async () => {
    // a viem client whose chain has no multicall3 contract throws from the
    // multicall action itself; batching is an optimization, not a dependency
    const order: string[] = [];
    const client: MinimalPublicClient = {
      readContract: async ({ functionName }) => {
        order.push(functionName);
        return `sequential:${functionName}`;
      },
      multicall: async () => {
        throw new Error("chain does not support contract multicall3");
      },
    };
    const results = await executeContractCalls(client, [call("a"), call("b")]);
    expect(results).toEqual([
      { status: "success", result: "sequential:a" },
      { status: "success", result: "sequential:b" },
    ]);
    expect(order).toEqual(["a", "b"]);
  });

  it("falls back when multicall returns a result of the wrong length", async () => {
    // a misaligned multicall response is the silent-wrong-answer case: slot N
    // would be read as call N+1's result. Refuse and re-read sequentially.
    const client: MinimalPublicClient = {
      readContract: async ({ functionName }) => `sequential:${functionName}`,
      multicall: async () => [{ status: "success" as const, result: 1n }],
    };
    const results = await executeContractCalls(client, [call("a"), call("b")]);
    expect(results).toEqual([
      { status: "success", result: "sequential:a" },
      { status: "success", result: "sequential:b" },
    ]);
  });

  it("reads sequentially and isolates failures without a multicall", async () => {
    const client: MinimalPublicClient = {
      readContract: async ({ functionName }) => {
        if (functionName === "b") throw new Error("revert: b");
        return `ok:${functionName}`;
      },
    };
    const results = await executeContractCalls(client, [call("a"), call("b"), call("c")]);
    expect(results[0]).toEqual({ status: "success", result: "ok:a" });
    expect(results[1]!.status).toBe("failure");
    expect(describeCallFailure(results[1]!)).toBe("revert: b");
    expect(results[2]).toEqual({ status: "success", result: "ok:c" });
  });

  it("resolves an empty batch without touching the client", async () => {
    const client: MinimalPublicClient = {
      readContract: async () => {
        throw new Error("should not be called");
      },
    };
    expect(await executeContractCalls(client, [])).toEqual([]);
  });
});
