/**
 * Drives the real Telegram pipeline without Telegram: same store, same agent,
 * same Postgres, but a channel that prints instead of sending.
 *
 *   pnpm --filter @booking/api exec tsx src/dev/simulate.ts
 */
import type { OutboundMessage } from "@booking/shared";
import { getTenantBySlug, messageThread } from "@booking/db";
import type { Channel } from "@booking/channels";

import { config } from "../env";
import { db } from "../db";
import { createTelegramBot } from "../telegram";

const CHAT_ID = "sim-9001";

const sent: string[] = [];
const echo: Channel = {
  name: "telegram",
  async send(_to: string, message: OutboundMessage) {
    sent.push(message.text);
  },
};

if (!config.telegram.token) throw new Error("TELEGRAM_BOT_TOKEN is missing");

const { onText } = createTelegramBot({
  token: config.telegram.token,
  tenantSlug: config.telegram.tenantSlug,
  db,
  apiKey: config.groqApiKey,
  model: config.llmModel,
  channel: echo,
});

const lines = ["I need a trim tomorrow", "book the first one please", "Wanjiku Wairimu"];

for (const [index, line] of lines.entries()) {
  console.log(`\n[${index + 1}] customer: ${line}`);
  await onText(CHAT_ID, line, "Sim Tester");
  console.log(`    bot: ${sent.at(-1)}`);
}

const tenant = await getTenantBySlug(db, config.telegram.tenantSlug);
if (!tenant) throw new Error("tenant missing");

const conversation = await db.query.conversations.findFirst({
  where: (table, { and, eq }) =>
    and(
      eq(table.tenantId, tenant.id),
      eq(table.channel, "telegram"),
      eq(table.externalId, CHAT_ID),
    ),
});

if (!conversation) throw new Error("conversation was not persisted");

const thread = await messageThread(db, conversation.id);
console.log(`\npersisted ${thread.length} messages for conversation ${conversation.id} (status: ${conversation.status})`);
for (const row of thread) console.log(`  ${row.role}: ${row.content}`);

process.exit(0);
