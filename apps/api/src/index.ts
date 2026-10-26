import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { runAgent } from "@booking/agent";
import {
  createBooking,
  loadBusyIntervals,
  loadTenantContext,
  pingDatabase,
  resolveService,
  toSharedService,
} from "@booking/db";
import {
  addDays,
  getStrategy,
  toLocalDate,
  validateBooking,
  zonedTimeToUtc,
} from "@booking/core";
import { localDateSchema, type LocalDate } from "@booking/shared";
import { config } from "./env";
import { db } from "./db";
import { buildAgentPort } from "./agent-port";
import { createTelegramBot } from "./telegram";

const app = new Hono();

app.use("*", cors({ origin: config.dashboardOrigin }));

app.get("/api/health", async (c) => {
  const started = Date.now();
  const database = (await pingDatabase(db)) ? "ok" : "unreachable";

  return c.json(
    {
      status: database === "ok" ? "ok" : "degraded",
      phase: "1b - postgres",
      database,
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
    },
    database === "ok" ? 200 : 503,
  );
});

app.get("/api/tenants/:slug", async (c) => {
  const today = toLocalDate(new Date(), "Africa/Nairobi");
  const context = await loadTenantContext(db, c.req.param("slug"), today, today);
  if (!context) return c.json({ error: "unknown tenant" }, 404);

  return c.json({
    tenant: context.tenant,
    services: context.services,
    resources: context.resources,
  });
});

/**
 * GET /api/tenants/:slug/slots?date=2026-10-27&service=trim
 * `service` accepts a uuid or a readable key such as "trim".
 */
app.get("/api/tenants/:slug/slots", async (c) => {
  const slug = c.req.param("slug");

  // Load once to learn the timezone, then again for the requested date.
  const peek = await loadTenantContext(db, slug, "2000-01-01", "2000-01-01");
  if (!peek) return c.json({ error: "unknown tenant" }, 404);

  const timezone = peek.tenant.timezone;
  const today = toLocalDate(new Date(), timezone);
  const parsedDate = localDateSchema.safeParse(c.req.query("date") ?? today);
  if (!parsedDate.success) return c.json({ error: "date must be YYYY-MM-DD" }, 400);
  const date = parsedDate.data as LocalDate;

  const context = await loadTenantContext(db, slug, date, date);
  if (!context) return c.json({ error: "unknown tenant" }, 404);

  const serviceKey = c.req.query("service") ?? context.services[0]?.id;
  const serviceRow = serviceKey ? resolveService(context.services, serviceKey) : undefined;
  if (!serviceRow) return c.json({ error: "unknown service" }, 404);
  const service = toSharedService(serviceRow);

  const dayStart = zonedTimeToUtc(date, "00:00", timezone);
  const busy = await loadBusyIntervals(
    db,
    context.tenant.id,
    padDays(dayStart, -1),
    padDays(zonedTimeToUtc(addDays(date, 1), "00:00", timezone), 1),
  );

  const slots = getStrategy(context.tenant.businessType).findSlots({
    timezone,
    durationMinutes: service.durationMinutes,
    capacity: service.capacity,
    bufferBeforeMinutes: service.bufferBeforeMinutes,
    resources: context.resources
      .filter((r) => r.active)
      .map((r) => ({ id: r.id, name: r.name, capacity: r.capacity })),
    rules: context.rules,
    exceptions: context.exceptions,
    busy,
    from: new Date(),
    dateFrom: date,
    dateTo: date,
    slotStepMinutes: 30,
    minLeadMinutes: 30,
    maxResults: 50,
    partySize: Number(c.req.query("partySize") ?? "1"),
  });

  return c.json({
    date,
    service: { id: service.id, name: service.name, minutes: service.durationMinutes },
    slots: slots.map((s) => ({
      resourceId: s.resourceId,
      resourceName: s.resourceName,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      units: s.units,
    })),
  });
});

