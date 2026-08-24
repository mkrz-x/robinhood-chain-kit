/**
 * The viem extension: `robinhood-chain-kit/viem`.
 *
 * This entry point is the ONE place in the package that speaks viem's
 * language, and even here viem is imported as **types only** — the emitted
 * JavaScript contains no `import "viem"`, so the runtime peer stays truly
 * optional and the core package keeps its zero-dependency guarantee. What the
 * peer contract means in practice: install viem to get typed `.extend()`
 * ergonomics; skip it and every function here still exists, still runs, and
 * still accepts anything shaped like a public client.
 *
 * The failure mode this entry closes: the kit's readers all take a client, and
 * every viem consumer was writing the same glue — wrap `readContract`, wire
 * the preflight adapter's ten methods, compose directory + feed + round +
 * pause into a quote. That glue is exactly where the silent mistakes live
 * (the preflight adapter that forgets `getCode` downgrades approval checks;
 * the quote that skips the pause read trusts a paused oracle), so it ships
 * here once, tested.
 *
 * ```ts
 * import { createPublicClient, http } from "viem";
 * import { robinhoodChain } from "robinhood-chain-kit";
 * import { robinhoodChainActions } from "robinhood-chain-kit/viem";
 *
 * const client = createPublicClient({ chain: robinhoodChain, transport: http() })
 *   .extend(robinhoodChainActions());
 * console.log(await client.getEquityQuote("AAPL"));
 * ```
 */
import type { PublicClient } from "viem";
import type { MinimalPublicClient } from "./client.js";
import {
  readOraclePauseState,
  readScaledUiMultiplierState,
  type ScaledUiState,
} from "./erc8056read.js";
import {
  checkOracleHealth,
  type CheckOracleHealthOptions,
  type OracleHealthCheck,
} from "./oracleread.js";
import {
  findChainlinkFeeds,
  formatChainlinkAnswer,
  loadChainlinkFeedDirectory,
  type ChainlinkFeed,
  type OracleHealthAssessment,
  type OraclePauseState,
  type OracleSequencerState,
} from "./feeds.js";
import {
  findStockToken,
  loadStockTokenDirectory,
  type LoadStockTokenDirectoryOptions,
  type StockTokenEntry,
} from "./registry.js";
import { underlyingSharePrice } from "./premium.js";
import {
  getUsEquityMarketSession,
  type UsEquityMarketSession,
} from "./markethours.js";
import type { ScaledUiSchedule } from "./stocktokens.js";
import type {
  EvmAddress,
  HexData,
  TransactionPreflightAdapter,
} from "./preflight.js";

export { readOraclePauseState, readScaledUiMultiplierState, checkOracleHealth };

/** Factory-level defaults applied to every action on the extended client. */
export interface RobinhoodChainActionsOptions {
  /**
   * An L2 sequencer uptime feed address used by `getOracleHealth` and
   * `getEquityQuote` unless a call overrides it. None is shipped because none
   * could be verified for chain 4663 — see `readSequencerUptime`.
   */
  sequencerFeed?: string;
  sequencerGracePeriodSeconds?: number;
  /** injectable fetch for the two directory loads (tests, proxies) */
  fetchImpl?: typeof fetch;
  /** override the RHJ assets URL (mirrors, fixtures) */
  stockDirectoryUrl?: string | URL;
  /** override the Chainlink directory URL (mirrors, fixtures) */
  feedDirectoryUrl?: string | URL;
}

export interface GetEquityQuoteOptions {
  /** caller-known sequencer state; overrides any configured `sequencerFeed` */
  sequencer?: OracleSequencerState;
  sequencerFeed?: string;
  sequencerGracePeriodSeconds?: number;
  nowSeconds?: number;
  /** feed quote asset to match in the directory (default "USD") */
  quoteAsset?: string;
}

/**
 * A composed live quote for one tokenized equity. A quote is a REPORT, not a
 * green light: `health.usable` is the fail-closed verdict, and with no
 * sequencer source configured it stays `false` with
 * `issues: ["sequencer-state-unknown"]` — which is the honest answer, not a
 * bug.
 */
export interface EquityQuote {
  symbol: string;
  tokenAddress: `0x${string}`;
  entry: StockTokenEntry;
  feed: ChainlinkFeed;
  /** the feed's answer: the TOKEN price, multiplier included */
  tokenPrice: { value: bigint; decimals: number; formatted: string };
  /** the underlying share price: `tokenPrice * 1e18 / multiplier` per the docs */
  sharePrice: { value: bigint; decimals: number; formatted: string };
  /** the contract's own `uiMultiplier()`, authoritative, 1e18-scaled */
  multiplier: bigint;
  /** the multiplier's corporate-action schedule at quote time */
  schedule: ScaledUiSchedule;
  pauseState: OraclePauseState;
  sequencer: OracleSequencerState;
  /** US regular-session context — NOT a feed-freshness proxy; feeds are 24/5 */
  session: UsEquityMarketSession;
  health: OracleHealthAssessment;
}

