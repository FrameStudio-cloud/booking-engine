import { and, asc, desc, eq, isNull, lt, ne } from "drizzle-orm";
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
  author?: string | null,
): Promise<MessageRow> {
  const [row] = await db
    .insert(messages)
    .values({ conversationId, role, content, author: author ?? null })
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

/**
 * Close threads nobody has touched for a while.
 *
 * A closed thread stays readable and still stores new messages; the bot just
 * stops answering into it. Quiet, not deleted.
 */
export async function closeIdleConversations(
  db: Database,
  before: Date,
): Promise<number> {
  const rows = await db
    .update(conversations)
    .set({ status: "closed" })
    .where(
      and(ne(conversations.status, "closed"), lt(conversations.lastMessageAt, before)),
    )
    .returning({ id: conversations.id });

  return rows.length;
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

/**
 * Fill in a display name once we learn it (usually from the booking form in
 * chat). Never overwrites a name the channel already gave us.
 */
export async function nameConversation(
  db: Database,
  conversationId: string,
  customerName: string,
): Promise<void> {
  await db
    .update(conversations)
    .set({ customerName })
    .where(and(eq(conversations.id, conversationId), isNull(conversations.customerName)));
}

export async function getConversationByExternalId(
  db: Database,
  identity: {
    tenantId: string;
    channel: "telegram" | "widget" | "whatsapp";
    externalId: string;
  },
): Promise<ConversationRow | null> {
  const row = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.tenantId, identity.tenantId),
      eq(conversations.channel, identity.channel),
      eq(conversations.externalId, identity.externalId),
    ),
  });

  return row ?? null;
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

/**
 * "A human has seen everything up to now."
 *
 * Called when staff open a thread and when they reply. Unread is everything the
 * customer said after this instant, so it survives the status changing to
 * `human` and back.
 */
export async function markConversationRead(
  db: Database,
  conversationId: string,
  at: Date = new Date(),
): Promise<void> {
  await db
    .update(conversations)
    .set({ staffReadAt: at })
    .where(eq(conversations.id, conversationId));
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
