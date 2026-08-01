import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import {
  ERC8056_ABI,
  ERC8056_SPEC_EVENT_NAME,
  ERC8056_SPEC_TOPIC0,
  ERC8056_VERIFICATION,
  SCALED_UI_ONE,
  UIMULTIPLIER_UPDATED_EVENT,
  UIMULTIPLIER_UPDATED_TOPIC0,
  TRANSFER_WITH_SCALED_UI_EVENT,
  TRANSFER_WITH_SCALED_UI_TOPIC0,
  compareScaledUiEstimates,
  compareScaledUiMultiplier,
  estimateScaledUiMultiplier,
  formatScaledUiMultiplier,
  getErc8056ReadCalls,
  inferRawSettlementPrice,
  inferSettlementPrice,
  inferUiSettlementPrice,
  pairDeliveryVersusPayment,
  readScaledUiMultiplier,
  resolveScaledUiMultiplier,
  toRawAmount,
  toUiAmount,
  type SettlementLeg,
} from "./stocktokens.js";

const ALICE = "0xAAAa000000000000000000000000000000000001";
const BOB = "0xbbbb000000000000000000000000000000000002";
const CAROL = "0xcccc000000000000000000000000000000000003";
const TSLA = "0x1111111111111111111111111111111111111111";
const USDG = "0x2222222222222222222222222222222222222222";

const ONE = SCALED_UI_ONE;

/**
 * What the contract does before anyone sees the event.
 *
 * Tests generate observations through this rather than hand-writing a
 * `uiValue`, so the truncation under test is the real one.
 */
const emit = (rawValue: bigint, multiplier: bigint) => ({
  value: rawValue,
  uiValue: (rawValue * multiplier) / ONE,
});

const leg = (over: Partial<SettlementLeg> = {}): SettlementLeg => ({
  transactionHash: "0xtx1",
  token: TSLA,
  from: ALICE,
  to: BOB,
  value: ONE,
  ...over,
});

/** one share of an 18-decimal stock token against 400 USDG at 6 decimals */
const tradeOf = (stockRaw: bigint, cashUnits: bigint) =>
  pairDeliveryVersusPayment({
    stockLegs: [leg({ value: stockRaw })],
    cashLegs: [leg({ token: USDG, from: BOB, to: ALICE, value: cashUnits })],
  })[0]!;

describe("the name trap", () => {
  it("the deployed signature hashes to the exported topic0", () => {
    const signature = TRANSFER_WITH_SCALED_UI_EVENT.replace(
      /^event (\w+)\((.*)\)$/,
      (_, name: string, args: string) =>
        `${name}(${args
          .split(",")
          .map((a) => a.trim().split(/\s+/)[0])
          .join(",")})`,
    );
    expect(signature).toBe("TransferWithScaledUI(address,address,uint256,uint256)");
    expect(keccak256(toHex(signature))).toBe(TRANSFER_WITH_SCALED_UI_TOPIC0);
  });

  it("the spec's name hashes to something else entirely", () => {
    const specTopic = keccak256(
      toHex(`${ERC8056_SPEC_EVENT_NAME}(address,address,uint256,uint256)`),
    );
    expect(specTopic).toBe(ERC8056_SPEC_TOPIC0);
    expect(specTopic).not.toBe(TRANSFER_WITH_SCALED_UI_TOPIC0);
  });
});

