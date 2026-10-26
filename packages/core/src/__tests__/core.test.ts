import { describe, expect, it } from "vitest";
import type { AvailabilityRule, LocalDate } from "@booking/shared";
import {
  addDays,
  dateRange,
  findStays,
  findTimeSlots,
  getStrategy,
  toLocalDate,
  validateBooking,
  weekdayOf,
  zonedTimeToUtc,
  type BusyInterval,
  type RangeQuery,
  type SlotQuery,
} from "../index";

const TZ = "Africa/Nairobi";
const DATE = "2026-10-26" as LocalDate;
const WEEKDAY = weekdayOf(DATE);

function weeklyHours(opensAt = "09:00", closesAt = "17:00"): AvailabilityRule[] {
  return [
    { id: "rule-1", tenantId: "t1", resourceId: null, weekday: WEEKDAY, opensAt, closesAt },
  ];
}

function busy(startsAt: string, endsAt: string, resourceId = "r1"): BusyInterval {
  return {
    resourceId,
    startsAt: zonedTimeToUtc(DATE, startsAt, TZ),
    endsAt: zonedTimeToUtc(DATE, endsAt, TZ),
    status: "confirmed",
  };
}

function query(overrides: Partial<SlotQuery> = {}): SlotQuery {
  return {
    timezone: TZ,
    durationMinutes: 60,
    capacity: 1,
    bufferBeforeMinutes: 0,
    resources: [{ id: "r1", name: "Grace", capacity: 1 }],
    rules: weeklyHours(),
    exceptions: [],
    busy: [],
    from: zonedTimeToUtc(DATE, "00:00", TZ),
    dateFrom: DATE,
    dateTo: DATE,
    slotStepMinutes: 30,
    ...overrides,
  };
}

