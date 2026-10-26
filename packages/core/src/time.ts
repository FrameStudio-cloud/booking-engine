import type { LocalDate, TimeOfDay } from "@booking/shared";

/**
 * All booking math happens on local wall-clock time in the tenant's timezone,
 * then converts to UTC instants only at the edges.
 *
 * Nairobi is UTC+3 with no DST, but this is written to survive a tenant
 * with DST so we don't get a nasty surprise when someone opens in Cairo.
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  // Some engines emit hour "24" for midnight.
  const hour = get("hour") % 24;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` at `date`, in ms (local = utc + offset). */
export function timezoneOffsetMs(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Compare at second precision so sub-second ms don't leak into the offset.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** "2026-10-26" for an instant, in the tenant's timezone. */
export function toLocalDate(date: Date, timeZone: string): LocalDate {
  const p = getZonedParts(date, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}` as LocalDate;
}

/** Local wall-clock time -> UTC instant. Handles DST gaps by nudging forward. */
export function zonedTimeToUtc(
  date: LocalDate,
  time: TimeOfDay,
  timeZone: string,
): Date {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);

  let offset = timezoneOffsetMs(new Date(guess), timeZone);
  let ts = guess - offset;
  // Re-check once: on a DST boundary the offset at the guess differs.
  const offsetAtTs = timezoneOffsetMs(new Date(ts), timeZone);
  if (offsetAtTs !== offset) {
    offset = offsetAtTs;
    ts = guess - offset;
  }
  return new Date(ts);
}

/** Minutes since local midnight for "HH:MM". */
export function toMinutes(time: TimeOfDay): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** Minutes since local midnight -> "HH:MM". */
export function fromMinutes(minutes: number): TimeOfDay {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${pad(h)}:${pad(m)}` as TimeOfDay;
}

/** Calendar-day arithmetic on local dates, immune to timezone drift. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, mo - 1, d + days));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(
    t.getUTCDate(),
  )}` as LocalDate;
}

/** 0 = Sunday ... 6 = Saturday */
export function weekdayOf(date: LocalDate): number {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/** Whole days between two local dates (b - a). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

/** Every local date from `from` to `to`, inclusive. Guards against huge ranges. */
export function dateRange(from: LocalDate, to: LocalDate, maxDays = 120): LocalDate[] {
  const span = daysBetween(from, to);
  if (span < 0) return [];
  const out: LocalDate[] = [];
  const limit = Math.min(span, maxDays - 1);
  for (let i = 0; i <= limit; i++) out.push(addDays(from, i));
  return out;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}