/**
 * A `type` rather than an `interface` on purpose: viem's `.extend()` demands
 * an implicit index signature from the actions object, which object-literal
 * type aliases have and interfaces do not.
 */
export type RobinhoodChainActions = {
  /** authoritative ERC-8056 multiplier state for one stock token */
  getScaledUiMultiplierState(token: string): Promise<ScaledUiState>;
  /** the RHJ stock-token registry, strictly parsed */
  getStockDirectory(
    options?: LoadStockTokenDirectoryOptions,
  ): Promise<StockTokenEntry[]>;
  /** one-call Oracle Guard: round + pause + sequencer, assessed fail-closed */
  getOracleHealth(options: CheckOracleHealthOptions): Promise<OracleHealthCheck>;
  /** directory → feed → round → pause → session, composed into one quote */
  getEquityQuote(
    symbolOrAddress: string,
    options?: GetEquityQuoteOptions,
  ): Promise<EquityQuote>;
};

/**
 * Build the action set for viem's `.extend()`.
 *
 * The returned function takes any object satisfying `MinimalPublicClient`,
 * which a viem `PublicClient` does structurally — so `.extend()` type-checks
 * without this module constraining your transport, chain type, or viem minor
 * version.
 */
export function robinhoodChainActions(factoryOptions: RobinhoodChainActionsOptions = {}) {
  return (client: MinimalPublicClient): RobinhoodChainActions => {
    const directoryOptions = (
      overrides: LoadStockTokenDirectoryOptions | undefined,
    ): LoadStockTokenDirectoryOptions => ({
      ...(factoryOptions.fetchImpl ? { fetchImpl: factoryOptions.fetchImpl } : {}),
      ...(factoryOptions.stockDirectoryUrl ? { url: factoryOptions.stockDirectoryUrl } : {}),
      ...overrides,
    });

    const getEquityQuote = async (
      symbolOrAddress: string,
      options: GetEquityQuoteOptions = {},
    ): Promise<EquityQuote> => {
      const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
      const [directory, feeds] = await Promise.all([
        loadStockTokenDirectory(directoryOptions(undefined)),
        loadChainlinkFeedDirectory({
          ...(factoryOptions.fetchImpl ? { fetchImpl: factoryOptions.fetchImpl } : {}),
          ...(factoryOptions.feedDirectoryUrl ? { url: factoryOptions.feedDirectoryUrl } : {}),
        }),
      ]);
      const entry = findStockToken(directory, symbolOrAddress);
      if (!entry) {
        throw new Error(`${symbolOrAddress} is not in the stock-token directory`);
      }
      const quoteAsset = options.quoteAsset ?? "USD";
      const [feed] = findChainlinkFeeds(feeds, { baseAsset: entry.symbol, quoteAsset });
      if (!feed) {
        throw new Error(
          `no ${entry.symbol}/${quoteAsset} feed in the Chainlink directory — the token trades, but nothing prices it on-chain`,
        );
      }

      const sequencerFeed = options.sequencerFeed ?? factoryOptions.sequencerFeed;
      const graceSeconds =
        options.sequencerGracePeriodSeconds ?? factoryOptions.sequencerGracePeriodSeconds;
      const [check, state] = await Promise.all([
        checkOracleHealth(client, {
          feed,
          token: entry.tokenAddress,
          nowSeconds,
          ...(options.sequencer
            ? { sequencer: options.sequencer }
            : sequencerFeed !== undefined
              ? {
                  sequencerFeed,
                  ...(graceSeconds === undefined
                    ? {}
                    : { sequencerGracePeriodSeconds: graceSeconds }),
                }
              : {}),
        }),
        readScaledUiMultiplierState(client, entry.tokenAddress, { nowSeconds }),
      ]);

      if (check.round.answer <= 0n) {
        throw new Error(
          `the ${entry.symbol}/${quoteAsset} feed answered ${check.round.answer} — no quote can be built from an invalid answer`,
        );
      }
      const multiplier = state.schedule.multiplier;
      const sharePriceValue = underlyingSharePrice(check.round.answer, feed.decimals, multiplier);
      return {
        symbol: entry.symbol,
        tokenAddress: entry.tokenAddress,
        entry,
        feed,
        tokenPrice: {
          value: check.round.answer,
          decimals: feed.decimals,
          formatted: formatChainlinkAnswer(check.round.answer, feed.decimals),
        },
        sharePrice: {
          value: sharePriceValue,
          decimals: feed.decimals,
          formatted: formatChainlinkAnswer(sharePriceValue, feed.decimals),
        },
        multiplier,
        schedule: state.schedule,
        pauseState: check.pauseState,
        sequencer: check.sequencer,
        session: getUsEquityMarketSession(nowSeconds),
        health: check.health,
      };
    };

    return {
      getScaledUiMultiplierState: (token) => readScaledUiMultiplierState(client, token),
      getStockDirectory: (options) => loadStockTokenDirectory(directoryOptions(options)),
      getOracleHealth: (options) =>
        checkOracleHealth(client, {
          ...(factoryOptions.sequencerFeed !== undefined &&
          options.sequencer === undefined &&
          options.sequencerFeed === undefined
            ? {
                sequencerFeed: factoryOptions.sequencerFeed,
                ...(factoryOptions.sequencerGracePeriodSeconds === undefined
                  ? {}
                  : {
                      sequencerGracePeriodSeconds:
                        factoryOptions.sequencerGracePeriodSeconds,
                    }),
              }
            : {}),
          ...options,
        }),
      getEquityQuote,
    };
  };
}

