import { describe, expect, it } from "vitest";
import {
  CHAIN_ID,
  EXPLORER_API_URL,
  EXPLORER_URL,
  RPC_URL,
  SEQUENCER_FEED_WS,
  robinhoodChain,
} from "./chain.js";
import {
  DEPOSIT_INITIATED_EVENT,
  L1_BRIDGE,
  L1_GATEWAYS,
  L1_OUTBOX,
  WITHDRAWAL_FINALIZED_EVENT,
} from "./bridge.js";
import { DEX_EVENTS, V4_INITIALIZE_EVENT, V4_NATIVE_CURRENCY, V4_SWAP_EVENT } from "./dex.js";
import { CHAINLINK_FEED_DIRECTORY_URL } from "./feeds.js";

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
  it("carries the Blockscout API url and multicall3, viem-shaped", () => {
    // a client built from this chain object can multicall and hit the REST API
    expect(EXPLORER_API_URL).toBe(`${EXPLORER_URL}/api/v2`);
    expect(robinhoodChain.blockExplorers.default.apiUrl).toBe(EXPLORER_API_URL);
    expect(robinhoodChain.contracts.multicall3.address).toBe(
      "0xcA11bde05977b3631167028862bE2a173976CA11",
    );
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

describe("dex V4", () => {
  it("the singleton PoolManager events are present and pool-id keyed", () => {
    // V4 has no per-pool contracts: everything is keyed by the bytes32 id
    expect(V4_INITIALIZE_EVENT).toContain("bytes32 indexed id");
    expect(V4_SWAP_EVENT).toContain("bytes32 indexed id");
    expect(V4_SWAP_EVENT).toContain("int128 amount0");
    expect(DEX_EVENTS).toContain(V4_SWAP_EVENT);
    expect(DEX_EVENTS).toContain(V4_INITIALIZE_EVENT);
    expect(V4_NATIVE_CURRENCY).toMatch(ADDR);
    expect(BigInt(V4_NATIVE_CURRENCY)).toBe(0n);
  });
});

describe("feeds", () => {
  it("the Chainlink directory is a well-formed https url for this chain", () => {
    const u = new URL(CHAINLINK_FEED_DIRECTORY_URL);
    expect(u.protocol).toBe("https:");
    expect(u.pathname).toContain("robinhood");
  });
});