describe("time", () => {
  it("converts Nairobi wall clock to UTC", () => {
    // Nairobi is UTC+3 all year.
    expect(zonedTimeToUtc(DATE, "09:00", TZ).toISOString()).toBe(
      "2026-10-26T06:00:00.000Z",
    );
  });

  it("respects daylight saving in other zones", () => {
    // London in July is BST (UTC+1).
    const summer = zonedTimeToUtc("2026-07-15" as LocalDate, "09:00", "Europe/London");
    expect(summer.toISOString()).toBe("2026-07-15T08:00:00.000Z");
  });

  it("round-trips a local date", () => {
    const instant = zonedTimeToUtc(DATE, "23:30", TZ);
    expect(toLocalDate(instant, TZ)).toBe(DATE);
  });

  it("adds days across month boundaries", () => {
    expect(addDays("2026-10-31" as LocalDate, 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01" as LocalDate, -1)).toBe("2025-12-31");
  });

  it("builds an inclusive date range", () => {
    expect(dateRange(DATE, addDays(DATE, 2))).toEqual([DATE, "2026-10-27", "2026-10-28"]);
  });

  it("rejects an inverted range", () => {
    expect(dateRange(DATE, addDays(DATE, -1))).toEqual([]);
  });
});

describe("findTimeSlots (salon)", () => {
  it("fills a 9-5 day with 60 minute appointments on a 30 minute grid", () => {
    const slots = findTimeSlots(query());
    // 09:00 .. 16:00 inclusive = 15 starts
    expect(slots).toHaveLength(15);
    expect(slots[0]?.startsAt.toISOString()).toBe("2026-10-26T06:00:00.000Z");
    expect(slots.at(-1)?.endsAt.toISOString()).toBe("2026-10-26T14:00:00.000Z");
  });

  it("drops starts that would collide with an existing booking", () => {
    // 10:00-11:00 busy blocks 09:30 (runs into it), 10:00 and 10:30.
    const slots = findTimeSlots(query({ busy: [busy("10:00", "11:00")] }));
    expect(slots).toHaveLength(12);
    const starts = slots.map((s) => s.startsAt.toISOString());
    expect(starts).not.toContain("2026-10-26T06:30:00.000Z");
    expect(starts).not.toContain("2026-10-26T07:00:00.000Z");
    expect(starts).not.toContain("2026-10-26T07:30:00.000Z");
  });

  it("ignores cancelled bookings", () => {
    const cancelled = { ...busy("10:00", "11:00"), status: "cancelled" };
    expect(findTimeSlots(query({ busy: [cancelled] }))).toHaveLength(15);
  });

  it("returns nothing on a closed day", () => {
    const closed = [
      { ...weeklyHours()[0]!, weekday: (WEEKDAY + 1) % 7 },
    ];
    expect(findTimeSlots(query({ rules: closed }))).toHaveLength(0);
  });

  it("lets a holiday exception close the day", () => {
    const slots = findTimeSlots(
      query({
        exceptions: [
          { id: "e1", tenantId: "t1", resourceId: null, date: DATE, opensAt: null, closesAt: null, note: "Closed" },
        ],
      }),
    );
    expect(slots).toHaveLength(0);
  });

  it("honours the turn-over buffer", () => {
    // A previous booking ends at 09:30. Back-to-back is fine with no buffer,
    // but a 30 minute turn-over pushes the next start to 10:00.
    const blockedBy = [busy("09:00", "09:30")];
    const at0930 = "2026-10-26T06:30:00.000Z";
    const noBuffer = findTimeSlots(
      query({ durationMinutes: 30, busy: blockedBy }),
    ).map((s) => s.startsAt.toISOString());
    const withBuffer = findTimeSlots(
      query({ durationMinutes: 30, bufferBeforeMinutes: 30, busy: blockedBy }),
    ).map((s) => s.startsAt.toISOString());

    expect(noBuffer).toContain(at0930);
    expect(withBuffer).not.toContain(at0930);
  });

  it("allows overlapping bookings up to capacity", () => {
    const twoBusy = [busy("10:00", "11:00"), busy("10:00", "11:00")];
    const shared = {
      resources: [{ id: "r1", name: "Grace", capacity: 3 }],
      capacity: 3,
      durationMinutes: 60,
      slotStepMinutes: 60,
    };
    expect(findTimeSlots(query({ ...shared, busy: twoBusy })).length).toBeGreaterThan(0);
    expect(
      findTimeSlots(query({ ...shared, busy: [...twoBusy, busy("10:00", "11:00")] })).map(
        (s) => s.startsAt.toISOString(),
      ),
    ).not.toContain("2026-10-26T07:00:00.000Z");
  });

  it("stops at maxResults", () => {
    expect(findTimeSlots(query({ maxResults: 3 }))).toHaveLength(3);
  });

  it("never offers a slot in the past", () => {
    const noon = zonedTimeToUtc(DATE, "12:00", TZ);
    const slots = findTimeSlots(query({ from: noon }));
    expect(slots[0]?.startsAt.getTime()).toBeGreaterThanOrEqual(noon.getTime());
  });

  it("is reachable through the strategy registry", () => {
    const strategy = getStrategy("salon");
    expect(strategy.findSlots(query()).length).toBe(15);
  });
});

describe("findTimeSlots (restaurant)", () => {
  const tables = [
    { id: "t2", name: "Table 2", capacity: 2 },
    { id: "t4", name: "Table 4", capacity: 4 },
    { id: "t8", name: "Table 8", capacity: 8 },
  ];

  it("only offers tables big enough for the party", () => {
    const slots = getStrategy("restaurant").findSlots(
      query({ resources: tables, partySize: 4, durationMinutes: 90, slotStepMinutes: 30 }),
    );
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.resourceId !== "t2")).toBe(true);
  });

  it("offers nothing when no table fits", () => {
    const slots = getStrategy("restaurant").findSlots(
      query({ resources: tables, partySize: 12 }),
    );
    expect(slots).toHaveLength(0);
  });
});