describe("the ABI says what it has actually seen", () => {
  it("records how each member was verified against chain 4663", () => {
    // the three reads answered eth_call on live stock tokens; both events were
    // found in the beacon implementation's bytecode and then in emitted logs
    expect(ERC8056_VERIFICATION.TransferWithScaledUI).toBe("deployed-logs");
    expect(ERC8056_VERIFICATION.UIMultiplierUpdated).toBe("deployed-logs");
    for (const member of ["uiMultiplier", "newUIMultiplier", "effectiveAt"]) {
      expect(ERC8056_VERIFICATION[member]).toBe("deployed-call");
    }
  });

  it("the update signature hashes to the exported topic0", () => {
    // published only once earned. 0.7.0 withheld it because an unverified
    // topic0 fails silently, which is the trap this module warns about.
    const signature = UIMULTIPLIER_UPDATED_EVENT.replace(
      /^event (\w+)\((.*)\)$/,
      (_, name: string, args: string) =>
        `${name}(${args
          .split(",")
          .map((a) => a.trim().split(/\s+/)[0])
          .join(",")})`,
    );
    expect(signature).toBe("UIMultiplierUpdated(uint256,uint256,uint256)");
    expect(keccak256(toHex(signature))).toBe(UIMULTIPLIER_UPDATED_TOPIC0);
  });

  it("declares all three update parameters non-indexed, as the logs show", () => {
    // every emission on chain carries exactly one topic and 96 bytes of data
    const event = ERC8056_ABI.find((i) => i.name === "UIMultiplierUpdated")!;
    expect(event.inputs.every((i) => i.indexed === false)).toBe(true);
    expect(event.inputs).toHaveLength(3);
  });

  it("every ABI member has a verification entry", () => {
    for (const item of ERC8056_ABI) {
      expect(ERC8056_VERIFICATION[item.name]).toBeDefined();
    }
  });

  it("builds authoritative read calls and carries their provenance", () => {
    const calls = getErc8056ReadCalls(TSLA);
    expect(calls.map((c) => c.functionName)).toEqual([
      "uiMultiplier",
      "newUIMultiplier",
      "effectiveAt",
    ]);
    expect(calls.every((c) => c.provenance === "deployed-call")).toBe(true);
  });

  it("rejects a malformed token address", () => {
    expect(() => getErc8056ReadCalls("0xdead")).toThrow(TypeError);
  });
});

describe("a multiplier recovered from one transfer is an estimate", () => {
  it("cannot recover 1.5 from a three-unit transfer, and says so with bounds", () => {
    // the contract computes floor(3 * 1.5) = 4 and emits that. dividing back
    // gives 1.333…, which is not the multiplier and never was.
    const observation = emit(3n, (15n * ONE) / 10n);
    expect(observation.uiValue).toBe(4n);

    const estimate = estimateScaledUiMultiplier(observation);
    expect(estimate.estimated).toBe(true);
    if (!estimate.estimated) return;
    expect(estimate.lowerBound).toBe(1_333_333_333_333_333_334n);
    expect(estimate.upperBoundExclusive).toBe(1_666_666_666_666_666_667n);
    // the true multiplier is inside the range, which is the guarantee
    expect(estimate.lowerBound <= (15n * ONE) / 10n).toBe(true);
    expect((15n * ONE) / 10n < estimate.upperBoundExclusive).toBe(true);
  });

  it("a one-unit transfer bounds almost nothing", () => {
    const estimate = estimateScaledUiMultiplier(emit(1n, (15n * ONE) / 10n));
    expect(estimate.estimated).toBe(true);
    if (!estimate.estimated) return;
    // anything from 1x to just under 2x could have produced this
    expect(estimate.lowerBound).toBe(ONE);
    expect(estimate.upperBoundExclusive).toBe(2n * ONE);
  });

  it("a whole-token transfer pins the multiplier exactly", () => {
    const estimate = estimateScaledUiMultiplier(emit(ONE, 4n * ONE));
    expect(estimate.estimated).toBe(true);
    if (!estimate.estimated) return;
    expect(estimate.multiplier).toBe(4n * ONE);
    // width 1: exactly one multiplier is consistent with the observation
    expect(estimate.upperBoundExclusive - estimate.lowerBound).toBe(1n);
  });

  it("two transfers under ONE unchanged multiplier give different point estimates", () => {
    const trueMultiplier = (12n * ONE) / 10n;
    const small = estimateScaledUiMultiplier(emit(3n, trueMultiplier));
    const larger = estimateScaledUiMultiplier(emit(7n, trueMultiplier));
    expect(small.estimated && larger.estimated).toBe(true);
    if (!small.estimated || !larger.estimated) return;
    // this disagreement is arithmetic, not a corporate action
    expect(small.multiplier).toBe(1_166_666_666_666_666_666n);
    expect(larger.multiplier).toBe(1_214_285_714_285_714_286n);
    expect(small.multiplier).not.toBe(larger.multiplier);
    // and both ranges contain the truth
    for (const e of [small, larger]) {
      expect(e.lowerBound <= trueMultiplier && trueMultiplier < e.upperBoundExclusive).toBe(true);
    }
  });

  it("the point estimate always lies inside its own bounds", () => {
    for (let raw = 1n; raw <= 64n; raw += 1n) {
      for (const m of [ONE, (15n * ONE) / 10n, (12n * ONE) / 10n, 4n * ONE, ONE / 4n]) {
        const observation = emit(raw, m);
        if (observation.uiValue === 0n) continue;
        const e = estimateScaledUiMultiplier(observation);
        expect(e.estimated).toBe(true);
        if (!e.estimated) continue;
        expect(e.lowerBound <= e.multiplier).toBe(true);
        expect(e.multiplier < e.upperBoundExclusive).toBe(true);
        // and the truth is bounded, which is the only claim this makes
        expect(e.lowerBound <= m && m < e.upperBoundExclusive).toBe(true);
      }
    }
  });

  it("fails closed on amounts that cannot bound anything", () => {
    expect(estimateScaledUiMultiplier({ value: 0n, uiValue: 10n })).toEqual({
      estimated: false,
      reason: "zero-raw-value",
    });
    expect(estimateScaledUiMultiplier({ value: 10n, uiValue: 0n })).toEqual({
      estimated: false,
      reason: "zero-ui-value",
    });
    expect(estimateScaledUiMultiplier({ value: -1n, uiValue: 1n })).toEqual({
      estimated: false,
      reason: "negative-amount",
    });
    expect(estimateScaledUiMultiplier({ value: 1n, uiValue: -1n })).toEqual({
      estimated: false,
      reason: "negative-amount",
    });
  });

  it("throws on a float, rather than silently losing precision", () => {
    expect(() => estimateScaledUiMultiplier({ value: 1 as unknown as bigint, uiValue: 1n })).toThrow(
      TypeError,
    );
  });
});

