import { formatChainlinkAnswer } from "./feeds.js";

/**
 * Robinhood Stock Tokens: the ERC-8056 scaled-UI layer, and how to read it
 * without publishing a wrong number.
 *
 * A tokenized equity is not an ordinary ERC-20. Corporate actions — splits,
 * reverse splits, dividends — do not mint or burn to adjust balances. Instead
 * the contract carries a **multiplier**, and raw balances stay exactly where
 * they were while the amount a holder is shown changes underneath them. Every
 * transfer emits both numbers: the raw `value` and the display `uiValue`.
 *
 * FOUR THINGS THIS MODULE KEEPS APART, because conflating any two of them
 * produces a financial figure that is wrong and looks right:
 *
 * 1. **raw amount** — the ERC-20 unit the contract stores and `balanceOf`
 *    returns. Authoritative, and not what a holder is shown.
 * 2. **displayed (UI) amount** — the raw amount scaled by the multiplier. What
 *    a holder is shown, and what "one share" means to a person.
 * 3. **authoritative multiplier** — read from the contract. Exact.
 * 4. **estimated multiplier** — inferred from one transfer's two amounts. NOT
 *    exact, because `uiValue` was already truncated by integer division before
 *    anyone saw it. See `estimateScaledUiMultiplier`.
 *
 * THE NAME TRAP, which is the reason this module exists at all:
 *
 * EIP-8056 names the transfer event `TransferWithUIAmount`. The contracts
 * deployed on Robinhood Chain emit **`TransferWithScaledUI`**. This is not a
 * subtle difference in an ABI you can shrug at — a `getLogs` filter built from
 * the spec's name computes a different topic0 and matches **zero logs,
 * forever**. The failure is silent and it does not look like a bug. It looks
 * like a chain with no tokenized-equity activity on it.
 *
 * The signature and topic0 below were taken from a deployed stock token's own
 * logs, not from the ERC text. The specification is still evolving, so where
 * the draft and a deployed contract disagree, the deployment wins.
 */

/**
 * The transfer event Robinhood stock tokens actually emit.
 *
 * `parseAbiItem`-ready, same format as the DEX and bridge events:
 *
 *   client.getLogs({ event: parseAbiItem(TRANSFER_WITH_SCALED_UI_EVENT), ... })
 */
export const TRANSFER_WITH_SCALED_UI_EVENT =
  "event TransferWithScaledUI(address indexed from, address indexed to, uint256 value, uint256 uiValue)";

/**
 * keccak256 of the deployed signature.
 *
 * Given as a constant because the whole point is that you cannot derive it
 * from the EIP: hashing `TransferWithUIAmount(address,address,uint256,uint256)`
 * produces a topic that nothing on this chain has ever emitted.
 */
export const TRANSFER_WITH_SCALED_UI_TOPIC0 =
  "0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802";

/** The name EIP-8056 uses, kept so a reader can see the mismatch spelled out. */
export const ERC8056_SPEC_EVENT_NAME = "TransferWithUIAmount";

/**
 * What you get by hashing the spec's name, and what it is worth: nothing.
 *
 * Exported so the trap is a value you can assert against rather than a
 * paragraph you have to believe. If a filter in your code carries this topic,
 * it is subscribed to an event no contract on Robinhood Chain emits.
 */
export const ERC8056_SPEC_TOPIC0 =
  "0x0226a2f5c1ae0e071aeec3d4ebafcefdc5c549be11f40ed27e76e802acccf374";

/**
 * The multiplier-update event, verified against real emissions on chain 4663.
 *
 * Confirmed three ways rather than assumed: this topic0 is present in the
 * implementation bytecode behind the stock-token beacon proxy, the chain
 * carries ten emissions of it across five tokens, and every one of those logs
 * has exactly ONE topic with 96 bytes of data — so all three parameters are
 * non-indexed, as declared here.
 *
 * **It announces a SCHEDULED change, not a completed one.** One token emitted
 * the identical `(old, new, effectiveAt)` triple at two different blocks while
 * `old` was still the live multiplier, so an emission is a notice and may be
 * repeated. Use `effectiveAt` and a contract read to decide what applies now;
 * see `resolveScaledUiMultiplier`.
 */
