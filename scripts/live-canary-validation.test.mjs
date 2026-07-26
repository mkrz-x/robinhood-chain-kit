import { describe, expect, it } from "vitest";
import {
  validateBlockscoutStats,
  validateEtherscanBlockNumber,
} from "./live-canary-validation.mjs";

describe("live canary explorer validation", () => {
  it("accepts the documented explorer response shapes", () => {
    expect(
      validateEtherscanBlockNumber({ jsonrpc: "2.0", id: 1, result: "0x12eb1b0" }),
    ).toBe("0x12eb1b0");
    expect(
      validateBlockscoutStats({
        total_blocks: "19835627",
        total_transactions: "163188188",
        total_addresses: "4253870",
      }),
    ).toMatchObject({ totalBlocks: 19_835_627n, totalTransactions: 163_188_188n });
  });

  it.each([
    ["Etherscan JSON-level error", () => validateEtherscanBlockNumber({ status: "0", result: "error" })],
    ["Etherscan malformed result", () => validateEtherscanBlockNumber({ result: "latest" })],
    ["Blockscout missing totals", () => validateBlockscoutStats({})],
    [
      "Blockscout malformed totals",
      () => validateBlockscoutStats({ total_blocks: "many", total_transactions: "10" }),
    ],
  ])("rejects %s even when HTTP succeeded", (_label, validate) => {
    expect(validate).toThrow();
  });
});