describe("readScaledUiMultiplier (deprecated)", () => {
  it("still returns the 0.7.0 shape so callers keep compiling", () => {
    expect(readScaledUiMultiplier(emit(ONE, 4n * ONE))).toEqual({
      known: true,
      multiplier: 4n * ONE,
    });
    expect(readScaledUiMultiplier({ value: 0n, uiValue: 1n })).toEqual({
      known: false,
      reason: "zero-raw-value",
    });
  });

  it("no longer returns a value outside the feasible range", () => {
    // 0.7.0 divided with floor: 4e18/3 = 1333333333333333333, one below the
    // smallest multiplier that could have produced the observation
    const result = readScaledUiMultiplier(emit(3n, (15n * ONE) / 10n));
    expect(result.known && result.multiplier).toBe(15n * ONE / 10n);
    expect(result.known && result.multiplier >= 1_333_333_333_333_333_334n).toBe(true);
  });
});

describe("applying the multiplier", () => {
  it("scales raw units to the displayed amount", () => {
    expect(toUiAmount(3n * ONE, 2n * ONE)).toBe(6n * ONE);
  });

  it("inverts, and refuses to divide by a zero multiplier", () => {
    expect(toRawAmount(6n * ONE, 2n * ONE)).toBe(3n * ONE);
    expect(() => toRawAmount(1n, 0n)).toThrow(RangeError);
  });

  it("keeps a uint256-scale figure exact", () => {
    const raw = 123_456_789_123_456_789n;
    expect(toUiAmount(raw, ONE)).toBe(raw);
  });
});