describe("findStays (bnb)", () => {
  function stayQuery(overrides: Partial<RangeQuery> = {}): RangeQuery {
    return {
      timezone: TZ,
      capacity: 1,
      bufferBeforeMinutes: 0,
      resources: [{ id: "unit-1", name: "Garden Cottage", capacity: 1 }],
      rules: [], // units are open unless explicitly closed
      exceptions: [],
      busy: [],
      from: zonedTimeToUtc(DATE, "00:00", TZ),
      dateFrom: DATE,
      dateTo: addDays(DATE, 14),
      slotStepMinutes: 60,
      nights: 2,
      checkInTime: "14:00",
      checkOutTime: "10:00",
      ...overrides,
    };
  }

  it("offers a two-night stay with correct check-in and check-out", () => {
    const [slot] = findStays(stayQuery());
    expect(slot?.startsAt.toISOString()).toBe("2026-10-26T11:00:00.000Z"); // 14:00 EAT
    expect(slot?.endsAt.toISOString()).toBe("2026-10-28T07:00:00.000Z"); // 10:00 EAT
    expect(slot?.units).toBe(2);
  });

  it("removes a unit while an existing stay blocks it", () => {
    const occupied: BusyInterval = {
      resourceId: "unit-1",
      startsAt: zonedTimeToUtc(addDays(DATE, 1), "14:00", TZ),
      endsAt: zonedTimeToUtc(addDays(DATE, 5), "10:00", TZ),
      status: "confirmed",
    };
    const slots = findStays(stayQuery({ busy: [occupied], nights: 1 }));
    const blocked = slots.some((s) => s.startsAt < occupied.endsAt && s.endsAt > occupied.startsAt);
    expect(blocked).toBe(false);
  });

  it("allows a back-to-back stay the same day the previous guest leaves", () => {
    const previous: BusyInterval = {
      resourceId: "unit-1",
      startsAt: zonedTimeToUtc(addDays(DATE, -2), "14:00", TZ),
      endsAt: zonedTimeToUtc(DATE, "10:00", TZ),
      status: "confirmed",
    };
    const slots = findStays(stayQuery({ busy: [previous], nights: 1 }));
    expect(slots.some((s) => toLocalDate(s.startsAt, TZ) === DATE)).toBe(true);
  });

  it("rejects nonsensical night counts", () => {
    expect(findStays(stayQuery({ nights: 0 }))).toHaveLength(0);
    expect(findStays(stayQuery({ nights: 90 }))).toHaveLength(0);
  });
});

describe("validateBooking", () => {
  const now = zonedTimeToUtc(DATE, "08:00", TZ);
  const base = {
    resource: { id: "r1", name: "Grace", capacity: 1 },
    timezone: TZ,
    now,
    capacity: 1,
    bufferBeforeMinutes: 0,
    busy: [],
    rules: weeklyHours(),
    exceptions: [],
  };

  it("accepts a legal slot inside opening hours", () => {
    const result = validateBooking({
      ...base,
      request: {
        resourceId: "r1",
        startsAt: zonedTimeToUtc(DATE, "10:00", TZ),
        endsAt: zonedTimeToUtc(DATE, "11:00", TZ),
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a slot someone just took", () => {
    const result = validateBooking({
      ...base,
      busy: [busy("10:00", "11:00")],
      request: {
        resourceId: "r1",
        startsAt: zonedTimeToUtc(DATE, "10:00", TZ),
        endsAt: zonedTimeToUtc(DATE, "11:00", TZ),
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("conflict");
  });

  it("rejects a slot in the past", () => {
    const result = validateBooking({
      ...base,
      request: {
        resourceId: "r1",
        startsAt: zonedTimeToUtc(DATE, "07:00", TZ),
        endsAt: zonedTimeToUtc(DATE, "08:00", TZ),
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("in_past");
  });

  it("rejects a slot outside opening hours", () => {
    const result = validateBooking({
      ...base,
      request: {
        resourceId: "r1",
        startsAt: zonedTimeToUtc(DATE, "20:00", TZ),
        endsAt: zonedTimeToUtc(DATE, "21:00", TZ),
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("outside_hours");
  });

  it("rejects a booking that ends before it starts", () => {
    const result = validateBooking({
      ...base,
      request: {
        resourceId: "r1",
        startsAt: zonedTimeToUtc(DATE, "11:00", TZ),
        endsAt: zonedTimeToUtc(DATE, "10:00", TZ),
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ends_before_starts");
  });
});
