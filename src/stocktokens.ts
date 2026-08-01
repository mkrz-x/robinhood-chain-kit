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
 * Consequences, in the order they bite:
 *
 * 1. Reading `balanceOf` alone gives you a number that is correct in raw units
 *    and wrong on screen the moment a corporate action lands.
 * 2. Any historical price, PnL figure, or leaderboard computed from raw
 *    amounts silently changes meaning across a split. It will not throw. It
 *    will look exactly like a right answer.
 * 3. The multiplier is only observable from the events, so a consumer that
 *    subscribes to plain `Transfer` never sees a corporate action happen.
 *
 * THE NAME TRAP, which is the reason this module exists at all:
 *
 * EIP-8056 names the event `TransferWithUIAmount`. The contracts deployed on
 * Robinhood Chain emit **`TransferWithScaledUI`**. This is not a subtle
 * difference in an ABI you can shrug at — a `getLogs` filter built from the
 * spec's name computes a different topic0 and matches **zero logs, forever**.
 * The failure is silent and it does not look like a bug. It looks like a chain
 * with no tokenized-equity activity on it.
 *
 * The signature and topic0 below were taken from a deployed stock token's own
 * logs, not from the ERC text.
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
 * Plain ERC-20 Transfer, for the cash side of a settlement.
 *
 * Every token on the chain emits this topic, so a subscription MUST be address
 * filtered to the stablecoins you care about. Unfiltered, it pulls every token
 * movement on Robinhood Chain into every window.
 */
export const ERC20_TRANSFER_EVENT =
  "event Transfer(address indexed from, address indexed to, uint256 value)";

/** The multiplier is fixed-point with 18 decimals: 1e18 means "unadjusted". */
export const SCALED_UI_DECIMALS = 18;
export const SCALED_UI_ONE = 10n ** BigInt(SCALED_UI_DECIMALS);

/* ------------------------------------------------------------- multiplier */

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

export type ScaledUiMultiplierResult =
  | { known: true; multiplier: bigint }
  | { known: false; reason: ScaledUiMultiplierUnknownReason };

/**
 * Recover the multiplier from one transfer.
 *
 * Returned as a bigint scaled by 1e18, never a float. A JavaScript number
 * cannot hold a uint256 ratio exactly, and the entire hazard here is a figure
 * that is quietly slightly wrong, so this refuses to introduce one.
 *
 * Fails closed. A zero raw value makes the ratio undefined, not enormous, and
 * "we cannot tell" is a different answer from "the multiplier is 1" — callers
 * that flatten the two are the ones that publish a split-adjusted figure as if
 * it were unadjusted.
 */
export function readScaledUiMultiplier(transfer: ScaledUiTransfer): ScaledUiMultiplierResult {
  const { value, uiValue } = transfer;
  if (typeof value !== "bigint" || typeof uiValue !== "bigint") {
    throw new TypeError("value and uiValue must be bigints");
  }
  if (value < 0n || uiValue < 0n) return { known: false, reason: "negative-amount" };
  if (value === 0n) return { known: false, reason: "zero-raw-value" };
  if (uiValue === 0n) return { known: false, reason: "zero-ui-value" };
  return { known: true, multiplier: (uiValue * SCALED_UI_ONE) / value };
}

/** Raw units to the amount a holder is shown. */
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
 * Did a corporate action land between two observations?
 *
 * Deliberately reports only DIRECTION. The multiplier moving up is consistent
 * with a split and with a dividend adjustment; moving down is consistent with
 * a reverse split and with a correction. The event carries nothing that
 * separates them, so naming the cause here would be a guess wearing an API's
 * clothes. Pair this with a corporate-actions calendar if you need the reason.
 *
 * `toleranceBps` exists because the multiplier is recovered by division and
 * two transfers under the same multiplier can differ in the last unit. The
 * default treats anything under a basis point as noise.
 */
export function compareScaledUiMultiplier(
  previous: bigint,
  current: bigint,
  options: { toleranceBps?: number } = {},
): ScaledUiMultiplierChange {
  if (typeof previous !== "bigint" || typeof current !== "bigint") {
    throw new TypeError("previous and current must be bigints");
  }
  const toleranceBps = options.toleranceBps ?? 1;
  if (!Number.isInteger(toleranceBps) || toleranceBps < 0) {
    throw new RangeError("toleranceBps must be a non-negative integer");
  }
  const difference = current > previous ? current - previous : previous - current;
  const scale = previous > 0n ? previous : SCALED_UI_ONE;
  // difference/scale > toleranceBps/10000, without leaving bigint
  if (difference * 10_000n <= BigInt(toleranceBps) * scale) return { moved: false };
  return { moved: true, direction: current > previous ? "up" : "down", previous, current };
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

export type SettlementPriceResult =
  | {
      /** always true when a price is returned, and named to be read at the call site */
      inferred: true;
      /** cash per whole stock token, as an exact decimal string */
      price: string;
      /** the scale `price` is expressed at */
      decimals: number;
    }
  | { inferred: false; reason: "zero-stock-amount" | "zero-cash-amount" };

/**
 * Cash per stock token for one settlement.
 *
 * `inferred: true` is not decoration. No venue quoted this price. It is the
 * ratio of two amounts in a transaction, and the two parties may have agreed
 * it hours earlier, off-chain, at a level unrelated to any market. Treat it as
 * a reconstruction and say so wherever it is displayed. A count of settlements
 * is a hard fact; the level any one of them printed at is not.
 *
 * Exact throughout: the ratio is taken in bigint at `priceDecimals` and
 * formatted without ever touching a float.
 */
export function inferSettlementPrice(input: {
  settlement: DeliveryVersusPayment;
  /** decimals of the stock token */
  stockDecimals: number;
  /** decimals of the cash token */
  cashDecimals: number;
  /** scale of the returned price string */
  priceDecimals?: number;
}): SettlementPriceResult {
  const { settlement, stockDecimals, cashDecimals } = input;
  const priceDecimals = input.priceDecimals ?? 18;
  for (const [name, value] of [
    ["stockDecimals", stockDecimals],
    ["cashDecimals", cashDecimals],
    ["priceDecimals", priceDecimals],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new RangeError(`${name} must be an integer between 0 and 255`);
    }
  }
  const stockAmount = settlement.stock.value;
  const cashAmount = settlement.cash.value;
  if (stockAmount <= 0n) return { inferred: false, reason: "zero-stock-amount" };
  if (cashAmount <= 0n) return { inferred: false, reason: "zero-cash-amount" };

  // (cash / 10^cashDecimals) / (stock / 10^stockDecimals), carried at priceDecimals
  const numerator = cashAmount * 10n ** BigInt(stockDecimals) * 10n ** BigInt(priceDecimals);
  const denominator = stockAmount * 10n ** BigInt(cashDecimals);
  return {
    inferred: true,
    price: formatChainlinkAnswer(numerator / denominator, priceDecimals),
    decimals: priceDecimals,
  };
}