/** Minimal ERC-20 read ABI for the adapter's balance and allowance evidence. */
const ERC20_READ_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const asBigint = (value: unknown, label: string): bigint => {
  if (typeof value !== "bigint") throw new TypeError(`${label} did not return a bigint`);
  return value;
};

/**
 * The slice of a viem `PublicClient` the preflight adapter actually calls,
 * declared structurally rather than as a `Pick` of viem's client type — a
 * `Pick` would pin the exact generic instantiation and reject a client typed
 * with a concrete chain, or one from a second viem copy in a workspace. Every
 * argument object below is one you could pass to the real viem method today;
 * the compile-time proof after `createViemPreflightAdapter` keeps that claim
 * honest against the installed viem version.
 */
export interface PreflightCapableClient {
  getChainId(): Promise<number>;
  call(args: {
    account: EvmAddress;
    to?: EvmAddress;
    data: HexData;
    value: bigint;
    gas?: bigint;
  }): Promise<{ data?: unknown }>;
  getCode(args: { address: EvmAddress }): Promise<unknown>;
  getBalance(args: { address: EvmAddress }): Promise<bigint>;
  readContract(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  estimateGas(args: {
    account: EvmAddress;
    to?: EvmAddress;
    data: HexData;
    value: bigint;
  }): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
}

/**
 * A `TransactionPreflightAdapter` over a viem `PublicClient` — the shipped
 * binding `inspectTransaction` never had.
 *
 * Implements every method viem makes trivial: chain identity, simulation via
 * `eth_call`, bytecode, native balance, ERC-20 balance and allowance, gas
 * estimate, and fee-per-gas. `resolveContract` and `resolveAsset` are
 * deliberately NOT implemented: viem has no independent identity source, and
 * an adapter that fabricated `verified: true` from an RPC would turn the
 * firewall's strongest checks into decoration. Under the default policy their
 * absence surfaces as explicit `unknown` evidence — visible, not vanished.
 */
export function createViemPreflightAdapter(
  client: PreflightCapableClient,
): TransactionPreflightAdapter {
  return {
    getChainId: () => client.getChainId(),
    simulate: async (request) => {
      try {
        const result = await client.call({
          account: request.from,
          ...(request.to === undefined ? {} : { to: request.to }),
          data: request.data,
          value: request.value,
          ...(request.gasLimit === undefined ? {} : { gas: request.gasLimit }),
        });
        return {
          success: true,
          ...(typeof result.data === "string" ? { returnData: result.data as HexData } : {}),
        };
      } catch (error) {
        return {
          success: false,
          revertReason: error instanceof Error ? error.message : String(error),
        };
      }
    },
    getCode: async (address) => {
      const code = await client.getCode({ address });
      return (typeof code === "string" ? code : "0x") as HexData;
    },
    getNativeBalance: (owner) => client.getBalance({ address: owner }),
    getTokenBalance: async (token, owner) =>
      asBigint(
        await client.readContract({
          address: token,
          abi: ERC20_READ_ABI,
          functionName: "balanceOf",
          args: [owner],
        }),
        "balanceOf",
      ),
    getAllowance: async (token, owner, spender) =>
      asBigint(
        await client.readContract({
          address: token,
          abi: ERC20_READ_ABI,
          functionName: "allowance",
          args: [owner, spender],
        }),
        "allowance",
      ),
    estimateGas: (request) =>
      client.estimateGas({
        account: request.from as EvmAddress,
        ...(request.to === undefined ? {} : { to: request.to }),
        data: request.data,
        value: request.value,
      }),
    getFeePerGas: () => client.getGasPrice(),
  };
}

/**
 * Compile-time proof of the structural claims this module makes: any viem
 * `PublicClient` satisfies both the kit-wide `MinimalPublicClient` and the
 * adapter's `PreflightCapableClient`. If a viem release changes a signature
 * in a way that breaks either claim, this build fails here — loudly, in this
 * package — instead of in a consumer's editor.
 */
const _viemStructuralProof: [
  PublicClient extends MinimalPublicClient ? true : never,
  PublicClient extends PreflightCapableClient ? true : never,
] = [true, true];
void _viemStructuralProof;