describe("compareScaledUiMultiplier — authoritative readings only", () => {
  it("reports direction and refuses to name the cause", () => {
    expect(compareScaledUiMultiplier(ONE, 4n * ONE)).toEqual({
      moved: true,
      direction: "up",
      previous: ONE,
      current: 4n * ONE,
    });
  });

  it("reports a reverse move as down", () => {
    const change = compareScaledUiMultiplier(4n * ONE, ONE);
    expect(change.moved && change.direction).toBe("down");
  });

  it("no longer hides a small real adjustment behind a default tolerance", () => {
    // 0.7.0 defaulted toleranceBps to 1 to absorb estimate noise. an
    // authoritative reading has no noise, and a dead band here would swallow a
    // genuine corporate action.
    expect(compareScaledUiMultiplier(ONE, ONE + 1n).moved).toBe(true);
  });

  it("still offers an explicit dead band for callers who want one", () => {
    expect(compareScaledUiMultiplier(ONE, ONE + 1n, { toleranceBps: 1 }).moved).toBe(false);
  });

  it("rejects a negative tolerance", () => {
    expect(() => compareScaledUiMultiplier(ONE, ONE, { toleranceBps: -1 })).toThrow(RangeError);
  });
});

describe("compareScaledUiEstimates — proof, not signal", () => {
  it("does NOT claim a corporate action from overlapping ranges", () => {
    // the regression this function exists for: two differently sized transfers
    // under one unchanged multiplier
    const trueMultiplier = (12n * ONE) / 10n;
    const comparison = compareScaledUiEstimates(
      estimateScaledUiMultiplier(emit(3n, trueMultiplier)),
      estimateScaledUiMultiplier(emit(7n, trueMultiplier)),
    );
    expect(comparison).toEqual({ comparable: true, moved: false });
  });

  it("reports a move only when no single multiplier explains both", () => {
    const before = estimateScaledUiMultiplier(emit(ONE, ONE));
    const after = estimateScaledUiMultiplier(emit(ONE, 4n * ONE));
    expect(compareScaledUiEstimates(before, after)).toEqual({
      comparable: true,
      moved: true,
      direction: "up",
    });
    expect(compareScaledUiEstimates(after, before)).toEqual({
      comparable: true,
      moved: true,
      direction: "down",
    });
  });

  it("a real change hidden inside two wide ranges is reported as unproven", () => {
    // honest limitation: one-unit transfers bound almost nothing, so 1.5x to
    // 1.9x is invisible here. the answer is a contract read, not a louder guess.
    const before = estimateScaledUiMultiplier(emit(1n, (15n * ONE) / 10n));
    const after = estimateScaledUiMultiplier(emit(1n, (19n * ONE) / 10n));
    expect(compareScaledUiEstimates(before, after)).toEqual({ comparable: true, moved: false });
  });

  it("passes an unusable observation through as not comparable", () => {
    expect(
      compareScaledUiEstimates(
        estimateScaledUiMultiplier({ value: 0n, uiValue: 1n }),
        estimateScaledUiMultiplier(emit(ONE, ONE)),
      ),
    ).toEqual({ comparable: false, reason: "zero-raw-value" });
  });
});

