/** DEX event signatures observed live on Robinhood Chain (Uniswap-style
 * V2 pairs, V3 pools, and the V4 singleton PoolManager). parseAbiItem-ready
 * strings, same format as the bridge events — pass them straight to viem:
 *
 *   client.getLogs({ event: parseAbiItem(V2_PAIR_CREATED_EVENT), ... })
 *
 * Actor notes from production use:
 *  - V2 `sender` is the pool caller and `to` is the output recipient.
 *  - V3 `sender` is the pool caller and `recipient` is the output recipient.
 *  - V4 `sender` is normally a periphery contract; transaction.from may still
 *    be a smart account, router, or bundler.
 * None of these fields alone proves the economic actor behind a swap.
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

/** Explicit event-field roles; deliberately does not label any field "swapper". */
export const DEX_SWAP_ACTOR_FIELDS = {
  v2: { poolCaller: "sender", outputRecipient: "to" },
  v3: { poolCaller: "sender", outputRecipient: "recipient" },
  v4: { poolCaller: "sender", transactionFrom: "transaction.from" },
} as const;

export interface DexDiscoveryDeployments {
  /** Verified V2 factory addresses that emit PairCreated. */
  v2Factories?: readonly string[];
  /** Verified V3 factory addresses that emit PoolCreated. */
  v3Factories?: readonly string[];
  /** Verified V4 PoolManager singleton addresses that emit Initialize. */
  v4PoolManagers?: readonly string[];
}

export interface DexDiscoveryTarget {
  protocol: "v2" | "v3" | "v4";
  address: string;
  event:
    | typeof V2_PAIR_CREATED_EVENT
    | typeof V3_POOL_CREATED_EVENT
    | typeof V4_INITIALIZE_EVENT;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Build address-scoped pool-discovery targets. Event signatures are not
 * identities: an untrusted contract can emit the same topic, so callers must
 * supply factory/PoolManager addresses they have independently verified.
 */
export function getDexDiscoveryTargets(
  deployments: DexDiscoveryDeployments,
): DexDiscoveryTarget[] {
  const targets: DexDiscoveryTarget[] = [];
  const append = (
    protocol: DexDiscoveryTarget["protocol"],
    addresses: readonly string[] | undefined,
    event: DexDiscoveryTarget["event"],
  ) => {
    for (const address of new Set(addresses ?? [])) {
      if (!ADDRESS.test(address)) throw new TypeError(`Invalid ${protocol} deployment: ${address}`);
      targets.push({ protocol, address, event });
    }
  };
  append("v2", deployments.v2Factories, V2_PAIR_CREATED_EVENT);
  append("v3", deployments.v3Factories, V3_POOL_CREATED_EVENT);
  append("v4", deployments.v4PoolManagers, V4_INITIALIZE_EVENT);
  return targets;
}
