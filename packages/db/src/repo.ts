import { and, asc, eq, gt, lt, ne, sql } from "drizzle-orm";
import type {
  AvailabilityException,
  AvailabilityRule,
  BookingStatus,
  Service,
} from "@booking/shared";
import type { BusyInterval } from "@booking/core";
import type { Database } from "./client";
import { readTenantCache, writeTenantCache } from "./tenant-cache";
import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  resources,
  services,
  tenants,
  type BookingRow,
  type ResourceRow,
  type ServiceRow,
  type TenantRow,
} from "./schema";

export interface TenantContext {
  tenant: TenantRow;
  services: ServiceRow[];
  resources: ResourceRow[];
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
}

export async function getTenantBySlug(
  db: Database,
  slug: string,
): Promise<TenantRow | null> {
  const cached = readTenantCache(db, slug);
  if (cached !== undefined) return cached;

  const row = await db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
  const tenant = row ?? null;

  writeTenantCache(db, slug, tenant);
  return tenant;
}

/** Every live business, for the scheduled digest. */
export async function listActiveTenants(db: Database): Promise<TenantRow[]> {
  return db.select().from(tenants).where(eq(tenants.active, true));
}

/** One round trip for everything the slot engine needs about a business. */
export async function loadTenantContext(
  db: Database,
  slug: string,
  dateFrom: string,
  dateTo: string,
): Promise<TenantContext | null> {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
  if (!tenant) return null;

  const [serviceRows, resourceRows, ruleRows, exceptionRows] = await Promise.all([
    db.select().from(services).where(eq(services.tenantId, tenant.id)).orderBy(asc(services.name)),
    db.select().from(resources).where(eq(resources.tenantId, tenant.id)).orderBy(asc(resources.name)),
    db
      .select()
      .from(availabilityRules)
      .where(eq(availabilityRules.tenantId, tenant.id)),
    db
      .select()
      .from(availabilityExceptions)
      .where(
        and(
          eq(availabilityExceptions.tenantId, tenant.id),
          sql`${availabilityExceptions.date} between ${dateFrom} and ${dateTo}`,
        ),
      ),
  ]);

  return {
    tenant,
    services: serviceRows,
    resources: resourceRows,
    rules: ruleRows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      resourceId: r.resourceId,
      weekday: r.weekday,
      opensAt: r.opensAt,
      closesAt: r.closesAt,
    })),
    exceptions: exceptionRows.map((e) => ({
      id: e.id,
      tenantId: e.tenantId,
      resourceId: e.resourceId,
      date: e.date,
      opensAt: e.opensAt,
      closesAt: e.closesAt,
      note: e.note,
    })),
  };
}

/** Public price list: active services only, nothing personal. */
export async function listPublicServices(
  db: Database,
  tenantId: string,
): Promise<ServiceRow[]> {
  return db
    .select()
    .from(services)
    .where(and(eq(services.tenantId, tenantId), eq(services.active, true)))
    .orderBy(asc(services.name));
}

/** Existing bookings that could collide with anything in this window. */
export async function loadBusyIntervals(
  db: Database,
  tenantId: string,
  from: Date,
  to: Date,
): Promise<BusyInterval[]> {
  const rows = await db
    .select({
      resourceId: bookings.resourceId,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      status: bookings.status,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        ne(bookings.status, "cancelled"),
        lt(bookings.startsAt, to),
        gt(bookings.endsAt, from),
      ),
    );

  return rows;
}

/** Accepts a uuid, or a human key like "trim" (matched against the name). */
export function resolveService(rows: ServiceRow[], key: string): ServiceRow | undefined {
  const direct = rows.find((s) => s.id === key);
  if (direct) return direct;
  const slug = normalize(key);
  return rows.find((s) => normalize(s.name) === slug);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function toSharedService(row: ServiceRow): Service {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    durationMinutes: row.durationMinutes,
    capacity: row.capacity,
    bufferBeforeMinutes: row.bufferBeforeMinutes,
    priceMinor: row.priceMinor,
    active: row.active,
  };
}

export type CreateBookingInput = {
  tenantId: string;
  serviceId: string;
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  customerPhone?: string | null;
  source?: string;
  notes?: string | null;
  /** When set, the booking belongs to a chat thread and is unique per thread. */
  conversationId?: string | null;
};

export type CreateBookingOutcome =
  | { ok: true; booking: BookingRow }
  | { ok: false; reason: "resource_busy"; capacity: number }
  | { ok: false; reason: "already_booked"; bookingId: string; startsAt: Date; serviceId: string; resourceId: string }
  | { ok: false; reason: "no_such_resource" | "no_such_service" | "resource_inactive" | "service_inactive" };

/**
 * The only sanctioned way to write a booking.
 *
 * Race safety: two customers can pass `validateBooking` at the same instant
 * and both try to insert. `SELECT ... FOR UPDATE` on the resource row
 * serialises the writers for that resource, so the second one re-counts
 * conflicts against the first one's committed row and loses honestly.
 */
