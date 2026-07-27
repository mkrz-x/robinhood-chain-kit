/**
 * US equity regular-session calendar and feed-freshness primitives.
 *
 * Robinhood Stock Token feeds currently publish on a documented 24/5
 * schedule. The NYSE/Nasdaq regular session is therefore useful market
 * context, but it is not a proxy for whether a feed should be fresh. Use
 * `getUsEquityMarketSession` for session context and `isFeedFresh` for the
 * independent heartbeat check.
 */

const OPEN_MINUTES = 9 * 60 + 30;
const REGULAR_CLOSE_MINUTES = 16 * 60;
const EARLY_CLOSE_MINUTES = 13 * 60;
const MAX_REASONABLE_EPOCH_SECONDS = 100_000_000_000;

const nyParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export type UsEquityMarketReason =
  | "regular-session"
  | "before-open"
  | "after-close"
  | "weekend"
  | "holiday"
  | "invalid";

export interface UsEquityMarketSession {
  phase: "regular" | "closed";
  reason: UsEquityMarketReason;
  /** America/New_York calendar date, YYYY-MM-DD. */
  localDate?: string;
  /** Present for named exchange holidays. */
  holiday?: string;
  /** True when the scheduled regular-session close is 13:00 ET. */
  earlyClose: boolean;
  /** Scheduled close as minutes after midnight in America/New_York. */
  closeMinutes?: number;
}

interface Calendar {
  holidays: ReadonlyMap<string, string>;
  earlyCloses: ReadonlySet<string>;
}

const calendarCache = new Map<number, Calendar>();
const keyFromUtcDate = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;

const utcDate = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

const addUtcDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const nthWeekday = (year: number, month: number, weekday: number, occurrence: number) => {
  const first = utcDate(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utcDate(year, month, 1 + offset + (occurrence - 1) * 7);
};

const lastWeekday = (year: number, month: number, weekday: number) => {
  const last = new Date(Date.UTC(year, month, 0));
  return addUtcDays(last, -((last.getUTCDay() - weekday + 7) % 7));
};

const observedFixedHoliday = (year: number, month: number, day: number) => {
  const date = utcDate(year, month, day);
  if (date.getUTCDay() === 6) return addUtcDays(date, -1);
  if (date.getUTCDay() === 0) return addUtcDays(date, 1);
  return date;
};

// Unlike other fixed-date NYSE holidays, New Year's Day is not observed on
// the preceding Friday when January 1 falls on Saturday.
const observedNewYearsDay = (year: number) => {
  const date = utcDate(year, 1, 1);
  if (date.getUTCDay() === 6) return undefined;
  return date.getUTCDay() === 0 ? addUtcDays(date, 1) : date;
};

/** Gregorian Easter Sunday using the Meeus/Jones/Butcher algorithm. */
const easterSunday = (year: number) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
};

