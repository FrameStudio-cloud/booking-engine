import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { runAgent } from "@booking/agent";
import { createTelegramChannel, type Channel } from "@booking/channels";
import {
  appendMessage,
  cancelBooking,
  conversationSummaries,
  createBooking,
  getBookingById,
  getConversationByExternalId,
  getConversationById,
  getTenantBySlug,
  getTenantChannel,
  listBookings,
  listPublicServices,
  loadBusyIntervals,
  loadTenantContext,
  markConversationRead,
  messageThread,
  openSecret,
  parseSecretKey,
  pingDatabase,
  rescheduleBooking,
  resolveService,
  setConversationStatus,
  toSharedService,
} from "@booking/db";
import {
  addDays,
  checkCancellation,
  getStrategy,
  planReschedule,
  toLocalDate,
  validateBooking,
  zonedTimeToUtc,
} from "@booking/core";
import { formatMoney, localDateSchema, type LocalDate } from "@booking/shared";
import { config } from "./env";
import { db } from "./db";
import { buildAgentPort } from "./agent-port";
import { runTurn } from "./pipeline";
import { notifyNewBooking } from "./notify";

export const app = new Hono();

/**
 * The widget bundle, served by the API itself.
 *
 * One URL is easier to hand a customer than "bundle here, API there": the
 * snippet collapses to a single tag, and the widget assumes the API lives on
 * the origin it was loaded from.
 */
const widgetBundle = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(resolve(here, "../../widget/dist/widget.js"), "utf8");
  } catch {
    return null;
  }
})();

app.get("/widget.js", (c) => {
  if (!widgetBundle) {
    return c.text(
      "widget bundle is not built: run `pnpm --filter @booking/widget build`",
      503,
    );
  }

  return c.body(widgetBundle, 200, {
    "content-type": "text/javascript; charset=utf-8",
    // Same file for every customer; short cache so a new build lands quickly.
    "cache-control": "public, max-age=300",
  });
});

/**
 * The public price list is the one route whose allowed origins differ per
 * tenant, so it sets its own CORS header instead of going through this one.
 */
const publicCatalogPath = /^\/api\/tenants\/[^/]+\/services\/?$/;

function isPublicCatalog(path: string): boolean {
  return publicCatalogPath.test(path);
}

const dashboardCors = cors({
  origin: (origin, c) =>
    c.req.path.includes("/widget/") ? (origin ?? "*") : config.dashboardOrigin,
});

// The dashboard is one origin. The widget is embedded anywhere, so it may come
// from any host — decided per request rather than with a second middleware,
// because the global one answers preflights before anything else can run.
app.use("*", async (c, next) => {
  if (isPublicCatalog(c.req.path)) return next();
  return dashboardCors(c, next);
});

/**
 * Machine auth. CORS restricts browsers; this restricts everyone.
 *
 * The widget routes and the public price list stay open by design: they are the
 * embed and the customer's own site, they speak only to one tenant's own
 * marketing data, and they are rate limited below.
 */
function sameKey(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.use("/api/tenants/*", async (c, next) => {
  if (c.req.path.includes("/widget/")) return next();
  if (isPublicCatalog(c.req.path)) return next();

  if (!sameKey(c.req.header("x-engine-key") ?? "", config.engineApiKey)) {
    return c.json({ error: "unauthorised" }, 401);
  }

  return next();
});

/** Cheap fixed-window limit. One instance, so memory is enough for now. */
const buckets = new Map<string, { count: number; resetAt: number }>();

function limited(key: string, limit: number, windowMs: number): number {
  const now = Date.now();

  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 0;
  }

  if (bucket.count >= limit) return Math.ceil((bucket.resetAt - now) / 1000);

  bucket.count += 1;
  return 0;
}

/** Behind Render's proxy the client is in x-forwarded-for, not the socket. */
function clientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}

function tooMany(c: Context, retryAfter: number) {
  c.header("retry-after", String(retryAfter));
  return c.json({ error: "too many requests" }, 429);
}

// Paid routes: every call costs a model request and a database write.
app.use("/api/tenants/:slug/chat", async (c, next) => {
  const wait = limited(`chat:${clientIp(c)}`, 30, 60_000);
  return wait > 0 ? tooMany(c, wait) : next();
});

