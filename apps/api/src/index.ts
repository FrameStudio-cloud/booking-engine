import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { runAgent } from "@booking/agent";
import { createTelegramChannel, type Channel } from "@booking/channels";
import {
  appendMessage,
  conversationSummaries,
  createBooking,
  getConversationByExternalId,
  getConversationById,
  getTenantBySlug,
  listBookings,
  loadBusyIntervals,
  loadTenantContext,
  messageThread,
  pingDatabase,
  resolveService,
  setConversationStatus,
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
import { runTurn } from "./pipeline";

const app = new Hono();

// The dashboard is one origin. The widget is embedded anywhere, so it may come
// from any host — decided per request rather than with a second middleware,
// because the global one answers preflights before anything else can run.
app.use(
  "*",
  cors({
    origin: (origin, c) =>
      c.req.path.includes("/widget/") ? (origin ?? "*") : config.dashboardOrigin,
  }),
);

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
    rules: context.rules,
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
      at: row.createdAt.toISOString(),
    })),
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

  const body = (await c.req.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim() ?? "";
  if (text.length === 0) return c.json({ error: "text is required" }, 400);
  if (text.length > 2000) return c.json({ error: "text is too long" }, 400);

  const message = await appendMessage(db, conversation.id, "staff", text);
  await setConversationStatus(db, conversation.id, "human");

  const delivery = await deliverTo(conversation.channel, conversation.externalId, text);

  return c.json({
    message: {
      id: message.id,
      role: "staff",
      text: message.content,
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

/** Telegram: polling locally, webhook in production. */
const telegramChannel: Channel | null = config.telegram.token
  ? createTelegramChannel(config.telegram.token)
  : null;

/**
 * One outbound door for staff replies, so a human message reaches the same
 * thread the bot uses. Widget delivery arrives with phase 4.
 */
async function deliverTo(
  channel: "telegram" | "widget" | "whatsapp",
  externalId: string,
  text: string,
): Promise<{ delivered: boolean; error?: string }> {
  if (channel !== "telegram") {
    return { delivered: false, error: `no delivery channel for ${channel} yet` };
  }
  if (!telegramChannel) {
    return { delivered: false, error: "telegram is not configured" };
  }

  try {
    await telegramChannel.send(externalId, { text, quickReplies: [] });
    return { delivered: true };
  } catch (error) {
    return { delivered: false, error: error instanceof Error ? error.message : "send failed" };
  }
}

const telegram = config.telegram.token
  ? createTelegramBot({
      token: config.telegram.token,
      tenantSlug: config.telegram.tenantSlug,
      db,
      apiKey: config.groqApiKey,
      model: config.llmModel,
      channel: telegramChannel ?? undefined,
    })
  : null;

if (telegram && config.telegram.mode === "webhook") {
  // Webhook updates arrive before polling would ever init the bot.
  await telegram.bot.init();

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
