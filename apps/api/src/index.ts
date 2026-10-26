import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getStrategy, toLocalDate, validateBooking, type BusyInterval } from "@booking/core";
import { localDateSchema, type LocalDate } from "@booking/shared";
import { demoBusy, demoRules, demoServices, demoStaff, demoTenant } from "./demo";

const PORT = Number(process.env.PORT ?? 8787);
const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN ?? "http://localhost:5173";

const app = new Hono();

app.use("*", cors({ origin: DASHBOARD_ORIGIN }));

/** Bookings created through the API during this process. Replaced by Postgres in phase 1. */
const liveBookings: BusyInterval[] = [];

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    phase: "1 - schema + core",
    time: new Date().toISOString(),
  }),
);

app.get("/api/tenants/:slug", (c) => {
  if (c.req.param("slug") !== demoTenant.slug) return c.json({ error: "unknown tenant" }, 404);
  return c.json({ tenant: demoTenant, services: demoServices, staff: demoStaff });
});

/**
 * GET /api/tenants/:slug/slots?date=2026-10-27&service=svc-braids
 * Everything here comes from @booking/core — the route only shapes input/output.
 */
app.get("/api/tenants/:slug/slots", (c) => {
  if (c.req.param("slug") !== demoTenant.slug) return c.json({ error: "unknown tenant" }, 404);

  const today = toLocalDate(new Date(), demoTenant.timezone);
  const parsedDate = localDateSchema.safeParse(c.req.query("date") ?? today);
  if (!parsedDate.success) {
    return c.json({ error: "date must be YYYY-MM-DD" }, 400);
  }
  const date = parsedDate.data as LocalDate;

  const serviceId = c.req.query("service") ?? demoServices[0]?.id;
  const service = demoServices.find((s) => s.id === serviceId);
  if (!service) return c.json({ error: "unknown service" }, 404);

  const busy = [...demoBusy(date, demoTenant.timezone), ...liveBookings];

  const slots = getStrategy(demoTenant.businessType).findSlots({
    timezone: demoTenant.timezone,
    durationMinutes: service.durationMinutes,
    capacity: service.capacity,
    bufferBeforeMinutes: service.bufferBeforeMinutes,
    resources: demoStaff,
    rules: demoRules,
    exceptions: [],
    busy,
    from: new Date(),
    dateFrom: date,
    dateTo: date,
    slotStepMinutes: 30,
    minLeadMinutes: 30,
    maxResults: 50,
  });

  return c.json({
    date,
    service: { id: service.id, name: service.name, minutes: service.durationMinutes },
    slots: slots.map((s) => ({
      resourceId: s.resourceId,
      resourceName: s.resourceName,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
    })),
  });
});

/** POST /api/tenants/:slug/bookings — the guard that makes double-booking impossible. */
app.post("/api/tenants/:slug/bookings", async (c) => {
  if (c.req.param("slug") !== demoTenant.slug) return c.json({ error: "unknown tenant" }, 404);

  const body = (await c.req.json().catch(() => null)) as {
    serviceId?: string;
    resourceId?: string;
    startsAt?: string;
    customerName?: string;
    customerPhone?: string;
  } | null;

  if (!body?.serviceId || !body.resourceId || !body.startsAt || !body.customerName) {
    return c.json(
      { error: "serviceId, resourceId, startsAt and customerName are required" },
      400,
    );
  }

  const service = demoServices.find((s) => s.id === body.serviceId);
  if (!service) return c.json({ error: "unknown service" }, 404);

  const resource = demoStaff.find((r) => r.id === body.resourceId);
  if (!resource) return c.json({ error: "unknown resource" }, 404);

  const startsAt = new Date(body.startsAt);
  if (Number.isNaN(startsAt.getTime())) return c.json({ error: "invalid startsAt" }, 400);
  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);

  const check = validateBooking({
    request: { resourceId: resource.id, startsAt, endsAt },
    resource,
    timezone: demoTenant.timezone,
    now: new Date(),
    capacity: service.capacity,
    bufferBeforeMinutes: service.bufferBeforeMinutes,
    busy: [...demoBusy(toLocalDate(startsAt, demoTenant.timezone), demoTenant.timezone), ...liveBookings],
    rules: demoRules,
    exceptions: [],
  });

  if (!check.ok) {
    return c.json({ error: check.message, reason: check.reason }, 409);
  }

  const booking = {
    id: `bk-${liveBookings.length + 1}`,
    serviceId: service.id,
    resourceId: resource.id,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    customerName: body.customerName,
    customerPhone: body.customerPhone ?? null,
    status: "confirmed" as const,
  };

  liveBookings.push({
    resourceId: resource.id,
    startsAt,
    endsAt,
    status: "confirmed",
  });

  return c.json({ booking }, 201);
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`booking engine api listening on http://localhost:${info.port}`);
});
