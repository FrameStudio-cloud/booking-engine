import type { AvailabilityException, AvailabilityRule } from "@booking/shared";
import { findConflicts, resolveWindows } from "./availability";
import { getZonedParts, toLocalDate } from "./time";
import type { BookableResource, BusyInterval } from "./types";

export type BookingRejection =
  | "ends_before_starts"
  | "in_past"
  | "outside_hours"
  | "conflict";

export type BookingValidation =
  | { ok: true; startsAt: Date; endsAt: Date }
  | {
      ok: false;
      reason: BookingRejection;
      message: string;
      conflicts?: BusyInterval[];
    };

export interface ValidateBookingInput {
  request: { resourceId: string; startsAt: Date; endsAt: Date };
  resource: BookableResource;
  timezone: string;
  now: Date;
  /** How many bookings the service allows at once. */
  capacity: number;
  bufferBeforeMinutes?: number;
  busy: BusyInterval[];
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
  /** Set false for multi-day stays that ignore opening hours. */
  enforceHours?: boolean;
}

/**
 * The last line of defence before a row is written.
 *
 * The agent may only ever offer slots returned by a strategy, but strategies
 * are advisory — between "here are slots" and "confirm it" a second customer
 * can take the slot. This function is what makes double-booking impossible.
 */
export function validateBooking(input: ValidateBookingInput): BookingValidation {
  const { request, resource, timezone, now, capacity, busy } = input;
  const { startsAt, endsAt } = request;

  if (endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, reason: "ends_before_starts", message: "End must be after start." };
  }

  if (startsAt.getTime() < now.getTime()) {
    return { ok: false, reason: "in_past", message: "That time has already passed." };
  }

  const conflicts = findConflicts({
    resourceId: resource.id,
    startsAt,
    endsAt,
    capacity: Math.min(resource.capacity, Math.max(1, capacity)),
    bufferBeforeMinutes: input.bufferBeforeMinutes ?? 0,
    busy,
  });

  if (conflicts.length > 0) {
    return {
      ok: false,
      reason: "conflict",
      message: "Someone else just took that slot.",
      conflicts,
    };
  }

  if (input.enforceHours !== false) {
    const hoursCheck = checkInsideHours({
      startsAt,
      endsAt,
      resourceId: resource.id,
      timezone,
      rules: input.rules,
      exceptions: input.exceptions,
    });
    if (!hoursCheck.ok) return hoursCheck;
  }

  return { ok: true, startsAt, endsAt };
}

function checkInsideHours(input: {
  startsAt: Date;
  endsAt: Date;
  resourceId: string;
  timezone: string;
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
}): BookingValidation {
  const { startsAt, endsAt, timezone } = input;

  // Cross-midnight bookings (stays) are not evaluated against daily hours.
  if (toLocalDate(startsAt, timezone) !== toLocalDate(endsAt, timezone)) {
    return { ok: true, startsAt, endsAt };
  }

  const date = toLocalDate(startsAt, timezone);
  const windows = resolveWindows(date, input.resourceId, input.rules, input.exceptions);

  // No configured hours at all => the business books any time it likes.
  if (windows.length === 0 && input.rules.length === 0) {
    return { ok: true, startsAt, endsAt };
  }

  const startParts = getZonedParts(startsAt, timezone);
  const endParts = getZonedParts(endsAt, timezone);
  const startMin = startParts.hour * 60 + startParts.minute;
  const endMin = endParts.hour * 60 + endParts.minute;

  const fits = windows.some(
    (w) => startMin >= toMin(w.opensAt) && endMin <= toMin(w.closesAt),
  );

  return fits
    ? { ok: true, startsAt, endsAt }
    : {
        ok: false,
        reason: "outside_hours",
        message: "That time is outside opening hours.",
      };
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}
