/** Chainlink price-feed discovery for Robinhood Chain.
 *
 * Chainlink publishes a per-chain JSON directory of every live feed (proxy
 * address, pair name, decimals, heartbeat). This is the directory URL for
 * chain 4663 — fetch it and you have every oracle on the chain, including the
 * tokenized-stock feeds that gate premium/discount logic.
 *
 * Constant only, on purpose: the fetch stays in YOUR code (pair it with
 * `fetchWithRetry` from this kit), so the kit keeps zero runtime dependencies
 * and never phones home.
 */
export const CHAINLINK_FEED_DIRECTORY_URL =
  "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
