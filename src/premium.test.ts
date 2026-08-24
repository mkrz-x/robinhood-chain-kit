import { describe, expect, it } from "vitest";
import {
  computePriceDeviationBps,
  computeSignedPriceDeviationBps,
  formatUnderlyingSharePrice,
  premiumBps,
  underlyingSharePrice,
} from "./premium.js";
import { calculatePriceDeviationBps } from "./preflight.js";
import { SCALED_UI_ONE } from "./stocktokens.js";

describe("underlyingSharePrice encodes the docs' direction, not a guess", () => {
  it("reproduces the docs' own example: $105 token at 1.05 is a $100 share", () => {
    // docs: "a token tracking a $100 stock ... the multiplier rises to ~1.05
    // ... the feed price is $105 (1.05 × $100)" and "Underlying share price:
    // feedPrice * 1e18 / uiMultiplier()"
    const feedAnswer = 105_00000000n; // $105 at 8 decimals
    const multiplier = 1_050_000_000_000_000_000n; // 1.05 at 1e18
    expect(underlyingSharePrice(feedAnswer, 8, multiplier)).toBe(100_00000000n);
    expect(formatUnderlyingSharePrice(feedAnswer, 8, multiplier)).toBe("100.00000000");
  });

  it("is the identity at multiplier 1", () => {
    expect(underlyingSharePrice(123_45n, 2, SCALED_UI_ONE)).toBe(123_45n);
  });

  it("divides a 4x post-split token price back to the share price", () => {
    expect(underlyingSharePrice(400_00000000n, 8, 4n * SCALED_UI_ONE)).toBe(100_00000000n);
  });

  it("truncates toward zero by integer division", () => {
    // 100 / 3 at 0 decimals: 33, not 33.33...
    expect(underlyingSharePrice(100n, 0, 3n * SCALED_UI_ONE)).toBe(33n);
  });

  it.each([
    ["zero answer", 0n, 8, SCALED_UI_ONE],
    ["negative answer", -1n, 8, SCALED_UI_ONE],
    ["zero multiplier", 1n, 8, 0n],
    ["negative multiplier", 1n, 8, -1n],
    ["fractional decimals", 1n, 1.5, SCALED_UI_ONE],
  ])("rejects %s", (_label, answer, decimals, multiplier) => {
    expect(() => underlyingSharePrice(answer as bigint, decimals as number, multiplier as bigint)).toThrow(
      RangeError,
    );
  });
});

describe("premiumBps is signed and unit-honest", () => {
  it("positive when the venue trades above the oracle", () => {
    expect(
      premiumBps({
        dexOrSettlementPrice: { value: 101_000000n, decimals: 6 },
        oraclePrice: { value: 100_00000000n, decimals: 8 },
      }),
    ).toBe(100n);
  });

  it("negative below, zero at par, across different decimal scales", () => {
    expect(
      premiumBps({
        dexOrSettlementPrice: { value: 99_000000n, decimals: 6 },
        oraclePrice: { value: 100_00000000n, decimals: 8 },
      }),
    ).toBe(-100n);
    expect(
      premiumBps({
        dexOrSettlementPrice: { value: 100_000000n, decimals: 6 },
        oraclePrice: { value: 100_00000000n, decimals: 8 },
      }),
    ).toBe(0n);
  });

  it("rejects a non-object input", () => {
    expect(() => premiumBps(null as never)).toThrow(TypeError);
  });
});

describe("the deviation math is one implementation under two names", () => {
  const reference = { value: 100_00000000n, decimals: 8 };
  const observed = { value: 103_000000n, decimals: 6 };

  it("computePriceDeviationBps and calculatePriceDeviationBps agree exactly", () => {
    expect(computePriceDeviationBps(reference, observed)).toBe(300n);
    expect(calculatePriceDeviationBps(reference, observed)).toBe(
      computePriceDeviationBps(reference, observed),
    );
  });

  it("ceiling-rounds so a threshold cannot be squeaked under", () => {
    // 1 part in 300000 is 0.033... bps and must report as 1, not 0
    expect(
      computePriceDeviationBps({ value: 300_000n, decimals: 0 }, { value: 300_001n, decimals: 0 }),
    ).toBe(1n);
  });

  it("the signed variant's magnitude never disagrees with the absolute one", () => {
    expect(computeSignedPriceDeviationBps(reference, observed)).toBe(300n);
    expect(computeSignedPriceDeviationBps(observed, reference)).toBe(
      -computePriceDeviationBps(observed, reference),
    );
  });

  it("validates both prices with the field names callers already know", () => {
    expect(() => computePriceDeviationBps({ value: 0n, decimals: 8 }, observed)).toThrow(
      /reference\.value/,
    );
    expect(() => computePriceDeviationBps(reference, { value: 1n, decimals: 256 })).toThrow(
      /observed\.decimals/,
    );
  });
});