/** POST /api/tenants/:slug/bookings */
app.post("/api/tenants/:slug/bookings", async (c) => {
  const slug = c.req.param("slug");

  const body = (await c.req.json().catch(() => null)) as {
    serviceId?: string;
    resourceId?: string;
    startsAt?: string;
    customerName?: string;
    customerPhone?: string;
    source?: string;
  } | null;

  if (!body?.serviceId || !body.resourceId || !body.startsAt || !body.customerName) {
    return c.json(
      { error: "serviceId, resourceId, startsAt and customerName are required" },
      400,
    );
  }

  const context = await loadTenantContext(db, slug, "2000-01-01", "2000-01-01");
  if (!context) return c.json({ error: "unknown tenant" }, 404);

  const serviceRow = resolveService(context.services, body.serviceId);
  if (!serviceRow) return c.json({ error: "unknown service" }, 404);

  const resource = context.resources.find((r) => r.id === body.resourceId);
  if (!resource) return c.json({ error: "unknown resource" }, 404);

  const startsAt = new Date(body.startsAt);
  if (Number.isNaN(startsAt.getTime())) return c.json({ error: "invalid startsAt" }, 400);
  const endsAt = new Date(startsAt.getTime() + serviceRow.durationMinutes * 60_000);

  const timezone = context.tenant.timezone;
  const date = toLocalDate(startsAt, timezone);

  const scoped = await loadTenantContext(db, slug, date, date);
  const busy = await loadBusyIntervals(
    db,
    context.tenant.id,
    padDays(startsAt, -2),
    padDays(endsAt, 2),
  );

  const check = validateBooking({
    request: { resourceId: resource.id, startsAt, endsAt },
    resource: { id: resource.id, name: resource.name, capacity: resource.capacity },
    timezone,
    now: new Date(),
    capacity: serviceRow.capacity,
    bufferBeforeMinutes: serviceRow.bufferBeforeMinutes,
    busy,
    rules: scoped?.rules ?? context.rules,
    exceptions: scoped?.exceptions ?? [],
  });

  if (!check.ok) {
    const status = check.reason === "conflict" ? 409 : 422;
    return c.json({ error: check.message, reason: check.reason }, status);
  }

  // The repository re-checks under a row lock, so a race still loses cleanly.
  const outcome = await createBooking(db, {
    tenantId: context.tenant.id,
    serviceId: serviceRow.id,
    resourceId: resource.id,
    startsAt,
    endsAt,
    customerName: body.customerName,
    customerPhone: body.customerPhone ?? null,
    source: body.source ?? "dashboard",
  });

  if (!outcome.ok) {
    return c.json({ error: "Could not hold that slot.", reason: outcome.reason }, 409);
  }

  return c.json(
    {
      booking: {
        id: outcome.booking.id,
        serviceId: outcome.booking.serviceId,
        serviceName: serviceRow.name,
        resourceId: outcome.booking.resourceId,
        resourceName: resource.name,
        startsAt: outcome.booking.startsAt.toISOString(),
        endsAt: outcome.booking.endsAt.toISOString(),
        customerName: outcome.booking.customerName,
        status: outcome.booking.status,
      },
    },
    201,
  );
});

function padDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * POST /api/tenants/:slug/chat
 * Body: { messages: [{ role: "user" | "assistant", content: string }] }
 * The client owns the history for now; persistence arrives with channels.
 */
app.post("/api/tenants/:slug/chat", async (c) => {
  if (!config.groqApiKey) {
    return c.json({ error: "chat is not configured: GROQ_API_KEY is missing" }, 503);
  }

  const body = (await c.req.json().catch(() => null)) as {
    messages?: Array<{ role?: string; content?: string }>;
  } | null;

  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return c.json({ error: "messages[] is required" }, 400);
  }

  const history = body.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-20)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: String(m.content ?? "").trim(),
    }))
    .filter((m) => m.content.length > 0);

  if (history.length === 0) return c.json({ error: "no usable messages" }, 400);
  if (history[history.length - 1]?.role !== "user") {
    return c.json({ error: "the last message must be from the user" }, 400);
  }

  const port = await buildAgentPort(db, c.req.param("slug"), new Date());
  if (!port) return c.json({ error: "unknown tenant" }, 404);

  try {
    const result = await runAgent(port, history, {
      model: config.llmModel,
      apiKey: config.groqApiKey,
    });

    return c.json({
      reply: result.text,
      escalated: result.escalated,
      bookingId: result.bookingId,
      toolCalls: result.toolCalls,
    });
  } catch (error) {
    console.error("agent error:", error);
    return c.json(
      {
        error: "The assistant is unavailable right now.",
        detail: error instanceof Error ? error.message : String(error),
      },
      502,
    );
  }
});

/**
 * Telegram: polling locally, webhook in production.
 * Both routes feed the same `handleInbound` pipeline.
 */
const telegram = config.telegram.token
  ? createTelegramBot({
      token: config.telegram.token,
      tenantSlug: config.telegram.tenantSlug,
      db,
      apiKey: config.groqApiKey,
      model: config.llmModel,
    })
  : null;

if (telegram && config.telegram.mode === "webhook") {
  app.post("/webhooks/telegram/:secret", async (c) => {
    if (c.req.param("secret") !== config.telegram.webhookSecret) {
      return c.json({ error: "forbidden" }, 403);
    }

    const update = await c.req.json().catch(() => null);
    if (!update) return c.json({ error: "bad update" }, 400);

    await telegram.bot.handleUpdate(update);
    return c.json({ ok: true });
  });
}

if (telegram && config.telegram.mode === "polling") {
  telegram.bot
    .start({
      drop_pending_updates: true,
      onStart: (info) => {
        console.log(`telegram bot @${info.username} is polling for messages`);
      },
    })
    .catch((error) => console.error("telegram polling failed:", error));
} else if (telegram) {
  console.log("telegram bot in webhook mode — POST /webhooks/telegram/:secret");
}

// Serve last, so every route is registered first.
serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`booking engine api listening on http://localhost:${info.port}`);
});
