/** DEX event signatures observed live on Robinhood Chain (Uniswap-style
 * V2 pairs, V3 pools, and the V4 singleton PoolManager). parseAbiItem-ready
 * strings, same format as the bridge events — pass them straight to viem:
 *
 *   client.getLogs({ event: parseAbiItem(V2_PAIR_CREATED_EVENT), ... })
 *
 * Attribution notes from production use:
 *  - V2 Swap: the swapper is `to` (output receiver)
 *  - V3 Swap: the swapper is `recipient`
 *  - V4 Swap: `sender` is ALWAYS a periphery contract (V4 is not enterable
 *    directly) — attribute to the transaction sender instead
 *  - any of them may be a router/aggregator contract, not a person — check
 *    eth_getCode before treating an address as a wallet
 *
 * V4 notes: there are no per-pool contracts — one singleton PoolManager emits
 *  every event, and pools are identified by the bytes32 `id`. A currency of
 *  address(0) is the chain's native asset (it trades like WETH does).
 */

export const V2_PAIR_CREATED_EVENT =
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)";
export const V3_POOL_CREATED_EVENT =
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)";
export const V2_SWAP_EVENT =
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)";
export const V3_SWAP_EVENT =
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)";
export const V4_INITIALIZE_EVENT =
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)";
export const V4_SWAP_EVENT =
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)";

/** V4 currency slot for the chain's native asset */
export const V4_NATIVE_CURRENCY = "0x0000000000000000000000000000000000000000";

/** every signature as one list, for scan-everything loops */
export const DEX_EVENTS = [
  V2_PAIR_CREATED_EVENT,
  V3_POOL_CREATED_EVENT,
  V2_SWAP_EVENT,
  V3_SWAP_EVENT,
  V4_INITIALIZE_EVENT,
  V4_SWAP_EVENT,
] as const;
