import { describe, expect, it } from "vitest";
import {
  getUsEquityMarketSession,
  isFeedFresh,
  isUsEquityMarketOpen,
  nextUsEquitySessionChange,
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

describe("nextUsEquitySessionChange counts down to the schedule, not to a guess", () => {
  it("mid-session, the next change is today's 16:00 ET close", () => {
    // Tue 2026-01-13, 12:00 EST
    expect(nextUsEquitySessionChange(at(2026, 1, 13, 12, 0, 5))).toEqual({
      at: at(2026, 1, 13, 16, 0, 5),
      to: "closed",
    });
  });

  it("before the open, the next change is today's 09:30 ET open", () => {
    expect(nextUsEquitySessionChange(at(2026, 7, 14, 7, 0, 4))).toEqual({
      at: at(2026, 7, 14, 9, 30, 4),
      to: "open",
    });
  });

  it("after the close, the countdown skips to the next trading day", () => {
    expect(nextUsEquitySessionChange(at(2026, 1, 13, 20, 0, 5))).toEqual({
      at: at(2026, 1, 14, 9, 30, 5),
      to: "open",
    });
  });

  it("across a weekend: Friday evening counts down to Monday's open", () => {
    // Fri 2026-01-16 20:00 EST → Mon 2026-01-19 is MLK Day → Tue 2026-01-20
    // ... unless a Monday holiday intervenes, which is the next test. Plain
    // weekend first: Fri 2026-01-23 → Mon 2026-01-26.
    expect(nextUsEquitySessionChange(at(2026, 1, 23, 20, 0, 5))).toEqual({
      at: at(2026, 1, 26, 9, 30, 5),
      to: "open",
    });
    // and Saturday mid-day points to the same open
    expect(nextUsEquitySessionChange(at(2026, 1, 24, 12, 0, 5))).toEqual({
      at: at(2026, 1, 26, 9, 30, 5),
      to: "open",
    });
  });

  it("a Monday holiday pushes the weekend countdown to Tuesday", () => {
    // Fri 2026-01-16 evening → Mon 2026-01-19 is Martin Luther King Jr. Day
    expect(nextUsEquitySessionChange(at(2026, 1, 16, 20, 0, 5))).toEqual({
      at: at(2026, 1, 20, 9, 30, 5),
      to: "open",
    });
    // and from inside the holiday itself
    expect(nextUsEquitySessionChange(at(2026, 1, 19, 12, 0, 5))).toEqual({
      at: at(2026, 1, 20, 9, 30, 5),
      to: "open",
    });
  });

  it("an early-close day counts down to 13:00 ET, not 16:00", () => {
    // Fri 2026-11-27, the day after Thanksgiving, 11:00 EST
    expect(nextUsEquitySessionChange(at(2026, 11, 27, 11, 0, 5))).toEqual({
      at: at(2026, 11, 27, 13, 0, 5),
      to: "closed",
    });
    // and Thanksgiving Day itself counts down to that Friday's open
    expect(nextUsEquitySessionChange(at(2026, 11, 26, 12, 0, 5))).toEqual({
      at: at(2026, 11, 27, 9, 30, 5),
      to: "open",
    });
  });

  it("boundaries are exact epochs: the open it reports is the open it means", () => {
    const change = nextUsEquitySessionChange(at(2026, 1, 13, 20, 0, 5));
    expect(isUsEquityMarketOpen(change.at)).toBe(true);
    expect(isUsEquityMarketOpen(change.at - 60)).toBe(false);
  });

  it("throws on a timestamp the calendar cannot place", () => {
    expect(() => nextUsEquitySessionChange(Number.NaN)).toThrow(RangeError);
    expect(() => nextUsEquitySessionChange(Date.now())).toThrow(RangeError);
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