describe("pairDeliveryVersusPayment", () => {
  const stock = leg();
  const cash = leg({ token: USDG, from: BOB, to: ALICE, value: 400n * 10n ** 6n });

  it("pairs opposed legs in one transaction into a trade", () => {
    const [settlement] = pairDeliveryVersusPayment({ stockLegs: [stock], cashLegs: [cash] });
    expect(settlement!.seller).toBe(ALICE);
    expect(settlement!.buyer).toBe(BOB);
  });

  it("matches addresses across casing", () => {
    const mixed = leg({ token: USDG, from: BOB.toUpperCase(), to: ALICE.toLowerCase(), value: 1n });
    expect(pairDeliveryVersusPayment({ stockLegs: [stock], cashLegs: [mixed] })).toHaveLength(1);
  });

  it("refuses two transfers that merely share a transaction", () => {
    const unrelated = leg({ token: USDG, from: BOB, to: CAROL, value: 1n });
    expect(pairDeliveryVersusPayment({ stockLegs: [stock], cashLegs: [unrelated] })).toEqual([]);
  });

  it("leaves a batched transaction unclassified rather than guessing", () => {
    const second = leg({ from: CAROL, to: BOB });
    expect(pairDeliveryVersusPayment({ stockLegs: [stock, second], cashLegs: [cash] })).toEqual([]);
  });

  it("ignores a stock transfer with no cash leg at all", () => {
    expect(pairDeliveryVersusPayment({ stockLegs: [stock], cashLegs: [] })).toEqual([]);
  });

  it("keeps separate transactions separate", () => {
    const otherStock = leg({ transactionHash: "0xtx2", from: CAROL, to: BOB });
    const otherCash = leg({
      transactionHash: "0xtx2",
      token: USDG,
      from: BOB,
      to: CAROL,
      value: 5n,
    });
    const out = pairDeliveryVersusPayment({
      stockLegs: [stock, otherStock],
      cashLegs: [cash, otherCash],
    });
    expect(out.map((s) => s.transactionHash)).toEqual(["0xtx1", "0xtx2"]);
  });

  it("drops a self-transfer even when the shape matches", () => {
    const self = leg({ from: ALICE, to: ALICE });
    const selfCash = leg({ token: USDG, from: ALICE, to: ALICE, value: 1n });
    expect(pairDeliveryVersusPayment({ stockLegs: [self], cashLegs: [selfCash] })).toEqual([]);
  });
});

