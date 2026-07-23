/**
 * US equity regular trading hours, in the exchange's own timezone.
 *
 * Why this exists: Chainlink equity feeds only move while the underlying
 * market trades. Outside those hours the feed freezes at the last print while
 * the DEX keeps trading 24/7, so a growing "gap" between the two is the
 * EXPECTED state, not a dislocation and not an arbitrage. Calling it one is
 * simply wrong, and we published that mistake for a week ($TSLA six times in
 * ten hours, all after the close).
 *
 * The feed's own staleness flag is not enough: a heartbeat measured in hours
 * still reads "fresh" at 8pm ET on a Monday. The calendar is the ground truth.
 */

/** Regular session: 09:30 to 16:00 America/New_York, Monday through Friday. */
const OPEN_MINUTES = 9 * 60 + 30;
const CLOSE_MINUTES = 16 * 60;

const nyParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const WEEKEND = new Set(["Sat", "Sun"]);

/**
 * True when the US equity regular session is open at `tsSeconds`.
 *
 * DST is handled by the IANA zone, so no offset arithmetic here. Market
 * holidays are NOT modelled: on a holiday this returns true and the oracle's
 * own staleness flag is what suppresses the signal. That layering is
 * deliberate, one imperfect check gating another catches both cases. Pure.
 */
export function isUsEquityMarketOpen(tsSeconds: number): boolean {
  const parts = nyParts.formatToParts(new Date(tsSeconds * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  if (WEEKEND.has(weekday)) return false;
  // hourCycle h23 still renders midnight as "24" in some ICU builds
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const mins = hour * 60 + minute;
  return mins >= OPEN_MINUTES && mins < CLOSE_MINUTES;
}
