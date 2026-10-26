import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { localDateSchema } from "@booking/shared";
import type { AgentPort } from "./types";

export interface ToolState {
  /** ISO starts actually returned by the engine this conversation. */
  offered: Set<string>;
  escalated: boolean;
  bookingId: string | null;
  calls: string[];
}

/**
 * The tools are the only door between the model and the business.
 *
 * `offered` is the anti-hallucination guard: the model may only book a start
 * time that check_availability handed it earlier in this conversation. A model
 * that invents "10:30" gets a refusal, not a confirmed booking.
 */
export function createTools(port: AgentPort): { tools: ToolSet; state: ToolState } {
  const state: ToolState = {
    offered: new Set(),
    escalated: false,
    bookingId: null,
    calls: [],
  };

  // The customer lives on the business's clock, not on UTC.
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: port.tenant.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: port.tenant.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const tools = {
    check_availability: tool({
      description:
        "Look up real open appointments for one service on one date. Call this before naming any time.",
      inputSchema: z.object({
        service: z.string().describe("Exact service name from the services list"),
        date: z.string().describe("Date as YYYY-MM-DD in the business timezone"),
        partySize: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Number of guests. Restaurants only."),
      }),
      execute: async ({ service, date, partySize }) => {
        state.calls.push(`check_availability(${service}, ${date})`);

        const parsed = localDateSchema.safeParse(date);
        if (!parsed.success) {
          return { error: "date must be YYYY-MM-DD, e.g. 2026-10-31" };
        }

        const result = await port.findSlots({ service, date: parsed.data, partySize });
        if (!result.ok) return { error: result.message };

        for (const slot of result.slots) {
          state.offered.add(slot.startsAt.toISOString());
        }

        return {
          date: parsed.data,
          day: day.format(result.slots[0]?.startsAt ?? port.now),
          open: result.slots.length,
          slots: result.slots.slice(0, 10).map((s) => ({
            localTime: clock.format(s.startsAt),
            startsAt: s.startsAt.toISOString(),
            endsAt: s.endsAt.toISOString(),
            with: s.resourceName,
            resourceId: s.resourceId,
          })),
          note:
            result.slots.length === 0
              ? "Nothing open that day. Offer the customer another date."
              : undefined,
        };
      },
    }),

    create_booking: tool({
      description:
        "Hold a slot for the customer. Only call after check_availability and only once you have their full name.",
      inputSchema: z.object({
        service: z.string().describe("Exact service name"),
        resourceId: z.string().describe("The id of the staff member or unit, from check_availability"),
        startsAt: z.string().describe("Exact ISO timestamp from check_availability"),
        customerName: z.string().min(2).describe("Customer's full name"),
        customerPhone: z.string().optional().describe("Phone number if the customer gave one"),
      }),
      execute: async ({ service, resourceId, startsAt, customerName, customerPhone }) => {
        state.calls.push(`create_booking(${service}, ${startsAt})`);

        const when = new Date(startsAt);
        if (Number.isNaN(when.getTime())) {
          return { error: "startsAt must be an ISO timestamp returned by check_availability" };
        }

        // The guard. No invented slots, ever.
        if (!state.offered.has(when.toISOString())) {
          return {
            error:
              "That time was not offered by check_availability in this conversation. Call check_availability and use a time it returned.",
          };
        }

        const attempt = await port.createBooking({
          service,
          resourceId,
          startsAt: when,
          customerName,
          customerPhone: customerPhone ?? null,
        });

        if (!attempt.ok) {
          // Someone took it between the lookup and the confirm.
          state.offered.delete(when.toISOString());
          return { error: attempt.message };
        }

        state.bookingId = attempt.id;
        return {
          booked: true,
          bookingId: attempt.id,
          localTime: clock.format(attempt.startsAt),
          day: day.format(attempt.startsAt),
          startsAt: attempt.startsAt.toISOString(),
          with: customerName,
        };
      },
    }),

    get_business_info: tool({
      description:
        "Read recorded facts about the business: address, parking, payment, policies. Use before guessing an answer.",
      inputSchema: z.object({
        topic: z.string().optional().describe("Optional topic, e.g. 'parking'"),
      }),
      execute: async ({ topic }) => {
        state.calls.push(`get_business_info(${topic ?? "all"})`);

        const facts = port.tenant.facts;
        if (topic) {
          const key = Object.keys(facts).find((k) =>
            k.toLowerCase().includes(topic.toLowerCase()),
          );
          if (key) return { topic, answer: facts[key] };
        }

        return {
          business: port.tenant.name,
          currency: port.tenant.currency,
          services: port.services.map((s) => ({
            name: s.name,
            minutes: s.durationMinutes,
            priceMinor: s.priceMinor,
          })),
          staff: port.staff.map((s) => s.name),
          facts,
        };
      },
    }),

    escalate_to_human: tool({
      description:
        "Hand the conversation to a staff member. Use for complaints, refunds, custom pricing, or if the customer asks for a person.",
      inputSchema: z.object({
        reason: z.string().describe("One short sentence on why this needs a human"),
      }),
      execute: async ({ reason }) => {
        state.calls.push(`escalate_to_human(${reason})`);
        state.escalated = true;
        return {
          escalated: true,
          reason,
          note: "Tell the customer a team member will reply shortly, and stop guessing.",
        };
      },
    }),
  };

  return { tools, state };
}