export const UIMULTIPLIER_UPDATED_EVENT =
  "event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAt)";

/**
 * keccak256 of the update signature.
 *
 * Published only now that it is earned: 0.7.0 deliberately shipped without it
 * because an unverified topic0 fails silently, which is the trap this module
 * exists to warn about. It has since been found in deployed bytecode AND in
 * emitted logs.
 */
export const UIMULTIPLIER_UPDATED_TOPIC0 =
  "0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055";

/**
 * Plain ERC-20 Transfer, for the cash side of a settlement.
 *
 * Every token on the chain emits this topic, so a subscription MUST be address
 * filtered to the stablecoins you care about. Unfiltered, it pulls every token
 * movement on Robinhood Chain into every window.
 */
export const ERC20_TRANSFER_EVENT =
  "event Transfer(address indexed from, address indexed to, uint256 value)";

/* -------------------------------------------------------------- contract */

/**
 * Client-neutral ERC-8056 ABI. No viem import; pass it to any client that
 * accepts a JSON ABI.
 *
 * Every member has been checked against live contracts on chain 4663 — the
 * three reads by `eth_call` against real stock tokens, both events by finding
 * their topic0 in the beacon implementation's bytecode and then in emitted
 * logs. `ERC8056_VERIFICATION` records which kind of evidence each one has,
 * because "present in bytecode" and "has actually fired" are different
 * strengths and a consumer may care which.
 */