export async function createBooking(
  db: Database,
  input: CreateBookingInput,
): Promise<CreateBookingOutcome> {
  return db.transaction(async (tx) => {
    const [resource] = await tx
      .select()
      .from(resources)
      .where(eq(resources.id, input.resourceId))
      .for("update");

    if (!resource) return { ok: false, reason: "no_such_resource" } as const;
    if (!resource.active) return { ok: false, reason: "resource_inactive" } as const;

    const [service] = await tx
      .select()
      .from(services)
      .where(eq(services.id, input.serviceId));

    if (!service) return { ok: false, reason: "no_such_service" } as const;
    if (!service.active) return { ok: false, reason: "service_inactive" } as const;

    // One live booking per chat: a model that replays a booking call on a
    // "thanks, bye" message must not double-book the customer.
    if (input.conversationId) {
      const [existing] = await tx
        .select({
          id: bookings.id,
          startsAt: bookings.startsAt,
          serviceId: bookings.serviceId,
          resourceId: bookings.resourceId,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.conversationId, input.conversationId),
            ne(bookings.status, "cancelled"),
          ),
        )
        .limit(1);

      if (existing) {
        return {
          ok: false,
          reason: "already_booked",
          bookingId: existing.id,
          startsAt: existing.startsAt,
          serviceId: existing.serviceId,
          resourceId: existing.resourceId,
        } as const;
      }
    }

    const capacity = Math.min(resource.capacity, Math.max(1, service.capacity));
    const effectiveStart = new Date(
      input.startsAt.getTime() - service.bufferBeforeMinutes * 60_000,
    );

    const overlapping = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.resourceId, input.resourceId),
          ne(bookings.status, "cancelled"),
          lt(bookings.startsAt, input.endsAt),
          gt(bookings.endsAt, effectiveStart),
        ),
      );

    if (overlapping.length >= capacity) {
      return { ok: false, reason: "resource_busy", capacity } as const;
    }

    const [created] = await tx
      .insert(bookings)
      .values({
        tenantId: input.tenantId,
        serviceId: input.serviceId,
        resourceId: input.resourceId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        serviceNameAtBooking: service.name,
        durationMinutesAtBooking: service.durationMinutes,
        priceMinorAtBooking: service.priceMinor,
        status: "confirmed",
        customerName: input.customerName,
        customerPhone: input.customerPhone ?? null,
        source: input.source ?? "dashboard",
        conversationId: input.conversationId ?? null,
        notes: input.notes ?? null,
      })
      .returning();

    return { ok: true, booking: created! } as const;
  });
}

export async function getBookingById(
  db: Database,
  tenantId: string,
  bookingId: string,
): Promise<BookingRow | null> {
  const [row] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)));

  return row ?? null;
}

export type BookingChangeOutcome =
  | { ok: true; booking: BookingRow; alreadyCancelled?: boolean }
  | { ok: false; reason: "not_found" | "cancelled" | "resource_busy" };

/**
 * Cancel is a status change, never a delete: the row carries the price and
 * duration that were agreed, and the calendar's conflict query ignores it.
 * Idempotent — a second cancel returns the row untouched.
 */
export async function cancelBooking(
  db: Database,
  input: { tenantId: string; bookingId: string; by: string; reason?: string | null },
): Promise<BookingChangeOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.tenantId, input.tenantId)))
      .for("update");

    if (!row) return { ok: false, reason: "not_found" } as const;
    if (row.status === "cancelled") {
      return { ok: true, booking: row, alreadyCancelled: true } as const;
    }

    const [updated] = await tx
      .update(bookings)
      .set({
        status: "cancelled",
        statusChangedAt: new Date(),
        statusChangedBy: input.by,
        statusReason: input.reason ?? null,
      })
      .where(eq(bookings.id, row.id))
      .returning();

    return { ok: true, booking: updated!, alreadyCancelled: false } as const;
  });
}

/**
 * Move one booking, under the same row lock as a create.
 *
 * The pre-check in core decided hours and buffer; this re-counts conflicts
 * against committed rows so a slot taken in between still loses honestly. The
 * booking is excluded from its own overlap count.
 */
export async function rescheduleBooking(
  db: Database,
  input: {
    tenantId: string;
    bookingId: string;
    startsAt: Date;
    endsAt: Date;
    by: string;
    reason?: string | null;
  },
): Promise<BookingChangeOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.tenantId, input.tenantId)))
      .for("update");

    if (!row) return { ok: false, reason: "not_found" } as const;
    if (row.status === "cancelled") return { ok: false, reason: "cancelled" } as const;

    const [resource] = await tx
      .select()
      .from(resources)
      .where(eq(resources.id, row.resourceId))
      .for("update");

    if (!resource) return { ok: false, reason: "not_found" } as const;

    const [service] = await tx
      .select()
      .from(services)
      .where(eq(services.id, row.serviceId));

    const capacity = Math.min(
      resource.capacity,
      Math.max(1, service?.capacity ?? 1),
    );

    const overlapping = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.resourceId, row.resourceId),
          ne(bookings.status, "cancelled"),
          ne(bookings.id, row.id),
          lt(bookings.startsAt, input.endsAt),
          gt(bookings.endsAt, input.startsAt),
        ),
      );

    if (overlapping.length >= capacity) {
      return { ok: false, reason: "resource_busy" } as const;
    }

    const [updated] = await tx
      .update(bookings)
      .set({
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        statusChangedAt: new Date(),
        statusChangedBy: input.by,
        statusReason: input.reason ?? null,
      })
      .where(eq(bookings.id, row.id))
      .returning();

    return { ok: true, booking: updated! } as const;
  });
}

/** Cheap liveness check for /health. */
export async function pingDatabase(db: Database): Promise<boolean> {  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export type { BookingStatus };
