import type { Bot } from "grammy";
import {
  deriveWebhookSecret,
  listActiveTenantChannels,
  openSecret,
  type Database,
} from "@booking/db";
import type { Channel } from "@booking/channels";

import { createTelegramBot } from "./telegram";

/**
 * One running bot per business.
 *
 * A bot token belongs to a business, not to the deployment, so the process
 * builds this map from the database at boot: slug → bot. Adding client #2 is a
 * `tenant:channel` command and a restart, not an env edit.
 */
export interface TenantBot {
  tenantId: string;
  slug: string;
  bot: Bot;
  channel: Channel;
  /** Derived, never stored. Verified with a constant-time compare. */
  webhookSecret: string;
}

export interface LoadBotsOptions {
  apiKey?: string;
  model?: string;
  /**
   * Call getMe at boot. True in production; false in tests, where a real
   * Telegram round trip is neither available nor the thing under test.
   */
  init?: boolean;
}

export async function loadTelegramBots(
  db: Database,
  key: Buffer,
  options: LoadBotsOptions = {},
): Promise<Map<string, TenantBot>> {
  const rows = await listActiveTenantChannels(db);
  const bots = new Map<string, TenantBot>();

  for (const row of rows) {
    if (row.channel !== "telegram") continue;

    const token = openSecret(row.secretCiphertext, key);
    const { bot, channel } = createTelegramBot({
      token,
      tenantSlug: row.slug,
      db,
      apiKey: options.apiKey,
      model: options.model,
    });

    // getMe before serving: a bad token should fail at boot, not on the first
    // customer message.
    if (options.init !== false) await bot.init();

    bots.set(row.slug, {
      tenantId: row.tenantId,
      slug: row.slug,
      bot,
      channel,
      webhookSecret: deriveWebhookSecret(key, row.tenantId, "telegram"),
    });
  }

  return bots;
}
