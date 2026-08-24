/**
 * Premium math for tokenized equities — where people can actually find it.
 *
 * The trap this module names: **the Chainlink feed prices the TOKEN, not the
 * share.** The official docs are explicit — "The feed returns the price of one
 * token, which is the underlying share price times the multiplier" and
 * "latestRoundData() always returns this full, multiplier-adjusted value"
 * (docs.robinhood.com/chain/oracles-and-price-feeds). Because dividends are
 * reinvested through the multiplier, the token price drifts ABOVE the headline
 * share price over time, and comparing a feed answer against a stock quote
 * from anywhere else without dividing the multiplier back out reports a
 * "premium" that is actually just accrued dividends.
 */
import { formatChainlinkAnswer } from "./feeds.js";
import { SCALED_UI_ONE } from "./stocktokens.js";
import {
  computePriceDeviationBps,
  computeSignedPriceDeviationBps,
  type PriceValue,
} from "./deviation.js";

export { computePriceDeviationBps, computeSignedPriceDeviationBps };
export type { PriceValue };

/**
 * Underlying share price from a feed answer and the token's multiplier.
 *
 * Direction verified against the official docs, which state it as a formula:
 * "Underlying share price: feedPrice * 1e18 / uiMultiplier()" — and warn about
 * the 1e18 trap in the same breath: "Always divide by 1e18 after applying it
 * ... otherwise the result is off by a factor of 1e18". This function is that
 * formula, in bigint, with the division order that cannot overflow the
 * intermediate into a float.
 *
 * The result is at the same scale as `feedAnswer` (`feedDecimals`), truncated
 * toward zero by integer division — at 8 feed decimals that is a truncation of
 * less than a hundred-millionth of a dollar.
 *
 * `uiMultiplier` must be the AUTHORITATIVE contract value (1e18-scaled). An
 * estimate imports its uncertainty into a price without saying so.
 */
export function underlyingSharePrice(
  feedAnswer: bigint,
  feedDecimals: number,
  uiMultiplier: bigint,
): bigint {
  if (typeof feedAnswer !== "bigint" || feedAnswer <= 0n) {
    throw new RangeError("feedAnswer must be a positive bigint");
  }
  if (!Number.isInteger(feedDecimals) || feedDecimals < 0 || feedDecimals > 255) {
    throw new RangeError("feedDecimals must be an integer between 0 and 255");
  }
  if (typeof uiMultiplier !== "bigint" || uiMultiplier <= 0n) {
    throw new RangeError("uiMultiplier must be a positive bigint");
  }
  return (feedAnswer * SCALED_UI_ONE) / uiMultiplier;
}

/** `underlyingSharePrice`, formatted as an exact decimal string. */
export function formatUnderlyingSharePrice(
  feedAnswer: bigint,
  feedDecimals: number,
  uiMultiplier: bigint,
): string {
  return formatChainlinkAnswer(
    underlyingSharePrice(feedAnswer, feedDecimals, uiMultiplier),
    feedDecimals,
  );
}

export interface PremiumBpsInput {
  /** the venue's level — a DEX pool price or an inferred settlement price */
  dexOrSettlementPrice: PriceValue;
  /** the oracle's level for the SAME unit (token vs token, share vs share) */
  oraclePrice: PriceValue;
}

/**
 * Signed venue-vs-oracle premium in basis points: positive when the venue
 * trades ABOVE the oracle, negative below.
 *
 * Both prices must quote the same unit. A DEX pool prices the raw token, and
 * the feed prices the token too, so those two compare directly — but an
 * inferred UI settlement price is per displayed share, and comparing it
 * against the token feed manufactures a premium equal to the multiplier.
 * Convert one side first (`underlyingSharePrice`), then compare.
 *
 * Exact throughout; the magnitude is ceiling-rounded like
 * `computePriceDeviationBps`, so thresholds cannot be squeaked under.
 */
export function premiumBps(input: PremiumBpsInput): bigint {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("input must be an object");
  }
  return computeSignedPriceDeviationBps(input.oraclePrice, input.dexOrSettlementPrice);
}
