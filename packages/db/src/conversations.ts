import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "./client";
import {
  conversations,
  messages,
  type ConversationRow,
  type MessageRow,
} from "./schema";

export type ConversationIdentity = {
  tenantId: string;
  channel: "telegram" | "widget" | "whatsapp";
  externalId: string;
  customerName?: string | null;
};

/**
 * One live conversation per (tenant, channel, externalId), enforced by a
 * unique index. Concurrent first messages race on insert; the loser re-reads.
 */
export async function getOrCreateConversation(
  db: Database,
  identity: ConversationIdentity,
): Promise<ConversationRow> {
  const find = () =>
    db.query.conversations.findFirst({
      where: and(
        eq(conversations.tenantId, identity.tenantId),
        eq(conversations.channel, identity.channel),
        eq(conversations.externalId, identity.externalId),
      ),
    });

  const existing = await find();
  if (existing) return existing;

  const [created] = await db
    .insert(conversations)
    .values({
      tenantId: identity.tenantId,
      channel: identity.channel,
      externalId: identity.externalId,
      customerName: identity.customerName ?? null,
      status: "bot",
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const raced = await find();
  if (!raced) throw new Error("conversation vanishing on insert");
  return raced;
}

export async function appendMessage(
  db: Database,
  conversationId: string,
  role: "user" | "assistant" | "staff" | "system",
  content: string,
): Promise<MessageRow> {
  const [row] = await db
    .insert(messages)
    .values({ conversationId, role, content })
    .returning();

  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, conversationId));

  if (!row) throw new Error("message insert returned nothing");
  return row;
}

/** The last `limit` messages, oldest first — the order a model expects. */
export async function recentMessages(
  db: Database,
  conversationId: string,
  limit = 20,
): Promise<MessageRow[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return rows.reverse();
}

/**
 * Role mapping for the model: staff and system turns are not part of the
 * assistant's own history, but staff replies matter for context, so they are
 * surfaced to the model as assistant messages.
 */
export function toModelHistory(rows: MessageRow[]): Array<{
  role: "user" | "assistant";
  content: string;
}> {
  return rows
    .filter((r) => r.role === "user" || r.role === "assistant" || r.role === "staff")
    .map((r) => ({
      role: r.role === "user" ? ("user" as const) : ("assistant" as const),
      content: r.role === "staff" ? `(staff) ${r.content}` : r.content,
    }));
}

export async function setConversationStatus(
  db: Database,
  conversationId: string,
  status: "bot" | "needs_human" | "human" | "closed",
): Promise<void> {
  await db.update(conversations).set({ status }).where(eq(conversations.id, conversationId));
}

export async function listConversations(
  db: Database,
  tenantId: string,
  limit = 50,
): Promise<ConversationRow[]> {
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.tenantId, tenantId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit);
}

export async function getConversation(
  db: Database,
  conversationId: string,
): Promise<ConversationRow | null> {
  const row = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });
  return row ?? null;
}

export async function messageThread(
  db: Database,
  conversationId: string,
  limit = 100,
): Promise<MessageRow[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .limit(limit);
}
