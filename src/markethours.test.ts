import { describe, expect, it } from "vitest";
import { isUsEquityMarketOpen } from "./markethours.js";

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
});
