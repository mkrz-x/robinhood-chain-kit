/** Robinhood Chain (Arbitrum Orbit L2) — canonical constants. */
export const CHAIN_ID = 4663;
export const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const SEQUENCER_FEED_WS = "wss://feed.mainnet.chain.robinhood.com";
export const EXPLORER_URL = "https://robinhoodchain.blockscout.com";

/** Blockscout REST API base (v2) — token pages, tx lookups, stats */
export const EXPLORER_API_URL = `${EXPLORER_URL}/api/v2`;

/** viem-compatible chain definition (no viem dependency required) */
export const robinhoodChain = {
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: "Blockscout", url: EXPLORER_URL, apiUrl: EXPLORER_API_URL },
  },
  contracts: {
    /** canonical cross-chain Multicall3 — deployed on 4663 like everywhere */
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
} as const;
