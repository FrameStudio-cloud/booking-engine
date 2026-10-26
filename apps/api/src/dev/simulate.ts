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
const CUSTOMER = "Sim Tester";

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

const lines = [
  "I need a trim tomorrow",
  "book the first one please",
  CUSTOMER,
  "thanks, bye",
  "hi, do you have a trim tomorrow?",
  CUSTOMER,
];

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

const booked = await db.query.bookings.findMany({
  where: (table, { eq }) => eq(table.customerName, CUSTOMER),
});

console.log(`\nbookings for ${CUSTOMER}: ${booked.length}`);
for (const row of booked) console.log(`  ${row.startsAt.toISOString()} (${row.status})`);

if (booked.length !== 1) {
  console.error("FAIL: expected exactly one booking");
  process.exit(1);
}

const bookedResource = await db.query.resources.findFirst({
  where: (table, { eq }) => eq(table.id, booked[0]!.resourceId),
});
const others = await db.query.resources.findMany();
const wrong = others.filter((r) => r.id !== bookedResource?.id).map((r) => r.name);

const last = sent.at(-1) ?? "";
const namesRight = bookedResource ? last.includes(bookedResource.name) : false;
const noInvented = wrong.every((name) => !last.includes(name));

console.log(`\nlast reply: ${last}`);
console.log(`names the booked resource (${bookedResource?.name}): ${namesRight}`);
console.log(`invents another name: ${!noInvented}`);

process.exit(namesRight && noInvented ? 0 : 1);