const calendarFor = (year: number): Calendar => {
  const cached = calendarCache.get(year);
  if (cached) return cached;

  const holidays = new Map<string, string>();
  const addHoliday = (date: Date, name: string) => {
    if (date.getUTCFullYear() === year) holidays.set(keyFromUtcDate(date), name);
  };

  const newYearsDay = observedNewYearsDay(year);
  if (newYearsDay) addHoliday(newYearsDay, "New Year's Day");
  const nextNewYearsDay = observedNewYearsDay(year + 1);
  if (nextNewYearsDay) addHoliday(nextNewYearsDay, "New Year's Day");
  addHoliday(nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day");
  addHoliday(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
  addHoliday(addUtcDays(easterSunday(year), -2), "Good Friday");
  addHoliday(lastWeekday(year, 5, 1), "Memorial Day");
  if (year >= 2022) addHoliday(observedFixedHoliday(year, 6, 19), "Juneteenth");
  const independenceDay = utcDate(year, 7, 4);
  const independenceObserved = observedFixedHoliday(year, 7, 4);
  addHoliday(independenceObserved, "Independence Day");
  addHoliday(nthWeekday(year, 9, 1, 1), "Labor Day");
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  addHoliday(thanksgiving, "Thanksgiving Day");
  addHoliday(observedFixedHoliday(year, 12, 25), "Christmas Day");

  const earlyCloses = new Set<string>();
  // NYSE schedules the session immediately before July 4 as an early close
  // only when July 4 falls Tuesday-Friday. It does not walk backwards across
  // a weekend or an observed holiday (for example, 2026-07-02 stays regular).
  if (independenceDay.getUTCDay() >= 2 && independenceDay.getUTCDay() <= 5) {
    earlyCloses.add(keyFromUtcDate(addUtcDays(independenceDay, -1)));
  }
  earlyCloses.add(keyFromUtcDate(addUtcDays(thanksgiving, 1)));
  const christmasEve = utcDate(year, 12, 24);
  if (
    christmasEve.getUTCDay() !== 0 &&
    christmasEve.getUTCDay() !== 6 &&
    !holidays.has(keyFromUtcDate(christmasEve))
  ) {
    earlyCloses.add(keyFromUtcDate(christmasEve));
  }

  const calendar = { holidays, earlyCloses };
  calendarCache.set(year, calendar);
  return calendar;
};

const invalidSession = (): UsEquityMarketSession => ({
  phase: "closed",
  reason: "invalid",
  earlyClose: false,
});

/**
 * Return the scheduled US equity regular-session state at an epoch-seconds
 * timestamp. Scheduled holidays and standard 13:00 ET early closes are
 * modelled; emergency/unscheduled closures cannot be predicted.
 */
export function getUsEquityMarketSession(tsSeconds: number): UsEquityMarketSession {
  if (
    !Number.isFinite(tsSeconds) ||
    tsSeconds < 0 ||
    tsSeconds > MAX_REASONABLE_EPOCH_SECONDS
  ) {
    return invalidSession();
  }

  const date = new Date(tsSeconds * 1000);
  if (!Number.isFinite(date.getTime())) return invalidSession();

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = nyParts.formatToParts(date);
  } catch {
    return invalidSession();
  }
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  if (![year, month, day, hour, minute].every(Number.isFinite)) return invalidSession();

  const localDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
    day,
  ).padStart(2, "0")}`;
  const weekday = utcDate(year, month, day).getUTCDay();
  if (weekday === 0 || weekday === 6) {
    return { phase: "closed", reason: "weekend", localDate, earlyClose: false };
  }

  const calendar = calendarFor(year);
  const holiday = calendar.holidays.get(localDate);
  if (holiday) {
    return { phase: "closed", reason: "holiday", localDate, holiday, earlyClose: false };
  }

  const earlyClose = calendar.earlyCloses.has(localDate);
  const closeMinutes = earlyClose ? EARLY_CLOSE_MINUTES : REGULAR_CLOSE_MINUTES;
  const minutes = hour * 60 + minute;
  if (minutes < OPEN_MINUTES) {
    return { phase: "closed", reason: "before-open", localDate, earlyClose, closeMinutes };
  }
  if (minutes >= closeMinutes) {
    return { phase: "closed", reason: "after-close", localDate, earlyClose, closeMinutes };
  }
  return {
    phase: "regular",
    reason: "regular-session",
    localDate,
    earlyClose,
    closeMinutes,
  };
}

/** True only during the scheduled 09:30 ET regular session. */
export function isUsEquityMarketOpen(tsSeconds: number): boolean {
  return getUsEquityMarketSession(tsSeconds).phase === "regular";
}

export type FeedFreshnessReason = "fresh" | "stale" | "future" | "invalid";

export interface FeedFreshness {
  fresh: boolean;
  reason: FeedFreshnessReason;
  ageSeconds?: number;
}

/**
 * Assess an oracle timestamp against its own heartbeat. This deliberately
 * does not consult regular market hours: Robinhood Stock Token feeds publish
 * on a separate 24/5 schedule and corporate-action pauses must be checked
 * independently by the caller.
 */
export function isFeedFresh(
  updatedAtSeconds: number,
  heartbeatSeconds: number,
  nowSeconds = Date.now() / 1000,
  graceSeconds = 0,
): FeedFreshness {
  if (
    !Number.isFinite(updatedAtSeconds) ||
    updatedAtSeconds <= 0 ||
    !Number.isFinite(heartbeatSeconds) ||
    heartbeatSeconds <= 0 ||
    !Number.isFinite(nowSeconds) ||
    nowSeconds < 0 ||
    !Number.isFinite(graceSeconds) ||
    graceSeconds < 0
  ) {
    return { fresh: false, reason: "invalid" };
  }
  const ageSeconds = nowSeconds - updatedAtSeconds;
  if (ageSeconds < 0) return { fresh: false, reason: "future", ageSeconds };
  return ageSeconds <= heartbeatSeconds + graceSeconds
    ? { fresh: true, reason: "fresh", ageSeconds }
    : { fresh: false, reason: "stale", ageSeconds };
}
