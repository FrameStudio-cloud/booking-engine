import { Bot } from "grammy";
import { runAgent } from "@booking/agent";
import {
  appendMessage,
  getOrCreateConversation,
  getTenantBySlug,
  recentMessages,
  setConversationStatus,
  toModelHistory,
  type Database,
} from "@booking/db";
import {
  createTelegramChannel,
  handleInbound,
  type Channel,
  type ConversationStore,
} from "@booking/channels";

import { buildAgentPort } from "./agent-port";

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

  /**
   * One inbound message, end to end. Both polling and webhook land here,
   * so the transport cannot change behaviour.
   */
  async function onText(chatId: string, text: string, customerName?: string | null) {
    const tenant = await getTenantBySlug(db, tenantSlug);
    if (!tenant) throw new Error(`unknown tenant: ${tenantSlug}`);

    const port = await buildAgentPort(db, tenant.slug, new Date());
    if (!port) throw new Error(`could not build agent port for ${tenantSlug}`);

    const store: ConversationStore = {
      getOrCreate: async (event) => {
        const row = await getOrCreateConversation(db, {
          tenantId: tenant.id,
          channel: event.channel,
          externalId: event.externalId,
          customerName: event.customerName,
        });
        return { id: row.id, status: row.status };
      },
      append: async (conversationId, role, content) => {
        await appendMessage(db, conversationId, role, content);
      },
      history: async (conversationId, limit) =>
        toModelHistory(await recentMessages(db, conversationId, limit)),
      setStatus: async (conversationId, status) => {
        await setConversationStatus(db, conversationId, status);
      },
    };

    await handleInbound(
      {
        store,
        channel,
        agent: {
          run: async (history) => {
            const result = await runAgent(port, history, {
              apiKey: options.apiKey,
              model: options.model,
            });
            return { text: result.text, escalated: result.escalated };
          },
        },
        logger: {
          info: (message, meta) => console.log(`[telegram] ${message}`, meta ?? ""),
          error: (message, error) => console.error(`[telegram] ${message}`, error),
        },
      },
      {
        tenantId: tenant.id,
        channel: "telegram",
        externalId: chatId,
        text,
        customerName: customerName ?? null,
      },
    );
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
