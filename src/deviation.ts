/**
 * Exact bigint price comparison, shared by the preflight firewall and the
 * premium helpers.
 *
 * This lives in its own module so `robinhood-chain-kit/oracle` can offer the
 * deviation math without dragging the entire preflight engine into a bundle
 * that only wanted to compare two prices. The failure mode the math itself
 * guards against: converting either price to a float first, where a 6-decimal
 * stablecoin amount against an 8-decimal oracle answer silently loses the
 * low-order digits that a basis-point comparison exists to notice.
 */

export interface PriceValue {
  value: bigint;
  decimals: number;
}

const MAX_UINT256 = (1n << 256n) - 1n;

const validate = (price: PriceValue, field: string): PriceValue => {
  if (typeof price !== "object" || price === null) {
    throw new TypeError(`${field} must be an object`);
  }
  if (typeof price.value !== "bigint" || price.value <= 0n || price.value > MAX_UINT256) {
    throw new TypeError(`${field}.value must be a positive uint256 bigint`);
  }
  if (!Number.isInteger(price.decimals) || price.decimals < 0 || price.decimals > 255) {
    throw new RangeError(`${field}.decimals must be an integer between 0 and 255`);
  }
  return { value: price.value, decimals: price.decimals };
};

/**
 * Exact, ceiling-rounded absolute deviation in basis points. Different decimal
 * scales are cross-multiplied; no floating-point conversion is used. Ceiling
 * rounding means a deviation is never reported smaller than it is, so a policy
 * threshold cannot be squeaked under by a fraction of a basis point.
 */
export function computePriceDeviationBps(
  reference: PriceValue,
  observed: PriceValue,
): bigint {
  const left = validate(reference, "reference");
  const right = validate(observed, "observed");
  const referenceScaled = left.value * 10n ** BigInt(right.decimals);
  const observedScaled = right.value * 10n ** BigInt(left.decimals);
  const difference =
    referenceScaled >= observedScaled
      ? referenceScaled - observedScaled
      : observedScaled - referenceScaled;
  return (difference * 10_000n + referenceScaled - 1n) / referenceScaled;
}

/**
 * Signed variant: positive when `observed` is above `reference`, negative
 * below, zero when equal. The magnitude is the same ceiling-rounded figure as
 * `computePriceDeviationBps`, so a signed result and its absolute counterpart
 * never disagree by rounding.
 */
export function computeSignedPriceDeviationBps(
  reference: PriceValue,
  observed: PriceValue,
): bigint {
  const magnitude = computePriceDeviationBps(reference, observed);
  const referenceScaled = reference.value * 10n ** BigInt(observed.decimals);
  const observedScaled = observed.value * 10n ** BigInt(reference.decimals);
  return observedScaled >= referenceScaled ? magnitude : -magnitude;
}