export const ERC8056_ABI = [
  {
    type: "function",
    name: "uiMultiplier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "newUIMultiplier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "effectiveAt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "TransferWithScaledUI",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
      { name: "uiValue", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "UIMultiplierUpdated",
    inputs: [
      { name: "oldMultiplier", type: "uint256", indexed: false },
      { name: "newMultiplier", type: "uint256", indexed: false },
      { name: "effectiveAt", type: "uint256", indexed: false },
    ],
  },
] as const;

export type Erc8056Provenance =
  /** observed in logs emitted by a deployed contract on chain 4663 */
  | "deployed-logs"
  /** eth_call against a deployed contract returned well-formed data */
  | "deployed-call";

/**
 * How each ABI member was verified, machine-readable.
 *
 * Every member here has been checked against live contracts on chain 4663 —
 * none is taken from the draft text alone. The two values distinguish HOW,
 * because "the bytecode contains it" and "it has actually fired" are different
 * strengths of evidence and a consumer may care which.
 */
export const ERC8056_VERIFICATION: Readonly<Record<string, Erc8056Provenance>> = Object.freeze({
  TransferWithScaledUI: "deployed-logs",
  UIMultiplierUpdated: "deployed-logs",
  uiMultiplier: "deployed-call",
  newUIMultiplier: "deployed-call",
  effectiveAt: "deployed-call",
});

export interface Erc8056ReadCall {
  address: `0x${string}`;
  abi: typeof ERC8056_ABI;
  functionName: "uiMultiplier" | "newUIMultiplier" | "effectiveAt";
  /** how this member was verified — see `ERC8056_VERIFICATION` */
  provenance: Erc8056Provenance;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Build the authoritative multiplier reads for a stock token.
 *
 * This is how you get a multiplier you can trust. An estimate recovered from
 * a transfer is bounded but not exact; a contract read is the value itself.
 * Prefer this everywhere a number will be shown to a person or used in a
 * financial calculation.
 *
 * All three were called successfully against live stock tokens and returned
 * well-formed uint256 values, so a revert means something is wrong with that
 * particular deployment rather than with the call. Pass the results to
 * `resolveScaledUiMultiplier` — reading `newUIMultiplier()` alone and treating
 * it as current is wrong until `effectiveAt` has passed.
 */
export function getErc8056ReadCalls(tokenAddress: string): Erc8056ReadCall[] {
  if (!ADDRESS.test(tokenAddress)) throw new TypeError(`Invalid token address: ${tokenAddress}`);
  const address = tokenAddress as `0x${string}`;
  return (["uiMultiplier", "newUIMultiplier", "effectiveAt"] as const).map((functionName) => ({
    address,
    abi: ERC8056_ABI,
    functionName,
    provenance: ERC8056_VERIFICATION[functionName]!,
  }));
}

/* ------------------------------------------------------------- multiplier */

/** The multiplier is fixed-point with 18 decimals: 1e18 means "unadjusted". */
export const SCALED_UI_DECIMALS = 18;
export const SCALED_UI_ONE = 10n ** BigInt(SCALED_UI_DECIMALS);

export interface ScaledUiTransfer {
  /** raw token units, as stored by the contract */
  value: bigint;
  /** the amount a holder is shown, after the corporate-action multiplier */
  uiValue: bigint;
}

export type ScaledUiMultiplierUnknownReason =
  /** value is 0, so uiValue/value is undefined rather than large */
  | "zero-raw-value"
  /** uiValue is 0 against a non-zero value: not a scale a holder can be shown */
  | "zero-ui-value"
  /** a uint256 field arrived negative, so the log was decoded wrongly */
  | "negative-amount";

export type ScaledUiMultiplierEstimate =
  | {
      estimated: true;
      /**
       * Midpoint of the feasible range. A point to display, never a value to
       * compare for equality — use the bounds for that.
       */
      multiplier: bigint;
      /** smallest multiplier consistent with the observation, inclusive */
      lowerBound: bigint;
      /** smallest multiplier NOT consistent with the observation */
      upperBoundExclusive: bigint;
    }
  | { estimated: false; reason: ScaledUiMultiplierUnknownReason };

/** ceil(a / b) for positive bigints. */
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/**
 * Bound the multiplier from one transfer's two amounts.
 *
 * **This cannot be exact, and the previous version of this function was wrong
 * to present it as such.** The contract computes
 *
 *     uiValue = floor(rawValue * multiplier / 1e18)
 *
 * so the low-order information is destroyed before the event is emitted. With
 * a true multiplier of 1.5 and a raw value of 3, the emitted uiValue is
 * floor(4.5) = 4, and dividing back gives 1.333…, which is not the multiplier
 * and never was.
 *
 * What CAN be recovered exactly is the interval. Inverting the floor:
 *
 *     uiValue <= rawValue * M / 1e18 < uiValue + 1
 *     ceil(uiValue * 1e18 / rawValue) <= M < ceil((uiValue + 1) * 1e18 / rawValue)
 *
 * so `lowerBound` and `upperBoundExclusive` are hard facts and `multiplier` is
 * the interval midpoint, which minimises worst-case error and is a display
 * value only. On the example above the interval is [1.333…334, 1.666…667) and
 * its midpoint is exactly 1.5 — but that is a property of that observation,
 * not a guarantee.
 *
 * The interval narrows as the raw amount grows, and collapses to a single
 * value once the raw amount is large relative to 1e18. A whole-token transfer
 * of an 18-decimal token pins the multiplier exactly; a 3-unit transfer does
 * not come close.
 *
 * For a value you can rely on, read the contract — see `getErc8056ReadCalls`.
 *
 * Fails closed. A zero raw value makes the ratio undefined, not enormous, and
 * "we cannot tell" is a different answer from "the multiplier is 1".
 */
export function estimateScaledUiMultiplier(transfer: ScaledUiTransfer): ScaledUiMultiplierEstimate {
  const { value, uiValue } = transfer;
  if (typeof value !== "bigint" || typeof uiValue !== "bigint") {
    throw new TypeError("value and uiValue must be bigints");
  }
  if (value < 0n || uiValue < 0n) return { estimated: false, reason: "negative-amount" };
  if (value === 0n) return { estimated: false, reason: "zero-raw-value" };
  if (uiValue === 0n) return { estimated: false, reason: "zero-ui-value" };
  const lowerBound = ceilDiv(uiValue * SCALED_UI_ONE, value);
  const upperBoundExclusive = ceilDiv((uiValue + 1n) * SCALED_UI_ONE, value);
  // midpoint of the inclusive range, so the point estimate is always feasible
  const multiplier = lowerBound + (upperBoundExclusive - 1n - lowerBound) / 2n;
  return { estimated: true, multiplier, lowerBound, upperBoundExclusive };
}

export type ScaledUiMultiplierResult =
  | { known: true; multiplier: bigint }
  | { known: false; reason: ScaledUiMultiplierUnknownReason };

/**
 * @deprecated Presents an estimate as an exact recovered multiplier, which it
 * is not — `uiValue` is truncated by the contract before it is emitted. Use
 * {@link estimateScaledUiMultiplier} for the bounded estimate, or
 * {@link getErc8056ReadCalls} for the authoritative value.
 *
 * Kept so 0.7.0 callers keep compiling. `multiplier` is now the feasible
 * interval's midpoint rather than a floor division, because the old value
 * could fall outside the range of multipliers consistent with the observation.
 */
export function readScaledUiMultiplier(transfer: ScaledUiTransfer): ScaledUiMultiplierResult {
  const estimate = estimateScaledUiMultiplier(transfer);
  return estimate.estimated
    ? { known: true, multiplier: estimate.multiplier }
    : { known: false, reason: estimate.reason };
}

/**
 * Raw units to the amount a holder is shown.
 *
 * `multiplier` should be an AUTHORITATIVE value read from the contract. Passing
 * an estimate propagates its uncertainty into every figure downstream without
 * saying so anywhere.
 */
export function toUiAmount(rawValue: bigint, multiplier: bigint): bigint {
  if (typeof rawValue !== "bigint" || typeof multiplier !== "bigint") {
    throw new TypeError("rawValue and multiplier must be bigints");
  }
  if (multiplier < 0n) throw new RangeError("multiplier must not be negative");
  return (rawValue * multiplier) / SCALED_UI_ONE;
}

/**
 * The amount shown back to raw units.
 *
 * Not exactly lossless: integer division truncates, so round-tripping a value
 * can land one unit low. Use raw amounts as the source of truth and treat the
 * display side as derived, never the other way around.
 */
export function toRawAmount(uiValue: bigint, multiplier: bigint): bigint {
  if (typeof uiValue !== "bigint" || typeof multiplier !== "bigint") {
    throw new TypeError("uiValue and multiplier must be bigints");
  }
  if (multiplier <= 0n) throw new RangeError("multiplier must be positive to invert");
  return (uiValue * SCALED_UI_ONE) / multiplier;
}

/** Human-readable multiplier, exact, no Number involved. */
export function formatScaledUiMultiplier(multiplier: bigint): string {
  return formatChainlinkAnswer(multiplier, SCALED_UI_DECIMALS);
}

export type ScaledUiMultiplierChange =
  | { moved: false }
  | { moved: true; direction: "up" | "down"; previous: bigint; current: bigint };

/**
 * Did a corporate action land between two AUTHORITATIVE multiplier readings?
 *
 * **Contract reads only.** Two estimates recovered from differently sized
 * transfers disagree under an unchanged multiplier — that is arithmetic, not a
 * corporate action — and feeding them here manufactures events that never
 * happened. Use {@link compareScaledUiEstimates} for estimates; it works on
 * intervals and will not claim a change unless the ranges are disjoint.
 *
 * Reports DIRECTION only. The multiplier moving up is consistent with a split
 * and with a dividend adjustment; moving down is consistent with a reverse
 * split and with a correction. Nothing in the observation separates them, so
 * naming the cause here would be a guess wearing an API's clothes.
 *
 * `toleranceBps` defaults to 0. Authoritative values have no noise to absorb,
 * and a non-zero tolerance here would hide a real, small adjustment. It is
 * retained only for callers who deliberately want a dead band.
 */
export function compareScaledUiMultiplier(
  previous: bigint,
  current: bigint,
  options: { toleranceBps?: number } = {},
): ScaledUiMultiplierChange {
  if (typeof previous !== "bigint" || typeof current !== "bigint") {
    throw new TypeError("previous and current must be bigints");
  }
  const toleranceBps = options.toleranceBps ?? 0;
  if (!Number.isInteger(toleranceBps) || toleranceBps < 0) {
    throw new RangeError("toleranceBps must be a non-negative integer");
  }
  if (previous === current) return { moved: false };
  const difference = current > previous ? current - previous : previous - current;
  const scale = previous > 0n ? previous : SCALED_UI_ONE;
  // difference/scale > toleranceBps/10000, without leaving bigint
  if (difference * 10_000n <= BigInt(toleranceBps) * scale) return { moved: false };
  return { moved: true, direction: current > previous ? "up" : "down", previous, current };
}

export type ScaledUiEstimateComparison =
  | { comparable: false; reason: ScaledUiMultiplierUnknownReason }
  /** the ranges overlap, so no change is provable from these two observations */
  | { comparable: true; moved: false }
  | { comparable: true; moved: true; direction: "up" | "down" };

/**
 * Compare two ESTIMATES without inventing a corporate action.
 *
 * Two transfers under one unchanged multiplier produce different point
 * estimates whenever their raw amounts differ, because each is truncated
 * differently. Comparing those points reports a change every time the transfer
 * sizes differ, which is the false-positive this function exists to prevent.
 *
 * A change is only reported when the two feasible ranges are **disjoint**: no
 * single multiplier could have produced both observations. That is a proof
 * rather than a signal. Overlapping ranges return `moved: false`, which means
 * "not provable from these two", not "definitely unchanged" — a small
 * adjustment inside two wide ranges is invisible here, and the honest way to
 * see it is a contract read.
 */
export function compareScaledUiEstimates(
  previous: ScaledUiMultiplierEstimate,
  current: ScaledUiMultiplierEstimate,
): ScaledUiEstimateComparison {
  if (!previous.estimated) return { comparable: false, reason: previous.reason };
  if (!current.estimated) return { comparable: false, reason: current.reason };
  if (current.lowerBound >= previous.upperBoundExclusive) {
    return { comparable: true, moved: true, direction: "up" };
  }
  if (previous.lowerBound >= current.upperBoundExclusive) {
    return { comparable: true, moved: true, direction: "down" };
  }
  return { comparable: true, moved: false };
}

/**
 * A stock token's multiplier state, as the three contract reads return it.
 */
export interface ScaledUiMultiplierState {
  /** `uiMultiplier()` — what the contract reports as current */
  current: bigint;
  /** `newUIMultiplier()` — the scheduled value */
  pending: bigint;
  /** `effectiveAt()` — unix seconds; 0 means no schedule has ever been set */
  effectiveAtSeconds: number | bigint;
}

export type ScaledUiSchedule =
  /** no corporate action has ever been scheduled on this token */
  | { status: "none"; multiplier: bigint }
  /** a scheduled change has taken effect and the contract now reports it */
  | { status: "applied"; multiplier: bigint; effectiveAtSeconds: number }
  /** a change is announced for the future; `multiplier` is still the old one */
  | { status: "pending"; multiplier: bigint; pending: bigint; effectiveAtSeconds: number }
  /**
   * `effectiveAt` has passed and the contract still reports the OLD value.
   * Every derived figure is ambiguous until this resolves — fail closed.
   */
  | { status: "due"; multiplier: bigint; pending: bigint; effectiveAtSeconds: number };

/**
 * Decide which multiplier applies, and say so when the answer is unsafe.
 *
 * `UIMultiplierUpdated` announces a change rather than reporting one: the same
 * `(old, new, effectiveAt)` triple was emitted at two different blocks on one
 * token while `old` was still live. So `newUIMultiplier()` is NOT the current
 * multiplier, and a consumer that reads it as one prices a split before it
 * happens.
 *
 * `multiplier` in every branch is the contract's own `uiMultiplier()`, never
 * a value this function derived. The status says whether you can trust a
 * figure computed from it right now, and `"due"` is the state worth handling:
 * the effective time has passed, the contract has not moved, and anything you
 * compute is ambiguous between the two.
 *
 * Pure.
 */
export function resolveScaledUiMultiplier(
  state: ScaledUiMultiplierState,
  nowSeconds: number | bigint,
): ScaledUiSchedule {
  const { current, pending } = state;
  if (typeof current !== "bigint" || typeof pending !== "bigint") {
    throw new TypeError("current and pending must be bigints");
  }
  if (current < 0n || pending < 0n) throw new RangeError("multipliers must not be negative");
  const effectiveAt = Number(state.effectiveAtSeconds);
  const now = Number(nowSeconds);
  if (!Number.isFinite(effectiveAt) || effectiveAt < 0) {
    throw new RangeError("effectiveAtSeconds must be a non-negative number");
  }
  if (!Number.isFinite(now)) throw new RangeError("nowSeconds must be a finite number");

  if (effectiveAt === 0) return { status: "none", multiplier: current };
  if (current === pending) {
    return { status: "applied", multiplier: current, effectiveAtSeconds: effectiveAt };
  }
  const status = now < effectiveAt ? "pending" : "due";
  return { status, multiplier: current, pending, effectiveAtSeconds: effectiveAt };
}

/* ------------------------------------------------------------- settlement */

/**
 * One transfer leg, as a caller would assemble it from a decoded log.
 *
 * Addresses are compared case-insensitively, so either casing is fine.
 */
export interface SettlementLeg {
  transactionHash: string;
  /** the token contract that emitted the transfer */
  token: string;
  from: string;
  to: string;
  /** RAW ERC-20 units. For a stock token this is not the displayed amount. */
  value: bigint;
}

export interface DeliveryVersusPayment {
  transactionHash: string;
  /** the stock-token leg: seller -> buyer */
  stock: SettlementLeg;
  /** the cash leg, opposed: buyer -> seller */
  cash: SettlementLeg;
  buyer: string;
  seller: string;
}

const lower = (value: string) => value.toLowerCase();

/**
 * Reconstruct peer-to-peer trades that never touched a pool.
 *
 * A stock-token transfer and a stablecoin transfer inside the SAME transaction,
 * moving in opposite directions between the same two addresses, is a trade by
 * construction: one side gave up the asset, the other gave up the cash, and
 * both legs committed together or neither did. No automated market maker was
 * involved, which is exactly why a swap-based index cannot see any of this.
 *
 * Fails closed, hard. A settlement is only reported when a transaction carries
 * exactly ONE stock leg and exactly ONE cash leg, and the two are opposed
 * between the same pair of addresses. Batches, routed fills and anything with
 * a third party in the middle are left unclassified rather than guessed at:
 * the whole value of this output is that a reported settlement really is one.
 *
 * Pure. Callers supply legs already decoded and already filtered to the tokens
 * they trust — an event signature is not an identity, and any contract can
 * emit `Transfer`.
 */
export function pairDeliveryVersusPayment(input: {
  stockLegs: readonly SettlementLeg[];
  cashLegs: readonly SettlementLeg[];
}): DeliveryVersusPayment[] {
  const byTx = new Map<string, { stock: SettlementLeg[]; cash: SettlementLeg[] }>();
  const bucket = (hash: string) => {
    const key = lower(hash);
    let entry = byTx.get(key);
    if (!entry) {
      entry = { stock: [], cash: [] };
      byTx.set(key, entry);
    }
    return entry;
  };
  for (const leg of input.stockLegs) bucket(leg.transactionHash).stock.push(leg);
  for (const leg of input.cashLegs) bucket(leg.transactionHash).cash.push(leg);

  const settlements: DeliveryVersusPayment[] = [];
  for (const entry of byTx.values()) {
    if (entry.stock.length !== 1 || entry.cash.length !== 1) continue;
    const stock = entry.stock[0]!;
    const cash = entry.cash[0]!;
    if (stock.value <= 0n || cash.value <= 0n) continue;
    // opposed between the same two parties, or it is two unrelated transfers
    // that happened to share a transaction
    if (lower(stock.from) !== lower(cash.to)) continue;
    if (lower(stock.to) !== lower(cash.from)) continue;
    if (lower(stock.from) === lower(stock.to)) continue;
    settlements.push({
      transactionHash: stock.transactionHash,
      stock,
      cash,
      buyer: stock.to,
      seller: stock.from,
    });
  }
  return settlements;
}

/** Which stock unit a settlement price is quoted per. */
export type StockAmountMode = "raw" | "ui";

export type SettlementPriceUnknownReason =
  | "zero-stock-amount"
  | "zero-cash-amount"
  /** the multiplier scaled the raw amount down to nothing */
  | "zero-ui-stock-amount";

export type SettlementPriceResult =
  | {
      /** always true when a price is returned, and named to be read at the call site */
      inferred: true;
      /** cash per stock unit, as an exact decimal string */
      price: string;
      /** the scale `price` is expressed at */
      decimals: number;
      /** WHICH stock unit the price is per — raw ERC-20, or displayed shares */
      stockAmountMode: StockAmountMode;
    }
  | { inferred: false; reason: SettlementPriceUnknownReason };

interface PriceScales {
  stockDecimals: number;
  cashDecimals: number;
  priceDecimals?: number;
}

function assertDecimals(entries: readonly (readonly [string, number])[]): void {
  for (const [name, value] of entries) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new RangeError(`${name} must be an integer between 0 and 255`);
    }
  }
}

