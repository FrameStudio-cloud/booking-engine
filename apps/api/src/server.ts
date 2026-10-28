import { serve } from "@hono/node-server";
import { createTelegramChannel } from "@booking/channels";
import {
  closeIdleConversations,
  listActiveTenantChannels,
  listActiveTenants,
  listBookings,
  parseSecretKey,
  secretsMatch,
} from "@booking/db";
import { addDays, toLocalDate, zonedTimeToUtc } from "@booking/core";

import { app } from "./index";
import { config } from "./env";
import { db } from "./db";
import { createTelegramBot } from "./telegram";
import { loadTelegramBots, type TenantBot } from "./bots";
import { ownerConfigured, sendDailyDigest } from "./notify";
import { runRetention } from "./retention";

/**
 * Everything that must not happen on import: a port, a bot, a timer.
 *
 * `index.ts` builds the app; this file runs it. Tests import the app and get
 * none of the side effects.
 */

/**
 * Telegram: one bot per business, loaded from `tenant_channels`.
 *
 * The env token is the old single-tenant path and stays as a fallback for local
 * work. It is only used when no stored credential exists, so a database row
 * always wins and there is never a question of which one is live.
 */
const storedChannels = await listActiveTenantChannels(db);
const channelKey = config.channelSecretKey ? parseSecretKey(config.channelSecretKey) : null;

if (storedChannels.length > 0 && !channelKey) {
  throw new Error(
    `${storedChannels.length} stored channel credential(s) but CHANNEL_SECRET_KEY is missing — refusing to start`,
  );
}

const bots: Map<string, TenantBot> = channelKey
  ? await loadTelegramBots(db, channelKey, {
      apiKey: config.groqApiKey,
      model: config.llmModel,
    })
  : new Map();

if (bots.size > 0) {
  if (config.telegram.mode === "webhook") {
    app.post("/webhooks/telegram/:slug/:secret", async (c) => {
      const entry = bots.get(c.req.param("slug"));
      if (!entry) return c.json({ error: "unknown channel" }, 404);

      // The secret is per tenant and derived, so a leaked URL costs one
      // business, not all of them.
      if (!secretsMatch(c.req.param("secret"), entry.webhookSecret)) {
        return c.json({ error: "forbidden" }, 403);
      }

      const update = await c.req.json().catch(() => null);
      if (!update) return c.json({ error: "bad update" }, 400);

      await entry.bot.handleUpdate(update);
      return c.json({ ok: true });
    });

    console.log(
      `telegram webhook ready for ${[...bots.keys()].join(", ")} — POST /webhooks/telegram/:slug/:secret`,
    );
  } else {
    for (const entry of bots.values()) {
      entry.bot
        .start({
          drop_pending_updates: true,
          onStart: (info) => {
            console.log(`telegram @${info.username} polling for ${entry.slug}`);
          },
        })
        .catch((error) => console.error(`telegram polling failed for ${entry.slug}:`, error));
    }
  }
} else if (config.telegram.token) {
  const legacy = createTelegramBot({
    token: config.telegram.token,
    tenantSlug: config.telegram.tenantSlug,
    db,
    apiKey: config.groqApiKey,
    model: config.llmModel,
    channel: createTelegramChannel(config.telegram.token),
  });

  if (config.telegram.mode === "webhook") {
    // Webhook updates arrive before polling would ever init the bot.
    await legacy.bot.init();

    app.post("/webhooks/telegram/:secret", async (c) => {
      if (c.req.param("secret") !== config.telegram.webhookSecret) {
        return c.json({ error: "forbidden" }, 403);
      }

      const update = await c.req.json().catch(() => null);
      if (!update) return c.json({ error: "bad update" }, 400);

      await legacy.bot.handleUpdate(update);
      return c.json({ ok: true });
    });

    console.log("telegram bot in webhook mode — POST /webhooks/telegram/:secret");
  } else {
    legacy.bot
      .start({
        drop_pending_updates: true,
        onStart: (info) => {
          console.log(`telegram bot @${info.username} is polling for messages`);
        },
      })
      .catch((error) => console.error("telegram polling failed:", error));
  }
}

/**
 * Scheduled work: close idle threads, apply retention, send the 07:00 digest.
 *
 * One process ticks every ten minutes. No queue, no cron service — the engine is
 * small enough, and losing one digest to a restart beats adding infrastructure
 * for it. A digest is sent at most once per tenant per local day; retention runs
 * at most once per tenant per local day, at whatever tick comes first.
 */
const DIGEST_HOUR = 7;
const IDLE_CLOSE_DAYS = 14;
const digestSent = new Set<string>();
const retentionDone = new Set<string>();

async function scheduledTick() {
  try {
    const closed = await closeIdleConversations(
      db,
      new Date(Date.now() - IDLE_CLOSE_DAYS * 86_400_000),
    );
    if (closed > 0) console.log(`[sweep] closed ${closed} idle conversation(s)`);
  } catch (error) {
    console.error("[sweep] close idle failed", error);
  }

  let tenants: Awaited<ReturnType<typeof listActiveTenants>> = [];

  try {
    tenants = await listActiveTenants(db);
  } catch (error) {
    console.error("[sweep] could not list tenants", error);
    return;
  }

  // Retention first: it is the promise with a deadline attached. Counts only in
  // the log — never message content.
  const now = new Date();
  const due = tenants.filter(
    (tenant) => !retentionDone.has(`${tenant.id}:${toLocalDate(now, tenant.timezone)}`),
  );

  if (due.length > 0) {
    const results = await runRetention(db, due, now);
    const byId = new Map(due.map((tenant) => [tenant.id, tenant]));

    for (const result of results) {
      // A failed tenant is retried on the next tick, not tomorrow.
      if (result.deleted < 0) continue;

      const tenant = byId.get(result.tenantId);
      if (!tenant) continue;

      retentionDone.add(`${result.tenantId}:${toLocalDate(now, tenant.timezone)}`);

      if (result.deleted > 0) {
        console.log(
          `[retention] ${result.slug} deleted ${result.deleted} message(s) older than ${result.days}d`,
        );
      }
    }
  }

  if (retentionDone.size > 500) retentionDone.clear();

  try {
    for (const tenant of tenants) {
      if (!ownerConfigured(tenant)) continue;

      const hour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: tenant.timezone,
          hour: "2-digit",
          hour12: false,
        }).format(now),
      );
      if (hour !== DIGEST_HOUR) continue;

      const today = toLocalDate(now, tenant.timezone);
      const key = `${tenant.id}:${today}`;
      if (digestSent.has(key)) continue;

      const rows = await listBookings(db, tenant.id, {
        from: zonedTimeToUtc(today, "00:00", tenant.timezone),
        to: zonedTimeToUtc(addDays(today, 1), "00:00", tenant.timezone),
      });

      const live = rows.filter((row) => row.status !== "cancelled");
      const label = new Intl.DateTimeFormat("en-GB", {
        timeZone: tenant.timezone,
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(now);

      digestSent.add(key);
      await sendDailyDigest(tenant, label, live);
    }

    if (digestSent.size > 500) digestSent.clear();
  } catch (error) {
    console.error("[sweep] digest failed", error);
  }
}

const scheduler = setInterval(() => void scheduledTick(), 10 * 60_000);
scheduler.unref();

// Serve last, so every route is registered first.
serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`booking engine api listening on http://localhost:${info.port}`);
});
