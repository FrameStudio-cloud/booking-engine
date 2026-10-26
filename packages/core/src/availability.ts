import type {
  AvailabilityException,
  AvailabilityRule,
  LocalDate,
} from "@booking/shared";
import { dateRange, toMinutes, weekdayOf, zonedTimeToUtc, fromMinutes } from "./time";
import type { BusyInterval, SlotQuery, WorkingWindow } from "./types";
import type { Slot } from "@booking/shared";

const CANCELLED = new Set(["cancelled"]);

/**
 * Who is open when, for one resource on one local date.
 *
 * Precedence (most specific wins):
 *   1. exception for this resource
 *   2. exception for the whole business (closes everyone)
 *   3. weekly hours for this resource
 *   4. weekly hours for the business
 *   5. closed
 */
export function resolveWindows(
  date: LocalDate,
  resourceId: string | null,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
): WorkingWindow[] {
  const weekday = weekdayOf(date);

  const resourceException = exceptions.find(
    (e) => e.date === date && e.resourceId === resourceId,
  );
  if (resourceException) return toWindows([resourceException]);

  const tenantException = exceptions.find(
    (e) => e.date === date && e.resourceId === null,
  );
  if (tenantException) return toWindows([tenantException]);

  const resourceRules = rules.filter(
    (r) => r.weekday === weekday && r.resourceId === resourceId,
  );
  if (resourceRules.length > 0) return toWindows(resourceRules);

  const tenantRules = rules.filter((r) => r.weekday === weekday && r.resourceId === null);
  return toWindows(tenantRules);
}

function toWindows(
  rows: Array<{ opensAt: string | null; closesAt: string | null }>,
): WorkingWindow[] {
  return rows
    .filter((r): r is { opensAt: string; closesAt: string } =>
      Boolean(r.opensAt && r.closesAt),
    )
    .map((r) => ({ opensAt: r.opensAt as WorkingWindow["opensAt"], closesAt: r.closesAt as WorkingWindow["closesAt"] }))
    // Defensive: a backwards window would spin forever.
    .filter((w) => toMinutes(w.closesAt) > toMinutes(w.opensAt));
}

/** Which existing intervals block this resource, honouring capacity. */
export function findConflicts(params: {
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  bufferBeforeMinutes?: number;
  busy: BusyInterval[];
}): BusyInterval[] {
  const { resourceId, startsAt, endsAt, capacity, busy } = params;
  const buffer = (params.bufferBeforeMinutes ?? 0) * 60_000;
  const effectiveStart = startsAt.getTime() - buffer;

  const overlapping = busy.filter(
    (b) =>
      b.resourceId === resourceId &&
      !CANCELLED.has(b.status ?? "") &&
      effectiveStart < b.endsAt.getTime() &&
      endsAt.getTime() > b.startsAt.getTime(),
  );

  // Capacity 1 => any overlap blocks. Capacity 3 => the 4th booking blocks.
  return overlapping.length >= Math.max(1, capacity) ? overlapping : [];
}

export function isSlotFree(
  params: Parameters<typeof findConflicts>[0],
): boolean {
  return findConflicts(params).length === 0;
}

/**
 * The shared slot generator. Salon and restaurant use this directly;
 * the business-specific strategies only decide the parameters.
 */
export function findTimeSlots(query: SlotQuery): Slot[] {
  const {
    timezone,
    durationMinutes,
    capacity,
    bufferBeforeMinutes,
    resources,
    rules,
    exceptions,
    busy,
    from,
    dateFrom,
    dateTo,
    slotStepMinutes,
  } = query;

  const step = Math.max(5, slotStepMinutes);
  const earliest = from.getTime() + (query.minLeadMinutes ?? 0) * 60_000;
  const max = query.maxResults ?? 200;
  const slots: Slot[] = [];

  const dates = dateRange(dateFrom, dateTo);

  for (const date of dates) {
    for (const resource of resources) {
      const effectiveCapacity = Math.min(resource.capacity, Math.max(1, capacity));

      for (const window of resolveWindows(date, resource.id, rules, exceptions)) {
        const open = toMinutes(window.opensAt);
        const close = toMinutes(window.closesAt);

        for (let m = open; m + durationMinutes <= close; m += step) {
          const startsAt = zonedTimeToUtc(date, fromMinutes(m), timezone);
          if (startsAt.getTime() < earliest) continue;

          const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

          const blocked = findConflicts({
            resourceId: resource.id,
            startsAt,
            endsAt,
            capacity: effectiveCapacity,
            bufferBeforeMinutes,
            busy,
          });
          if (blocked.length > 0) continue;

          slots.push({
            resourceId: resource.id,
            resourceName: resource.name,
            startsAt,
            endsAt,
            units: 1,
          });

          if (slots.length >= max) return sortSlots(slots);
        }
      }
    }
  }

  return sortSlots(slots);
}

export function sortSlots(slots: Slot[]): Slot[] {
  return [...slots].sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.resourceName.localeCompare(b.resourceName),
  );
}
