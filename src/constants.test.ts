import { describe, expect, it } from "vitest";
import {
  BLOCKSCOUT_API_V2_URL,
  CHAIN_ID,
  EXPLORER_API_URL,
  EXPLORER_URL,
  RPC_URL,
  SEQUENCER_FEED_WS,
  TESTNET_CHAIN_ID,
  TESTNET_RPC_URL,
  robinhoodChain,
  robinhoodTestnetChain,
} from "./chain.js";
import {
  DEPOSIT_INITIATED_EVENT,
  L1_BRIDGE,
  L1_GATEWAYS,
  L1_OUTBOX,
  PROTOCOL_CONTRACTS,
  WITHDRAWAL_FINALIZED_EVENT,
} from "./bridge.js";
import {
  DEX_EVENTS,
  DEX_SWAP_ACTOR_FIELDS,
  V4_INITIALIZE_EVENT,
  V4_NATIVE_CURRENCY,
  V4_SWAP_EVENT,
  getDexDiscoveryTargets,
} from "./dex.js";
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
    // viem tooling expects Blockscout's Etherscan-compatible API, while
    // application REST lookups use the separate v2 base.
    expect(EXPLORER_API_URL).toBe(`${EXPLORER_URL}/api`);
    expect(BLOCKSCOUT_API_V2_URL).toBe(`${EXPLORER_URL}/api/v2`);
    expect(robinhoodChain.blockExplorers.default.apiUrl).toBe(EXPLORER_API_URL);
    expect(robinhoodChain.contracts.multicall3.address).toBe(
      "0xcA11bde05977b3631167028862bE2a173976CA11",
    );
  });

  it("includes a complete testnet chain definition", () => {
    expect(TESTNET_CHAIN_ID).toBe(46630);
    expect(TESTNET_RPC_URL).toMatch(/^https:\/\//);
    expect(robinhoodTestnetChain.id).toBe(TESTNET_CHAIN_ID);
    expect(robinhoodTestnetChain.testnet).toBe(true);
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

  it("pins the documented mainnet and testnet L1/L2 protocol registries", () => {
    for (const network of Object.values(PROTOCOL_CONTRACTS)) {
      for (const layer of [network.l1, network.l2, network.precompiles]) {
        for (const address of Object.values(layer)) expect(address).toMatch(ADDR);
      }
    }
    expect(PROTOCOL_CONTRACTS.mainnet.l1.bridge).toBe(L1_BRIDGE);
    expect(PROTOCOL_CONTRACTS.mainnet.l1.outbox).toBe(L1_OUTBOX);
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

  it("uses explicit caller/recipient roles and address-scoped discovery targets", () => {
    expect(DEX_SWAP_ACTOR_FIELDS.v2).toEqual({
      poolCaller: "sender",
      outputRecipient: "to",
    });
    expect(DEX_SWAP_ACTOR_FIELDS.v3).toEqual({
      poolCaller: "sender",
      outputRecipient: "recipient",
    });
    expect(Object.values(DEX_SWAP_ACTOR_FIELDS).flatMap(Object.keys)).not.toContain("swapper");

    const factory = "0x1111111111111111111111111111111111111111";
    expect(getDexDiscoveryTargets({ v2Factories: [factory] })).toEqual([
      { protocol: "v2", address: factory, event: DEX_EVENTS[0] },
    ]);
    expect(() => getDexDiscoveryTargets({ v2Factories: ["0x1234"] })).toThrow(TypeError);
  });
});

describe("feeds", () => {
  it("the Chainlink directory is a well-formed https url for this chain", () => {
    const u = new URL(CHAINLINK_FEED_DIRECTORY_URL);
    expect(u.protocol).toBe("https:");
    expect(u.pathname).toContain("robinhood");
  });
});
