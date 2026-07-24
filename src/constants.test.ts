import { describe, expect, it } from "vitest";
import { CHAIN_ID, EXPLORER_URL, RPC_URL, SEQUENCER_FEED_WS, robinhoodChain } from "./chain.js";
import {
  DEPOSIT_INITIATED_EVENT,
  L1_BRIDGE,
  L1_GATEWAYS,
  L1_OUTBOX,
  WITHDRAWAL_FINALIZED_EVENT,
} from "./bridge.js";
import { DEX_EVENTS } from "./dex.js";

const ADDR = /^0x[0-9a-fA-F]{40}$/;

describe("chain constants", () => {
  it("pin the canonical values", () => {
    expect(CHAIN_ID).toBe(4663);
    expect(RPC_URL).toMatch(/^https:\/\//);
    expect(SEQUENCER_FEED_WS).toMatch(/^wss:\/\//);
    expect(EXPLORER_URL).toMatch(/^https:\/\//);
    expect(robinhoodChain.id).toBe(CHAIN_ID);
    expect(robinhoodChain.rpcUrls.default.http[0]).toBe(RPC_URL);
  });
});

describe("bridge constants", () => {
  it("every contract is a well-formed address", () => {
    for (const a of [L1_BRIDGE, L1_OUTBOX, ...L1_GATEWAYS]) expect(a).toMatch(ADDR);
    expect(new Set(L1_GATEWAYS).size).toBe(3);
  });
  it("event strings are parseAbiItem-ready", () => {
    for (const e of [DEPOSIT_INITIATED_EVENT, WITHDRAWAL_FINALIZED_EVENT, ...DEX_EVENTS])
      expect(e).toMatch(/^event [A-Z]\w+\(/);
  });
});
