import {
  createBooking as persistBooking,
  loadBusyIntervals,
  loadTenantContext,
  resolveService,
  toSharedService,
  type Database,
} from "@booking/db";
import {
  getStrategy,
  toLocalDate,
  validateBooking,
  zonedTimeToUtc,
} from "@booking/core";
import type { AgentPort, BookingAttempt, SlotsResult } from "@booking/agent";
import type { LocalDate } from "@booking/shared";

/**
 * Binds the agent's abstract port to Postgres + the slot engine.
 * Everything the model can touch passes through here.
 */
export async function buildAgentPort(
  db: Database,
  slug: string,
  now: Date,
  conversationId?: string | null,
): Promise<AgentPort | null> {
  const today = toLocalDate(now, "UTC");
  const seed = await loadTenantContext(db, slug, today, today);
  if (!seed) return null;

  const timezone = seed.tenant.timezone;

  return {
    tenant: {
      name: seed.tenant.name,
      businessType: seed.tenant.businessType,
      timezone,
      currency: seed.tenant.currency,
      facts: seed.tenant.facts,
    },
    services: seed.services
      .filter((s) => s.active)
      .map((s) => ({
        id: s.id,
        name: s.name,
        durationMinutes: s.durationMinutes,
        priceMinor: s.priceMinor,
      })),
    staff: seed.resources
      .filter((r) => r.active)
      .map((r) => ({ id: r.id, name: r.name, capacity: r.capacity })),
    now,

    async findSlots({ service, date, partySize }): Promise<SlotsResult> {
      const scoped = await loadTenantContext(db, slug, date, date);
      if (!scoped) return { ok: false, message: "Unknown business." };

      const serviceRow = resolveService(scoped.services, service);
      if (!serviceRow) {
        const names = scoped.services.filter((s) => s.active).map((s) => s.name).join(", ");
        return { ok: false, message: `"${service}" is not a service here. Available: ${names}` };
      }

      const shared = toSharedService(serviceRow);
      const dayStart = zonedTimeToUtc(date as LocalDate, "00:00", timezone);
      const busy = await loadBusyIntervals(
        db,
        scoped.tenant.id,
        padDays(dayStart, -1),
        padDays(dayStart, 2),
      );

      const slots = getStrategy(scoped.tenant.businessType).findSlots({
        timezone,
        durationMinutes: shared.durationMinutes,
        capacity: shared.capacity,
        bufferBeforeMinutes: shared.bufferBeforeMinutes,
        resources: scoped.resources
          .filter((r) => r.active)
          .map((r) => ({ id: r.id, name: r.name, capacity: r.capacity })),
        rules: scoped.rules,
        exceptions: scoped.exceptions,
        busy,
        from: now,
        dateFrom: date as LocalDate,
        dateTo: date as LocalDate,
        slotStepMinutes: 30,
        minLeadMinutes: 30,
        maxResults: 40,
        partySize,
      });

      return {
        ok: true,
        slots: slots.map((s) => ({
          resourceId: s.resourceId,
          resourceName: s.resourceName,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
        })),
      };
    },

    async createBooking(input): Promise<BookingAttempt> {
      const date = toLocalDate(input.startsAt, timezone);
      const scoped = await loadTenantContext(db, slug, date, date);
      if (!scoped) return { ok: false, message: "Unknown business." };

      const serviceRow = resolveService(scoped.services, input.service);
      if (!serviceRow) return { ok: false, message: "Unknown service." };

      const resource = scoped.resources.find((r) => r.id === input.resourceId);
      if (!resource) return { ok: false, message: "Unknown staff member or unit." };

      const endsAt = new Date(input.startsAt.getTime() + serviceRow.durationMinutes * 60_000);
      const busy = await loadBusyIntervals(
        db,
        scoped.tenant.id,
        padDays(input.startsAt, -2),
        padDays(endsAt, 2),
      );

      const check = validateBooking({
        request: { resourceId: resource.id, startsAt: input.startsAt, endsAt },
        resource: { id: resource.id, name: resource.name, capacity: resource.capacity },
        timezone,
        now,
        capacity: serviceRow.capacity,
        bufferBeforeMinutes: serviceRow.bufferBeforeMinutes,
        busy,
        rules: scoped.rules,
        exceptions: scoped.exceptions,
      });

      if (!check.ok) {
        return {
          ok: false,
          message:
            check.reason === "conflict"
              ? "That slot was just taken. Offer the customer another time."
              : check.message,
        };
      }

      const outcome = await persistBooking(db, {
        tenantId: scoped.tenant.id,
        serviceId: serviceRow.id,
        resourceId: resource.id,
        startsAt: input.startsAt,
        endsAt,
        customerName: input.customerName,
        customerPhone: input.customerPhone ?? null,
        source: "agent",
        conversationId: conversationId ?? null,
      });

      if (!outcome.ok) {
        if (outcome.reason === "already_booked") {
          const local = new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(outcome.startsAt);

          return {
            ok: false,
            message: `This customer already has a booking at ${local} from this chat. Do not create another one — confirm the existing booking and answer their question.`,
          };
        }

        return { ok: false, message: "That slot was just taken. Offer another time." };
      }

      return { ok: true, id: outcome.booking.id, startsAt: outcome.booking.startsAt };
    },
  };
}

function padDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
