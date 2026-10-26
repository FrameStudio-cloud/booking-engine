import { describe, expect, it } from "vitest";
import type { AgentPort, OfferedSlot } from "../types";
import { createTools } from "../tools";

const SLOT: OfferedSlot = {
  resourceId: "staff-grace",
  resourceName: "Grace",
  startsAt: new Date("2026-10-27T06:00:00.000Z"), // 09:00 EAT
  endsAt: new Date("2026-10-27T06:45:00.000Z"),
};

function fakePort(overrides: Partial<AgentPort> = {}): AgentPort {
  return {
    tenant: {
      name: "Glow Salon",
      businessType: "salon",
      timezone: "Africa/Nairobi",
      currency: "KES",
      facts: { parking: "Behind the building" },
    },
    services: [
      { id: "svc-trim", name: "Trim", durationMinutes: 45, priceMinor: 80_000 },
    ],
    staff: [{ id: "staff-grace", name: "Grace", capacity: 1 }],
    now: new Date("2026-10-26T06:00:00.000Z"),
    findSlots: async () => ({ ok: true, slots: [SLOT] }),
    createBooking: async () => ({
      ok: true,
      id: "booking-1",
      startsAt: SLOT.startsAt,
    }),
    ...overrides,
  };
}

/** Tool execute functions take (input, options); the options are not used here. */
const call = (fn: unknown, input: unknown) =>
  (fn as (i: unknown, o: unknown) => Promise<unknown>)(input, {
    toolCallId: "test",
    messages: [],
  });

/** ToolSet erases the keys, so name them once for the tests. */
type ExecutableTools = Record<
  "check_availability" | "create_booking" | "get_business_info" | "escalate_to_human",
  { execute: (input: unknown, options: unknown) => Promise<unknown> }
>;

const build = (port: AgentPort) => {
  const { tools, state } = createTools(port);
  return { tools: tools as unknown as ExecutableTools, state };
};

describe("createTools", () => {
  it("returns local wall-clock time, not UTC", async () => {
    const { tools } = build(fakePort());
    const result = (await call(tools.check_availability.execute, {
      service: "Trim",
      date: "2026-10-27",
    })) as { slots: Array<{ localTime: string; startsAt: string }> };

    expect(result.slots[0]?.localTime).toBe("09:00");
    expect(result.slots[0]?.startsAt).toBe("2026-10-27T06:00:00.000Z");
  });

  it("refuses a booking for a time the engine never offered", async () => {
    const { tools, state } = build(fakePort());

    // The model invents 14:00 without calling check_availability.
    const result = (await call(tools.create_booking.execute, {
      service: "Trim",
      resourceId: "staff-grace",
      startsAt: "2026-10-27T11:00:00.000Z",
      customerName: "Wanjiku Wairimu",
    })) as { error?: string; booked?: boolean };

    expect(result.booked).toBeUndefined();
    expect(result.error).toMatch(/check_availability/);
    expect(state.bookingId).toBeNull();
  });

  it("books after the slot has been offered", async () => {
    const { tools, state } = build(fakePort());

    await call(tools.check_availability.execute, {
      service: "Trim",
      date: "2026-10-27",
    });

    const result = (await call(tools.create_booking.execute, {
      service: "Trim",
      resourceId: "staff-grace",
      startsAt: "2026-10-27T06:00:00.000Z",
      customerName: "Wanjiku Wairimu",
    })) as { booked?: boolean };

    expect(result.booked).toBe(true);
    expect(state.bookingId).toBe("booking-1");
  });

  it("surfaces a lost race instead of confirming", async () => {
    const { tools, state } = build(
      fakePort({
        createBooking: async () => ({
          ok: false,
          message: "That slot was just taken. Offer another time.",
        }),
      }),
    );

    await call(tools.check_availability.execute, {
      service: "Trim",
      date: "2026-10-27",
    });

    const result = (await call(tools.create_booking.execute, {
      service: "Trim",
      resourceId: "staff-grace",
      startsAt: "2026-10-27T06:00:00.000Z",
      customerName: "Wanjiku Wairimu",
    })) as { error?: string };

    expect(result.error).toMatch(/just taken/i);
    expect(state.bookingId).toBeNull();
  });

  it("recovers cleanly from a rejected date", async () => {
    const { tools } = build(fakePort());
    const result = (await call(tools.check_availability.execute, {
      service: "Trim",
      date: "next saturday",
    })) as { error?: string };

    expect(result.error).toMatch(/YYYY-MM-DD/);
  });

  it("marks the conversation for a human on escalation", async () => {
    const { tools, state } = build(fakePort());
    await call(tools.escalate_to_human.execute, { reason: "Wants a refund" });

    expect(state.escalated).toBe(true);
  });
});
