import type { LocalDate, Slot } from "@booking/shared";
import { findConflicts } from "../availability";
import { addDays, daysBetween, toMinutes, weekdayOf, zonedTimeToUtc } from "../time";
import type { RangeQuery } from "../types";

const MAX_NIGHTS = 30;

/**
 * BnB: a unit x a date range.
 * A "slot" here is a whole stay, not a time on the clock.
 *
 * Back-to-back stays are legal: check-out at 10:00 and the next check-in
 * at 14:00 on the same day do not overlap.
 */
export function findStays(query: RangeQuery): Slot[] {
  const {
    timezone,
    resources,
    rules,
    exceptions,
    busy,
    from,
    dateFrom,
    dateTo,
    nights,
    checkInTime,
    checkOutTime,
  } = query;

  if (nights < 1 || nights > MAX_NIGHTS) return [];

  const earliest = from.getTime() + (query.minLeadMinutes ?? 0) * 60_000;
  const max = query.maxResults ?? 100;
  const hasWeeklyHours = rules.length > 0;
  const slots: Slot[] = [];

  const checkOutDate = addDays(dateTo, 1);
  const span = Math.max(0, daysBetween(dateFrom, checkOutDate));

  for (let i = 0; i < span; i++) {
    const checkIn: LocalDate = addDays(dateFrom, i);

    for (const resource of resources) {
      if (hasWeeklyHours && !isOpenOn(checkIn, resource.id, rules, exceptions)) continue;

      const startsAt = zonedTimeToUtc(checkIn, checkInTime, timezone);
      const endsAt = zonedTimeToUtc(addDays(checkIn, nights), checkOutTime, timezone);

      if (startsAt.getTime() < earliest) continue;
      if (endsAt.getTime() <= startsAt.getTime()) continue;

      const blocked = findConflicts({
        resourceId: resource.id,
        startsAt,
        endsAt,
        capacity: Math.min(resource.capacity, Math.max(1, query.capacity)),
        bufferBeforeMinutes: 0,
        busy,
      });
      if (blocked.length > 0) continue;

      slots.push({
        resourceId: resource.id,
        resourceName: resource.name,
        startsAt,
        endsAt,
        units: nights,
      });

      if (slots.length >= max) return slots;
    }
  }

  return slots;
}

/** BnB hours are usually unit-level, so only explicit closures/opening matter. */
function isOpenOn(
  date: LocalDate,
  resourceId: string,
  rules: RangeQuery["rules"],
  exceptions: RangeQuery["exceptions"],
): boolean {
  const exception =
    exceptions.find((e) => e.date === date && e.resourceId === resourceId) ??
    exceptions.find((e) => e.date === date && e.resourceId === null);
  if (exception) return Boolean(exception.opensAt && exception.closesAt);

  const weekday = weekdayOf(date);
  const matching = rules.filter(
    (r) => r.weekday === weekday && (r.resourceId === resourceId || r.resourceId === null),
  );
  return matching.some((r) => toMinutes(r.closesAt) > toMinutes(r.opensAt));
}
