/** Robinhood Chain mainnet constants. */
export const CHAIN_ID = 4663;
export const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const SEQUENCER_FEED_WS = "wss://feed.mainnet.chain.robinhood.com";
export const SEQUENCER_URL = "https://sequencer.mainnet.chain.robinhood.com";
export const EXPLORER_URL = "https://robinhoodchain.blockscout.com";

/** Etherscan-compatible Blockscout endpoint used by viem verification tooling. */
export const EXPLORER_API_URL = `${EXPLORER_URL}/api`;
/** Blockscout REST API v2 for application-level token, transaction, and stats queries. */
export const BLOCKSCOUT_API_V2_URL = `${EXPLORER_URL}/api/v2`;

/** Robinhood Chain testnet constants. */
export const TESTNET_CHAIN_ID = 46630;
export const TESTNET_RPC_URL = "https://rpc.testnet.chain.robinhood.com";
export const TESTNET_SEQUENCER_FEED_WS = "wss://feed.testnet.chain.robinhood.com";
export const TESTNET_SEQUENCER_URL = "https://sequencer.testnet.chain.robinhood.com";
export const TESTNET_EXPLORER_URL = "https://explorer.testnet.chain.robinhood.com";
export const TESTNET_EXPLORER_API_URL = `${TESTNET_EXPLORER_URL}/api`;
export const TESTNET_BLOCKSCOUT_API_V2_URL = `${TESTNET_EXPLORER_URL}/api/v2`;

export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

/**
 * Robinhood's own registry of tokenized-equity deployments on chain 4663 —
 * symbol, name, contract address, decimals, ISIN, and a multiplier snapshot
 * per asset. This is the address book `loadStockTokenDirectory` parses.
 */
export const RHJ_ASSETS_URL = "https://api.robinhood.com/rhj/assets";

/** viem-compatible mainnet definition (no viem runtime dependency required). */
export const robinhoodChain = {
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: "Blockscout", url: EXPLORER_URL, apiUrl: EXPLORER_API_URL },
  },
  contracts: {
    multicall3: { address: MULTICALL3_ADDRESS },
  },
} as const;

/** viem-compatible testnet definition. */
export const robinhoodTestnetChain = {
  id: TESTNET_CHAIN_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [TESTNET_RPC_URL] } },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: TESTNET_EXPLORER_URL,
      apiUrl: TESTNET_EXPLORER_API_URL,
    },
  },
  contracts: {
    multicall3: { address: MULTICALL3_ADDRESS },
  },
  testnet: true,
} as const;

export const ROBINHOOD_CHAINS = {
  mainnet: robinhoodChain,
  testnet: robinhoodTestnetChain,
} as const;

export type RobinhoodNetwork = keyof typeof ROBINHOOD_CHAINS;

export function getRobinhoodChain<N extends RobinhoodNetwork>(network: N) {
  return ROBINHOOD_CHAINS[network];
}