function divideExact(
  cashAmount: bigint,
  stockAmount: bigint,
  scales: Required<PriceScales>,
  stockAmountMode: StockAmountMode,
  zeroStockReason: SettlementPriceUnknownReason,
): SettlementPriceResult {
  if (stockAmount <= 0n) return { inferred: false, reason: zeroStockReason };
  if (cashAmount <= 0n) return { inferred: false, reason: "zero-cash-amount" };
  // (cash / 10^cashDecimals) / (stock / 10^stockDecimals), carried at priceDecimals
  const numerator =
    cashAmount * 10n ** BigInt(scales.stockDecimals) * 10n ** BigInt(scales.priceDecimals);
  const denominator = stockAmount * 10n ** BigInt(scales.cashDecimals);
  return {
    inferred: true,
    price: formatChainlinkAnswer(numerator / denominator, scales.priceDecimals),
    decimals: scales.priceDecimals,
    stockAmountMode,
  };
}

/**
 * Cash per RAW stock token unit.
 *
 * `inferred: true` is not decoration. No venue quoted this price. It is the
 * ratio of two amounts in a transaction, and the two parties may have agreed
 * it hours earlier, off-chain, at a level unrelated to any market. Treat it as
 * a reconstruction and say so wherever it is displayed. A count of settlements
 * is a hard fact; the level any one of them printed at is not.
 *
 * **This is a price per raw ERC-20 unit, not per displayed share.** After a
 * corporate action the two differ by the multiplier: one raw unit under a 4x
 * multiplier is four displayed shares, so a raw price of 400 is a displayed
 * price of 100. If you are showing a number to a person who thinks in shares,
 * you want {@link inferUiSettlementPrice}.
 *
 * Exact throughout: the ratio is taken in bigint at `priceDecimals` and
 * formatted without ever touching a float.
 */