describe("settlement pricing states its unit", () => {
  // one raw share of an 18-decimal token against 400 USDG at 6 decimals
  const settlement = tradeOf(ONE, 400n * 10n ** 6n);
  const scales = { stockDecimals: 18, cashDecimals: 6, priceDecimals: 2 } as const;

  it("prices per raw unit and says so", () => {
    expect(inferRawSettlementPrice({ settlement, ...scales })).toEqual({
      inferred: true,
      price: "400.00",
      decimals: 2,
      stockAmountMode: "raw",
    });
  });

  it("four-for-one split: raw 400, displayed 100", () => {
    // one raw unit under a 4x multiplier is four displayed shares, so the
    // person reading "per share" wants a quarter of the raw price
    const ui = inferUiSettlementPrice({ settlement, ...scales, stockMultiplier: 4n * ONE });
    expect(ui).toEqual({ inferred: true, price: "100.00", decimals: 2, stockAmountMode: "ui" });
    const raw = inferRawSettlementPrice({ settlement, ...scales });
    expect(raw.inferred && raw.price).toBe("400.00");
  });

  it("reverse split: fewer displayed shares means a higher displayed price", () => {
    const ui = inferUiSettlementPrice({ settlement, ...scales, stockMultiplier: ONE / 4n });
    expect(ui.inferred && ui.price).toBe("1600.00");
  });

  it("takes the contract's own uiValue in preference to a multiplier", () => {
    const fromLog = inferUiSettlementPrice({ settlement, ...scales, stockUiValue: 4n * ONE });
    const fromMultiplier = inferUiSettlementPrice({
      settlement,
      ...scales,
      stockMultiplier: 4n * ONE,
    });
    expect(fromLog).toEqual(fromMultiplier);
  });

  it("divides across differing decimals exactly", () => {
    // stock 18, cash 6: two shares against 800 USDG
    const two = tradeOf(2n * ONE, 800n * 10n ** 6n);
    expect(inferRawSettlementPrice({ settlement: two, ...scales }).inferred).toBe(true);
    expect(
      (inferRawSettlementPrice({ settlement: two, ...scales }) as { price: string }).price,
    ).toBe("400.00");
  });

  it("carries `inferred` in the result, because nobody quoted this", () => {
    expect(inferRawSettlementPrice({ settlement, stockDecimals: 18, cashDecimals: 6 }).inferred).toBe(
      true,
    );
  });

  it("refuses a pricing basis it would have to guess", () => {
    // both, or neither, is a call site that has not decided what it is asking
    expect(() =>
      inferUiSettlementPrice({
        settlement,
        ...scales,
        stockUiValue: ONE,
        stockMultiplier: ONE,
      } as never),
    ).toThrow(TypeError);
    expect(() => inferUiSettlementPrice({ settlement, ...scales } as never)).toThrow(TypeError);
  });

  it("fails closed when the multiplier scales the position to nothing", () => {
    const tiny = tradeOf(1n, 400n * 10n ** 6n);
    expect(inferUiSettlementPrice({ settlement: tiny, ...scales, stockMultiplier: 1n })).toEqual({
      inferred: false,
      reason: "zero-ui-stock-amount",
    });
  });

  it("rejects zero, negative and out-of-range inputs", () => {
    expect(() =>
      inferRawSettlementPrice({ settlement, stockDecimals: 18, cashDecimals: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      inferRawSettlementPrice({ settlement, stockDecimals: 256, cashDecimals: 6 }),
    ).toThrow(RangeError);
    expect(() =>
      inferUiSettlementPrice({ settlement, ...scales, stockMultiplier: 0n }),
    ).toThrow(RangeError);
    expect(() =>
      inferUiSettlementPrice({ settlement, ...scales, stockUiValue: -1n }),
    ).toThrow(RangeError);
    expect(
      inferUiSettlementPrice({ settlement, ...scales, stockUiValue: 0n }),
    ).toEqual({ inferred: false, reason: "zero-ui-stock-amount" });
  });
});

describe("inferSettlementPrice (deprecated)", () => {
  const settlement = tradeOf(ONE, 400n * 10n ** 6n);

  it("keeps 0.7.0 behaviour and now names the unit it was always using", () => {
    expect(
      inferSettlementPrice({ settlement, stockDecimals: 18, cashDecimals: 6, priceDecimals: 2 }),
    ).toEqual({ inferred: true, price: "400.00", decimals: 2, stockAmountMode: "raw" });
  });
});

describe("resolveScaledUiMultiplier — a schedule is not a state", () => {
  const at = (current: bigint, pending: bigint, effectiveAtSeconds: number, now: number) =>
    resolveScaledUiMultiplier({ current, pending, effectiveAtSeconds }, now);

  it("reports no schedule when effectiveAt is zero", () => {
    // what every unadjusted stock token on the chain reads today
    expect(at(ONE, ONE, 0, 1_785_609_523)).toEqual({ status: "none", multiplier: ONE });
  });

  it("never returns the pending value as the current multiplier", () => {
    // the failure this exists for: reading newUIMultiplier() as current prices
    // a split before it happens
    const resolved = at(ONE, 4n * ONE, 1_785_700_000, 1_785_609_523);
    expect(resolved).toEqual({
      status: "pending",
      multiplier: ONE,
      pending: 4n * ONE,
      effectiveAtSeconds: 1_785_700_000,
    });
  });

  it("calls a passed effective time with an unmoved contract `due`, not applied", () => {
    // ambiguous state: the change should be live and the contract disagrees.
    // anything derived from either value is unsafe until it resolves.
    const resolved = at(ONE, 4n * ONE, 1_785_000_000, 1_785_609_523);
    expect(resolved.status).toBe("due");
    expect(resolved.multiplier).toBe(ONE);
  });

  it("reports applied once the contract itself has moved", () => {
    // the live shape of all five tokens that have ever had a corporate action
    expect(at(4n * ONE, 4n * ONE, 1_782_999_000, 1_785_609_523)).toEqual({
      status: "applied",
      multiplier: 4n * ONE,
      effectiveAtSeconds: 1_782_999_000,
    });
  });

  it("rejects malformed state instead of resolving it", () => {
    expect(() => at(1 as unknown as bigint, ONE, 0, 0)).toThrow(TypeError);
    expect(() => at(-1n, ONE, 0, 0)).toThrow(RangeError);
    expect(() => at(ONE, ONE, -1, 0)).toThrow(RangeError);
    expect(() => at(ONE, ONE, 0, Number.NaN)).toThrow(RangeError);
  });
});
