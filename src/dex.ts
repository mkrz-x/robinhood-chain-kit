/** DEX event signatures observed live on Robinhood Chain (Uniswap-style
 * V2 pairs and V3 pools). parseAbiItem-ready strings, same format as the
 * bridge events — pass them straight to viem:
 *
 *   client.getLogs({ event: parseAbiItem(V2_PAIR_CREATED_EVENT), ... })
 *
 * Attribution notes from production use:
 *  - V2 Swap: the swapper is `to` (output receiver)
 *  - V3 Swap: the swapper is `recipient`
 *  - either one may be a router/aggregator contract, not a person — check
 *    eth_getCode before treating an address as a wallet
 */

export const V2_PAIR_CREATED_EVENT =
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)";
export const V3_POOL_CREATED_EVENT =
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)";
export const V2_SWAP_EVENT =
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)";
export const V3_SWAP_EVENT =
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)";

/** the four signatures as one list, for scan-everything loops */
export const DEX_EVENTS = [
  V2_PAIR_CREATED_EVENT,
  V3_POOL_CREATED_EVENT,
  V2_SWAP_EVENT,
  V3_SWAP_EVENT,
] as const;