export function inferRawSettlementPrice(
  input: { settlement: DeliveryVersusPayment } & PriceScales,
): SettlementPriceResult {
  const priceDecimals = input.priceDecimals ?? 18;
  assertDecimals([
    ["stockDecimals", input.stockDecimals],
    ["cashDecimals", input.cashDecimals],
    ["priceDecimals", priceDecimals],
  ]);
  return divideExact(
    input.settlement.cash.value,
    input.settlement.stock.value,
    { ...input, priceDecimals },
    "raw",
    "zero-stock-amount",
  );
}

export type UiSettlementPriceInput = { settlement: DeliveryVersusPayment } & PriceScales &
  (
    | {
        /** displayed stock amount, e.g. the transfer's own `uiValue` */
        stockUiValue: bigint;
        stockMultiplier?: never;
      }
    | {
        /** AUTHORITATIVE multiplier; an estimate imports its uncertainty here */
        stockMultiplier: bigint;
        stockUiValue?: never;
      }
  );

/**
 * Cash per DISPLAYED stock unit — the price a person reading "shares" means.
 *
 * The displayed amount must be supplied, never guessed. Pass the transfer's own
 * `uiValue`, which is exact and came from the contract, or an authoritative
 * multiplier read from the contract. Supplying both, or neither, throws: a
 * pricing basis that can be silently defaulted is a pricing basis that will be
 * silently wrong.
 *
 * `stockMultiplier` is the weaker of the two inputs. `uiValue` is what the
 * contract itself computed; a multiplier passed here is applied by this
 * library and truncates the same way the contract does, so it can land one
 * unit off. Prefer `stockUiValue` when the log gives it to you, which it
 * always does.
 */
