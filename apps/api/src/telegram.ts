import { Bot } from "grammy";
import type { Database } from "@booking/db";
import { createTelegramChannel, type Channel } from "@booking/channels";

import { runTurn } from "./pipeline";

export interface TelegramBotOptions {
  token: string;
  tenantSlug: string;
  db: Database;
  apiKey?: string;
  model?: string;
  /** Swap the outbound transport in tests; defaults to the real Telegram API. */
  channel?: Channel;
}

export function createTelegramBot(options: TelegramBotOptions) {
  const { token, tenantSlug, db } = options;
  const bot = new Bot(token);
  const channel = options.channel ?? createTelegramChannel(token);

  async function onText(chatId: string, text: string, customerName?: string | null) {
    const result = await runTurn({
      db,
      tenantSlug,
      channel,
      externalId: chatId,
      text,
      customerName: customerName ?? null,
      apiKey: options.apiKey,
      model: options.model,
    });

    if (!result) throw new Error(`unknown tenant: ${tenantSlug}`);
  }

  const displayName = (from?: { first_name: string; last_name?: string }): string | null =>
    from ? [from.first_name, from.last_name].filter(Boolean).join(" ") : null;

  // /start is a greeting, not a command to the model.
  bot.command("start", async (ctx) => {
    await onText(String(ctx.chat.id), "Hi", displayName(ctx.from));
  });

  bot.on("message:text", async (ctx) => {
    await onText(String(ctx.chat.id), ctx.message.text, displayName(ctx.from));
  });

  // Photos, voice notes, stickers: say so instead of failing silently.
  bot.on("message", async (ctx) => {
    await ctx.reply("I can only read text for now — could you type that out?");
  });

  bot.catch((err) => {
    console.error("[telegram] unhandled bot error", err.error);
  });

  return { bot, onText };
}
