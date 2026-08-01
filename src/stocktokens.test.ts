import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import {
  ERC8056_SPEC_EVENT_NAME,
  ERC8056_SPEC_TOPIC0,
  SCALED_UI_ONE,
  TRANSFER_WITH_SCALED_UI_EVENT,
  TRANSFER_WITH_SCALED_UI_TOPIC0,
  compareScaledUiMultiplier,
  formatScaledUiMultiplier,
  inferSettlementPrice,
  pairDeliveryVersusPayment,
  readScaledUiMultiplier,
  toRawAmount,
  toUiAmount,
  type SettlementLeg,
} from "./stocktokens.js";

const ALICE = "0xAAAa000000000000000000000000000000000001";
const BOB = "0xbbbb000000000000000000000000000000000002";
const CAROL = "0xcccc000000000000000000000000000000000003";
const TSLA = "0x1111111111111111111111111111111111111111";
const USDG = "0x2222222222222222222222222222222222222222";

const leg = (over: Partial<SettlementLeg> = {}): SettlementLeg => ({
  transactionHash: "0xtx1",
  token: TSLA,
  from: ALICE,
  to: BOB,
  value: 10n ** 18n,
  ...over,
});

describe("the name trap", () => {
  it("the deployed signature hashes to the exported topic0", () => {
    // the constant is load-bearing: it is the one thing a consumer cannot
    // derive from the EIP, so it is derived here instead of trusted
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
    // this is the whole reason the module exists. a filter built from
    // EIP-8056's text matches zero logs, forever, and looks like a chain with
    // no tokenized-equity activity rather than like a bug.
    const specTopic = keccak256(
      toHex(`${ERC8056_SPEC_EVENT_NAME}(address,address,uint256,uint256)`),
    );
    expect(specTopic).toBe(ERC8056_SPEC_TOPIC0);
    expect(specTopic).not.toBe(TRANSFER_WITH_SCALED_UI_TOPIC0);
  });
});

describe("readScaledUiMultiplier", () => {
  it("recovers an unadjusted multiplier exactly", () => {
    const r = readScaledUiMultiplier({ value: 5n * SCALED_UI_ONE, uiValue: 5n * SCALED_UI_ONE });
    expect(r).toEqual({ known: true, multiplier: SCALED_UI_ONE });
  });

  it("recovers a four-for-one split", () => {
    const r = readScaledUiMultiplier({ value: 10n ** 18n, uiValue: 4n * 10n ** 18n });
    expect(r.known && formatScaledUiMultiplier(r.multiplier)).toBe("4.000000000000000000");
  });

  it("says unknown rather than guessing when the raw value is zero", () => {
    // uiValue/0 is undefined, not enormous, and "we cannot tell" must not
    // collapse into "the multiplier is 1"
    expect(readScaledUiMultiplier({ value: 0n, uiValue: 10n })).toEqual({
      known: false,
      reason: "zero-raw-value",
    });
  });

  it("rejects a zero display amount against real units", () => {
    expect(readScaledUiMultiplier({ value: 10n, uiValue: 0n })).toEqual({
      known: false,
      reason: "zero-ui-value",
    });
  });

  it("treats a negative amount as a decode failure, not a value", () => {
    expect(readScaledUiMultiplier({ value: -1n, uiValue: 1n })).toEqual({
      known: false,
      reason: "negative-amount",
    });
  });

  it("throws on a float, rather than silently losing precision", () => {
    expect(() =>
      readScaledUiMultiplier({ value: 1 as unknown as bigint, uiValue: 1n }),
    ).toThrow(TypeError);
  });
});

describe("applying the multiplier", () => {
  it("scales raw units to the displayed amount", () => {
    expect(toUiAmount(3n * SCALED_UI_ONE, 2n * SCALED_UI_ONE)).toBe(6n * SCALED_UI_ONE);
  });

  it("inverts, and refuses to divide by a zero multiplier", () => {
    expect(toRawAmount(6n * SCALED_UI_ONE, 2n * SCALED_UI_ONE)).toBe(3n * SCALED_UI_ONE);
    expect(() => toRawAmount(1n, 0n)).toThrow(RangeError);
  });

  it("keeps a uint256-scale figure exact", () => {
    // the reason multipliers are bigint: this value cannot survive a float
    const raw = 123_456_789_123_456_789n;
    expect(toUiAmount(raw, SCALED_UI_ONE)).toBe(raw);
  });
});

describe("compareScaledUiMultiplier", () => {
  it("reports direction and refuses to name the cause", () => {
    const change = compareScaledUiMultiplier(SCALED_UI_ONE, 4n * SCALED_UI_ONE);
    // a split and a dividend adjustment both move it up, and the event carries
    // nothing that separates them
    expect(change).toEqual({
      moved: true,
      direction: "up",
      previous: SCALED_UI_ONE,
      current: 4n * SCALED_UI_ONE,
    });
  });

  it("calls a division wobble no movement", () => {
    // the multiplier is recovered by dividing, so two transfers under one
    // corporate-action state can differ in the last unit
    expect(compareScaledUiMultiplier(SCALED_UI_ONE, SCALED_UI_ONE + 1n)).toEqual({ moved: false });
  });

  it("catches a move just past the tolerance", () => {
    const current = SCALED_UI_ONE + SCALED_UI_ONE / 5_000n;
    expect(compareScaledUiMultiplier(SCALED_UI_ONE, current).moved).toBe(true);
  });

  it("reports a reverse move as down", () => {
    const change = compareScaledUiMultiplier(4n * SCALED_UI_ONE, SCALED_UI_ONE);
    expect(change.moved && change.direction).toBe("down");
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
    // cash going to a third party is not payment for this delivery
    const unrelated = leg({ token: USDG, from: BOB, to: CAROL, value: 1n });
    expect(pairDeliveryVersusPayment({ stockLegs: [stock], cashLegs: [unrelated] })).toEqual([]);
  });

  it("leaves a batched transaction unclassified rather than guessing", () => {
    const second = leg({ from: CAROL, to: BOB });
    expect(
      pairDeliveryVersusPayment({ stockLegs: [stock, second], cashLegs: [cash] }),
    ).toEqual([]);
  });

  it("ignores a stock transfer with no cash leg at all", () => {
    // an ordinary wallet-to-wallet move is not a trade
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

describe("inferSettlementPrice", () => {
  const settlement = pairDeliveryVersusPayment({
    stockLegs: [leg({ value: 2n * 10n ** 18n })],
    cashLegs: [leg({ token: USDG, from: BOB, to: ALICE, value: 800n * 10n ** 6n })],
  })[0]!;

  it("divides across differing decimals exactly", () => {
    const price = inferSettlementPrice({
      settlement,
      stockDecimals: 18,
      cashDecimals: 6,
      priceDecimals: 2,
    });
    expect(price).toEqual({ inferred: true, price: "400.00", decimals: 2 });
  });

  it("carries `inferred` in the result, because nobody quoted this", () => {
    const price = inferSettlementPrice({
      settlement,
      stockDecimals: 18,
      cashDecimals: 6,
      priceDecimals: 18,
    });
    expect(price.inferred).toBe(true);
  });

  it("rejects an impossible decimals argument instead of returning a number", () => {
    expect(() =>
      inferSettlementPrice({ settlement, stockDecimals: 18, cashDecimals: -1 }),
    ).toThrow(RangeError);
  });
});
