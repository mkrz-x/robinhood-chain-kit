import { describe, expect, it } from "vitest";
import {
  getUsEquityMarketSession,
  isFeedFresh,
  isUsEquityMarketOpen,
} from "./markethours.js";

/** epoch seconds for a wall-clock time in a fixed UTC offset */
const at = (y: number, mo: number, d: number, h: number, mi: number, utcOffsetHours: number) =>
  Date.UTC(y, mo - 1, d, h + utcOffsetHours, mi) / 1000;

describe("isUsEquityMarketOpen", () => {
  // EST (winter, UTC-5): Tue 2026-01-13
  it("regular session boundaries under EST", () => {
    expect(isUsEquityMarketOpen(at(2026, 1, 13, 9, 29, 5))).toBe(false);
    expect(isUsEquityMarketOpen(at(2026, 1, 13, 9, 30, 5))).toBe(true);
    expect(isUsEquityMarketOpen(at(2026, 1, 13, 12, 0, 5))).toBe(true);
    expect(isUsEquityMarketOpen(at(2026, 1, 13, 15, 59, 5))).toBe(true);
    expect(isUsEquityMarketOpen(at(2026, 1, 13, 16, 0, 5))).toBe(false);
  });

  // EDT (summer, UTC-4): Tue 2026-07-14 — same wall clock, different offset.
  // If DST were mishandled these would land an hour off and flip.
  it("regular session boundaries under EDT", () => {
    expect(isUsEquityMarketOpen(at(2026, 7, 14, 9, 29, 4))).toBe(false);
    expect(isUsEquityMarketOpen(at(2026, 7, 14, 9, 30, 4))).toBe(true);
    expect(isUsEquityMarketOpen(at(2026, 7, 14, 15, 59, 4))).toBe(true);
    expect(isUsEquityMarketOpen(at(2026, 7, 14, 16, 0, 4))).toBe(false);
  });

  it("weekends are closed even mid-day", () => {
    expect(isUsEquityMarketOpen(at(2026, 1, 17, 12, 0, 5))).toBe(false); // Sat
    expect(isUsEquityMarketOpen(at(2026, 1, 18, 12, 0, 5))).toBe(false); // Sun
  });

  it("overnight is closed", () => {
    expect(isUsEquityMarketOpen(at(2026, 1, 13, 3, 0, 5))).toBe(false);
    expect(isUsEquityMarketOpen(at(2026, 1, 13, 20, 0, 5))).toBe(false);
  });

  it("closes for exchange holidays, including observed holidays", () => {
    expect(isUsEquityMarketOpen(at(2026, 11, 26, 12, 0, 5))).toBe(false); // Thanksgiving
    expect(isUsEquityMarketOpen(at(2026, 7, 3, 12, 0, 4))).toBe(false); // July 4 observed
    expect(getUsEquityMarketSession(at(2026, 11, 26, 12, 0, 5))).toMatchObject({
      phase: "closed",
      reason: "holiday",
      holiday: "Thanksgiving Day",
    });
  });

  it("uses the 13:00 ET close on scheduled early-close days", () => {
    const before = getUsEquityMarketSession(at(2026, 11, 27, 12, 59, 5));
    const after = getUsEquityMarketSession(at(2026, 11, 27, 13, 0, 5));
    expect(before).toMatchObject({ phase: "regular", earlyClose: true });
    expect(after).toMatchObject({ phase: "closed", reason: "after-close", earlyClose: true });
  });

  it("does not invent an early close before an observed Saturday Independence Day", () => {
    expect(getUsEquityMarketSession(at(2026, 7, 2, 15, 0, 4))).toMatchObject({
      phase: "regular",
      earlyClose: false,
      closeMinutes: 16 * 60,
    });
  });

  it("uses the published early close before a Tuesday Independence Day", () => {
    expect(getUsEquityMarketSession(at(2028, 7, 3, 13, 0, 4))).toMatchObject({
      phase: "closed",
      reason: "after-close",
      earlyClose: true,
    });
  });

  it("does not observe a Saturday New Year's Day on the preceding Friday", () => {
    expect(getUsEquityMarketSession(at(2027, 12, 31, 12, 0, 5))).toMatchObject({
      phase: "regular",
      earlyClose: false,
    });
  });

  it("treats invalid or millisecond timestamps as closed without throwing", () => {
    expect(isUsEquityMarketOpen(Number.NaN)).toBe(false);
    expect(isUsEquityMarketOpen(Date.now())).toBe(false);
    expect(getUsEquityMarketSession(Number.NaN)).toMatchObject({
      phase: "closed",
      reason: "invalid",
    });
  });
});

describe("isFeedFresh", () => {
  it("checks heartbeat freshness independently from the regular session", () => {
    expect(isFeedFresh(1_000, 300, 1_299)).toMatchObject({
      fresh: true,
      reason: "fresh",
      ageSeconds: 299,
    });
    expect(isFeedFresh(1_000, 300, 1_301)).toMatchObject({
      fresh: false,
      reason: "stale",
      ageSeconds: 301,
    });
  });

  it("rejects invalid and future feed timestamps", () => {
    expect(isFeedFresh(0, 300, 1_000)).toMatchObject({ fresh: false, reason: "invalid" });
    expect(isFeedFresh(1_001, 300, 1_000)).toMatchObject({ fresh: false, reason: "future" });
  });
});