export function inferUiSettlementPrice(input: UiSettlementPriceInput): SettlementPriceResult {
  const priceDecimals = input.priceDecimals ?? 18;
  assertDecimals([
    ["stockDecimals", input.stockDecimals],
    ["cashDecimals", input.cashDecimals],
    ["priceDecimals", priceDecimals],
  ]);
  const hasUiValue = input.stockUiValue !== undefined;
  const hasMultiplier = input.stockMultiplier !== undefined;
  if (hasUiValue === hasMultiplier) {
    throw new TypeError("provide exactly one of stockUiValue or stockMultiplier");
  }
  let uiStockAmount: bigint;
  if (hasUiValue) {
    if (typeof input.stockUiValue !== "bigint") throw new TypeError("stockUiValue must be a bigint");
    if (input.stockUiValue < 0n) throw new RangeError("stockUiValue must not be negative");
    uiStockAmount = input.stockUiValue;
  } else {
    if (typeof input.stockMultiplier !== "bigint") {
      throw new TypeError("stockMultiplier must be a bigint");
    }
    if (input.stockMultiplier <= 0n) throw new RangeError("stockMultiplier must be positive");
    uiStockAmount = toUiAmount(input.settlement.stock.value, input.stockMultiplier);
  }
  return divideExact(
    input.settlement.cash.value,
    uiStockAmount,
    { stockDecimals: input.stockDecimals, cashDecimals: input.cashDecimals, priceDecimals },
    "ui",
    "zero-ui-stock-amount",
  );
}

/**
 * @deprecated Prices per RAW ERC-20 unit, which is not the displayed share
 * amount once a corporate action has landed. Call
 * {@link inferRawSettlementPrice} to keep this behaviour explicitly, or
 * {@link inferUiSettlementPrice} for a price per displayed share.
 *
 * Behaviour is unchanged from 0.7.0; the result now also carries
 * `stockAmountMode: "raw"` so an existing call site can be read correctly.
 */
export function inferSettlementPrice(
  input: { settlement: DeliveryVersusPayment } & PriceScales,
): SettlementPriceResult {
  return inferRawSettlementPrice(input);
}