app.use("/api/tenants/:slug/widget/messages", async (c, next) => {
  const wait = limited(`wip:${clientIp(c)}`, 60, 60_000);
  return wait > 0 ? tooMany(c, wait) : next();
});

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
  const tenant = await getTenantBySlug(db, c.req.param("slug"));
  if (!tenant) return c.json({ error: "unknown tenant" }, 404);

  // The tenant's own clock, not ours. Every other route already does this.
  const today = toLocalDate(new Date(), tenant.timezone);
  const context = await loadTenantContext(db, tenant.slug, today, today);
  if (!context) return c.json({ error: "unknown tenant" }, 404);

  return c.json({
    tenant: context.tenant,
    services: context.services,
    resources: context.resources,
    rules: context.rules,
  });
});

/**
 * The customer's own site reads its price list here.
 *
 * No key: a public page cannot hold one. It returns marketing data only —
 * names, durations, prices — never staff phone numbers or bookings. Origins are
 * restricted only when the tenant configured them; an open list is public
 * information, and locking it down just breaks the client's own site.
 */
app.on(["GET", "OPTIONS"], "/api/tenants/:slug/services", async (c) => {
  const tenant = await getTenantBySlug(db, c.req.param("slug"));
  if (!tenant || !tenant.active) return c.json({ error: "unknown business" }, 404);

  const configured = tenant.settings.allowedOrigins ?? [];
  const origin = c.req.header("origin");
  const allowedOrigin =
    origin && (configured.length === 0 || configured.includes(origin)) ? origin : null;

  const headers: Record<string, string> = {
    vary: "origin",
    "cache-control": "public, max-age=60",
  };

  if (allowedOrigin) headers["access-control-allow-origin"] = allowedOrigin;

  if (c.req.method === "OPTIONS") {
    headers["access-control-allow-methods"] = "GET, OPTIONS";
    headers["access-control-max-age"] = "86400";
    return c.body(null, 204, headers);
  }

  const wait = limited(`svc:${clientIp(c)}`, 60, 60_000);
  if (wait > 0) {
    return c.json({ error: "too many requests" }, 429, {
      ...headers,
      "retry-after": String(wait),
    });
  }

  const rows = await listPublicServices(db, tenant.id);

  return c.json(
    {
      business: {
        slug: tenant.slug,
        name: tenant.name,
        currency: tenant.currency,
        timezone: tenant.timezone,
      },
      catalogSyncedAt: tenant.catalogSyncedAt.toISOString(),
      services: rows.map((row) => ({
        id: row.id,
        name: row.name,
        durationMinutes: row.durationMinutes,
        priceMinor: row.priceMinor,
        price: formatMoney(row.priceMinor, tenant.currency),
      })),
    },
    200,
    headers,
  );
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

  await notifyNewBooking(context.tenant, {
    customerName: outcome.booking.customerName,
    serviceName: serviceRow.name,
    resourceName: resource.name,
    startsAt: outcome.booking.startsAt,
    source: outcome.booking.source,
  });

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

/** POST /api/tenants/:slug/bookings/:id/cancel */
app.post("/api/tenants/:slug/bookings/:id/cancel", async (c) => {
  const tenant = await getTenantBySlug(db, c.req.param("slug"));
  if (!tenant) return c.json({ error: "unknown tenant" }, 404);

  const booking = await getBookingById(db, tenant.id, c.req.param("id"));
  if (!booking) return c.json({ error: "unknown booking" }, 404);

  const check = checkCancellation({
    status: booking.status,
    startsAt: booking.startsAt,
    now: new Date(),
  });
  if (!check.ok) return c.json({ error: check.message, reason: check.reason }, 422);

  const body = (await c.req.json().catch(() => null)) as { reason?: string } | null;

  const outcome = await cancelBooking(db, {
    tenantId: tenant.id,
    bookingId: booking.id,
    by: "staff",
    reason: body?.reason ?? null,
  });

  if (!outcome.ok) {
    return c.json({ error: "Could not cancel that booking.", reason: outcome.reason }, 409);
  }

  return c.json({
    booking: {
      id: outcome.booking.id,
      status: outcome.booking.status,
      statusReason: outcome.booking.statusReason,
      alreadyCancelled: outcome.alreadyCancelled ?? false,
    },
    serviceName: outcome.booking.serviceNameAtBooking,
    startsAt: outcome.booking.startsAt.toISOString(),
  });
});

/** POST /api/tenants/:slug/bookings/:id/reschedule  { startsAt } */
app.post("/api/tenants/:slug/bookings/:id/reschedule", async (c) => {
  const tenant = await getTenantBySlug(db, c.req.param("slug"));
  if (!tenant) return c.json({ error: "unknown tenant" }, 404);

  const booking = await getBookingById(db, tenant.id, c.req.param("id"));
  if (!booking) return c.json({ error: "unknown booking" }, 404);

  const body = (await c.req.json().catch(() => null)) as {
    startsAt?: string;
    reason?: string;
  } | null;

  const newStart = body?.startsAt ? new Date(body.startsAt) : null;
  if (!newStart || Number.isNaN(newStart.getTime())) {
    return c.json({ error: "startsAt must be an ISO timestamp" }, 400);
  }

  const timezone = tenant.timezone;
  const date = toLocalDate(newStart, timezone);
  const context = await loadTenantContext(db, tenant.slug, date, date);
  if (!context) return c.json({ error: "unknown tenant" }, 404);

  const resource = context.resources.find((r) => r.id === booking.resourceId);
  if (!resource) return c.json({ error: "booking has no live resource" }, 409);

  const serviceRow = context.services.find((s) => s.id === booking.serviceId);

  const busy = await loadBusyIntervals(
    db,
    tenant.id,
    padDays(newStart, -2),
    padDays(newStart, 2),
  );

  const plan = planReschedule({
    booking: {
      resourceId: booking.resourceId,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      status: booking.status,
    },
    newStart,
    request: { resourceId: booking.resourceId, startsAt: newStart, endsAt: newStart },
    resource: { id: resource.id, name: resource.name, capacity: resource.capacity },
    timezone,
    now: new Date(),
    capacity: serviceRow?.capacity ?? 1,
    bufferBeforeMinutes: serviceRow?.bufferBeforeMinutes ?? 0,
    busy,
    rules: context.rules,
    exceptions: context.exceptions,
  });

  if (!plan.ok) {
    return c.json(
      { error: plan.message, reason: plan.reason },
      plan.reason === "conflict" ? 409 : 422,
    );
  }

  const outcome = await rescheduleBooking(db, {
    tenantId: tenant.id,
    bookingId: booking.id,
    startsAt: plan.startsAt,
    endsAt: plan.endsAt,
    by: "staff",
    reason: body?.reason ?? null,
  });

  if (!outcome.ok) {
    return c.json(
      { error: "That slot was just taken.", reason: outcome.reason },
      outcome.reason === "not_found" ? 404 : 409,
    );
  }

  return c.json({
    booking: {
      id: outcome.booking.id,
      startsAt: outcome.booking.startsAt.toISOString(),
      endsAt: outcome.booking.endsAt.toISOString(),
      status: outcome.booking.status,
    },
    serviceName: outcome.booking.serviceNameAtBooking,
  });
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
 * Dashboard reads.
 *
 * No auth yet — these are the endpoints the shell will consume, and they close
 * as soon as tenant auth lands (phase 5). Everything is tenant-scoped by slug.
 */
app.get("/api/tenants/:slug/bookings", async (c) => {
  const tenant = await getTenantBySlug(db, c.req.param("slug"));
  if (!tenant) return c.json({ error: "unknown tenant" }, 404);

  const today = toLocalDate(new Date(), tenant.timezone);
  const parsed = localDateSchema.safeParse(c.req.query("date") ?? today);
  if (!parsed.success) return c.json({ error: "date must be YYYY-MM-DD" }, 400);
  const date = parsed.data as LocalDate;

  const from = zonedTimeToUtc(date, "00:00", tenant.timezone);
  const to = zonedTimeToUtc(addDays(date, 1), "00:00", tenant.timezone);
  const rows = await listBookings(db, tenant.id, { from, to });

  return c.json({
    date,
    bookings: rows.map((row) => ({
      ...row,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
    })),
  });
});

app.get("/api/tenants/:slug/conversations", async (c) => {
  const tenant = await getTenantBySlug(db, c.req.param("slug"));
  if (!tenant) return c.json({ error: "unknown tenant" }, 404);

  const rows = await conversationSummaries(db, tenant.id);

  return c.json({
    conversations: rows.map((row) => ({
      ...row,
      updatedAt: row.updatedAt.toISOString(),
      lastMessage: row.lastMessage
        ? { ...row.lastMessage, at: row.lastMessage.at.toISOString() }
        : null,
    })),
  });
});

app.get("/api/tenants/:slug/conversations/:id", async (c) => {
  const tenant = await getTenantBySlug(db, c.req.param("slug"));
  if (!tenant) return c.json({ error: "unknown tenant" }, 404);

  const conversation = await getConversationById(db, tenant.id, c.req.param("id"));
  if (!conversation) return c.json({ error: "unknown conversation" }, 404);

  const rows = await messageThread(db, conversation.id);

  return c.json({
    conversation: {
      id: conversation.id,
      customerName: conversation.customerName,
      channel: conversation.channel,
      status: conversation.status,
      updatedAt: conversation.lastMessageAt.toISOString(),
    },
    messages: rows.map((row) => ({
      id: row.id,
      role: row.role,
      text: row.content,
      /** Display name of the staff member, when a human wrote it. */
      author: row.author,
      at: row.createdAt.toISOString(),
    })),
  });
});

/**
 * Mark a thread as read. Separate from GET on purpose: a dashboard that polls
 * the thread list must not silently clear the badge.
 */
app.post("/api/tenants/:slug/conversations/:id/read", async (c) => {
  const tenant = await getTenantBySlug(db, c.req.param("slug"));
  if (!tenant) return c.json({ error: "unknown tenant" }, 404);

  const conversation = await getConversationById(db, tenant.id, c.req.param("id"));
  if (!conversation) return c.json({ error: "unknown conversation" }, 404);

  await markConversationRead(db, conversation.id);

  return c.json({
    conversation: { id: conversation.id, unread: false, unreadCount: 0 },
  });
});

/**
 * Staff reply. It goes out through the same `Channel.send` the bot uses, so the
 * customer sees one thread — not a bot and a person talking over each other.
 * The message is stored before delivery: a failed send must not lose the text.
 */
app.post("/api/tenants/:slug/conversations/:id/reply", async (c) => {
  const tenant = await getTenantBySlug(db, c.req.param("slug"));
  if (!tenant) return c.json({ error: "unknown tenant" }, 404);

  const conversation = await getConversationById(db, tenant.id, c.req.param("id"));
  if (!conversation) return c.json({ error: "unknown conversation" }, 404);

  const body = (await c.req.json().catch(() => null)) as {
    text?: string;
    staff?: string;
  } | null;
  const text = body?.text?.trim() ?? "";
  if (text.length === 0) return c.json({ error: "text is required" }, 400);
  if (text.length > 2000) return c.json({ error: "text is too long" }, 400);

  // Attribution is a display name, not an account. Header wins so a proxy can
  // set it; body is the fallback for curl and the dashboard.
  const author =
    (c.req.header("x-staff-name") ?? body?.staff ?? "").trim().slice(0, 40) || null;

  const message = await appendMessage(db, conversation.id, "staff", text, author);
  await setConversationStatus(db, conversation.id, "human");
  // Replying is the strongest possible "I have read this".
  await markConversationRead(db, conversation.id, message.createdAt);

  const delivery = await deliverTo(tenant.id, conversation.channel, conversation.externalId, text);

  return c.json({
    message: {
      id: message.id,
      role: "staff",
      text: message.content,
      author: message.author,
      at: message.createdAt.toISOString(),
    },
    status: "human",
    ...delivery,
  });
});

app.post("/api/tenants/:slug/conversations/:id/takeover", async (c) => {
  const tenant = await getTenantBySlug(db, c.req.param("slug"));
  if (!tenant) return c.json({ error: "unknown tenant" }, 404);

  const conversation = await getConversationById(db, tenant.id, c.req.param("id"));
  if (!conversation) return c.json({ error: "unknown conversation" }, 404);

  await setConversationStatus(db, conversation.id, "human");
  return c.json({ status: "human" });
});

app.post("/api/tenants/:slug/conversations/:id/handback", async (c) => {
  const tenant = await getTenantBySlug(db, c.req.param("slug"));
  if (!tenant) return c.json({ error: "unknown tenant" }, 404);

  const conversation = await getConversationById(db, tenant.id, c.req.param("id"));
  if (!conversation) return c.json({ error: "unknown conversation" }, 404);

  await setConversationStatus(db, conversation.id, "bot");
  return c.json({ status: "bot" });
});

/**
 * Website widget.
 *
 * Anyone can embed this, so these two routes answer any origin — unlike the
 * dashboard routes above. The session id generated by the widget is its whole
 * identity; there is no login and no personal data beyond what the chat holds.
 */
const SESSION_RE = /^[A-Za-z0-9_-]{8,128}$/;

app.get("/api/tenants/:slug/widget/config", async (c) => {
  const tenant = await getTenantBySlug(db, c.req.param("slug"));
  if (!tenant) return c.json({ error: "unknown tenant" }, 404);

  const settings = tenant.settings ?? {};

  return c.json({
    businessName: tenant.name,
    greeting:
      settings.widget?.greeting ??
      "Hi — I can check what's free and hold a spot for you. What are you after?",
    replyTime: settings.widget?.replyTime ?? "Usually replies instantly",
    accent: settings.brand?.accent ?? "#111111",
    position: settings.brand?.position ?? "right",
    /**
     * The notice the customer sees before they type. This is a data-protection
     * line, not decoration: it says the chat is recorded and that a human reads
     * it. `privacyUrl` is the business's own policy page, if they have one.
     */
    consent:
      settings.privacy?.notice ??
      "This chat is recorded so we can help you, and our team can read it.",
    privacyUrl: settings.privacy?.url ?? null,
  });
});

app.post("/api/tenants/:slug/widget/messages", async (c) => {
  if (!config.groqApiKey) {
    return c.json({ error: "chat is not configured: GROQ_API_KEY is missing" }, 503);
  }

  const body = (await c.req.json().catch(() => null)) as {
    sessionId?: string;
    text?: string;
    customerName?: string;
  } | null;

  const sessionId = body?.sessionId ?? "";
  const text = body?.text?.trim() ?? "";

  if (!SESSION_RE.test(sessionId)) return c.json({ error: "invalid sessionId" }, 400);
  if (text.length === 0) return c.json({ error: "text is required" }, 400);
  if (text.length > 2000) return c.json({ error: "text is too long" }, 400);

  // One chat window cannot drain the model budget on its own.
  const sessionWait = limited(`wis:${sessionId}`, 20, 60_000);
  if (sessionWait > 0) return tooMany(c, sessionWait);

  // The widget has no push channel: the reply travels back on this response.
  const replies: string[] = [];
  const capture: Channel = {
    name: "widget",
    async send(_externalId, message) {
      replies.push(message.text);
    },
  };

  try {
    const result = await runTurn({
      db,
      tenantSlug: c.req.param("slug"),
      channel: capture,
      externalId: sessionId,
      text,
      customerName: body?.customerName ?? null,
      apiKey: config.groqApiKey,
      model: config.llmModel,
    });

    if (!result) return c.json({ error: "unknown tenant" }, 404);

    return c.json({
      replies,
      status: result.status,
      conversationId: result.conversationId,
    });
  } catch (error) {
    console.error("[widget] turn failed", error);
    return c.json({ error: "The assistant is unavailable right now." }, 502);
  }
});

app.get("/api/tenants/:slug/widget/messages", async (c) => {
  const tenant = await getTenantBySlug(db, c.req.param("slug"));
  if (!tenant) return c.json({ error: "unknown tenant" }, 404);

  const sessionId = c.req.query("sessionId") ?? "";
  if (!SESSION_RE.test(sessionId)) return c.json({ error: "invalid sessionId" }, 400);

  const conversation = await getConversationByExternalId(db, {
    tenantId: tenant.id,
    channel: "widget",
    externalId: sessionId,
  });

  if (!conversation) return c.json({ status: "new", messages: [] });

  const rows = await messageThread(db, conversation.id);

  return c.json({
    status: conversation.status,
    messages: rows.map((row) => ({
      id: row.id,
      role: row.role,
      text: row.content,
      at: row.createdAt.toISOString(),
    })),
  });
});

/**
 * Telegram: polling locally, webhook in production. Started by `server.ts`, not
 * on import, so tests can drive the app without a bot or a port.
 */
const telegramChannel: Channel | null = config.telegram.token
  ? createTelegramChannel(config.telegram.token)
  : null;

/**
 * One outbound door for staff replies, so a human message reaches the same
 * thread the bot uses. Widget delivery arrives with phase 4.
 *
 * The credential is resolved per tenant: a staff reply must leave through that
 * business's bot, not through whichever bot the process happened to load.
 */
async function deliverTo(
  tenantId: string,
  channel: "telegram" | "widget" | "whatsapp",
  externalId: string,
  text: string,
): Promise<{ delivered: boolean; error?: string }> {
  if (channel !== "telegram") {
    return { delivered: false, error: `no delivery channel for ${channel} yet` };
  }

  const stored = config.channelSecretKey
    ? await getTenantChannel(db, tenantId, "telegram")
    : null;

  const outbound = stored?.active && config.channelSecretKey
    ? createTelegramChannel(openSecret(stored.secretCiphertext, parseSecretKey(config.channelSecretKey)))
    : telegramChannel;

  if (!outbound) {
    return { delivered: false, error: "telegram is not configured for this business" };
  }

  try {
    await outbound.send(externalId, { text, quickReplies: [] });
    return { delivered: true };
  } catch (error) {
    return { delivered: false, error: error instanceof Error ? error.message : "send failed" };
  }
}

// Telegram polling, the webhook route, the scheduler and the HTTP listener live
// in `server.ts`. This module only builds the app, so tests can import it.

