import { describe, expect, it } from "vitest";
import type { AvailabilityRule, LocalDate } from "@booking/shared";
import {
  checkCancellation,
  planReschedule,
  weekdayOf,
  zonedTimeToUtc,
  type BusyInterval,
  type RescheduleInput,
} from "../index";

const TZ = "Africa/Nairobi";
const DATE = "2026-10-26" as LocalDate;

function hours(): AvailabilityRule[] {
  return [
    {
      id: "rule-1",
      tenantId: "t1",
      resourceId: null,
      weekday: weekdayOf(DATE),
      opensAt: "09:00",
      closesAt: "17:00",
    },
  ];
}

function at(time: string): Date {
  return zonedTimeToUtc(DATE, time, TZ);
}

function busy(from: string, to: string): BusyInterval {
  return { resourceId: "r1", startsAt: at(from), endsAt: at(to), status: "confirmed" };
}

const booking = {
  resourceId: "r1",
  startsAt: at("09:00"),
  endsAt: at("10:00"),
  status: "confirmed" as const,
};

function input(overrides: Partial<RescheduleInput> = {}): RescheduleInput {
  return {
    booking,
    newStart: at("11:00"),
    request: { resourceId: "r1", startsAt: booking.startsAt, endsAt: booking.endsAt },
    resource: { id: "r1", name: "Grace", capacity: 1 },
    timezone: TZ,
    now: at("00:00"),
    capacity: 1,
    bufferBeforeMinutes: 0,
    busy: [booking].map((b) => ({
      resourceId: b.resourceId,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      status: b.status,
    })),
    rules: hours(),
    exceptions: [],
    ...overrides,
  };
}

describe("checkCancellation", () => {
  it("allows a future booking", () => {
    expect(checkCancellation({ status: "confirmed", startsAt: at("11:00"), now: at("09:00") }))
      .toEqual({ ok: true, alreadyCancelled: false });
  });

  it("is idempotent — cancelling twice is not an error", () => {
    expect(checkCancellation({ status: "cancelled", startsAt: at("11:00"), now: at("09:00") }))
      .toEqual({ ok: true, alreadyCancelled: true });
  });

  it("refuses a booking that has already started", () => {
    const result = checkCancellation({
      status: "confirmed",
      startsAt: at("09:00"),
      now: at("09:01"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("already_started");
  });
});

describe("planReschedule", () => {
  it("moves the booking and keeps its duration", () => {
    const result = planReschedule(input());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.startsAt.toISOString()).toBe(at("11:00").toISOString());
    expect(result.endsAt.toISOString()).toBe(at("12:00").toISOString());
  });

  it("does not collide with the booking's own interval", () => {
    // Asking for the time it already has must be a no-op, not a conflict.
    expect(planReschedule(input({ newStart: at("09:00") })).ok).toBe(true);
  });

  it("refuses a target someone else already holds", () => {
    const result = planReschedule(input({ newStart: at("11:30"), busy: [busy("12:00", "13:00")] }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("conflict");
  });

  it("refuses a target outside opening hours", () => {
    const result = planReschedule(input({ newStart: at("16:30") }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("outside_hours");
  });

  it("refuses a cancelled booking", () => {
    const result = planReschedule(
      input({ booking: { ...booking, status: "cancelled" } }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("cancelled");
  });

  it("refuses a booking that already started", () => {
    const result = planReschedule(input({ now: at("09:30") }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("already_started");
  });
});
