import { and, asc, desc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import type { Database } from "./client";
import {
  bookings,
  conversations,
  messages,
  resources,
  services,
  type ConversationRow,
  type MessageRow,
} from "./schema";

/**
 * Read models for the dashboard.
 *
 * These are deliberately shaped for the UI, not the database: one call renders
 * one screen, names are joined in, and nothing needs a second round trip.
 */

export interface BookingListItem {
  id: string;
  serviceId: string;
  serviceName: string;
  priceMinor: number;
  resourceId: string;
  resourceName: string;
  startsAt: Date;
  endsAt: Date;
  status: "pending" | "confirmed" | "cancelled" | "no_show";
  customerName: string;
  customerPhone: string | null;
  source: string;
}

export async function listBookings(
  db: Database,
  tenantId: string,
  range: { from: Date; to: Date; limit?: number },
): Promise<BookingListItem[]> {
  return db
    .select({
      id: bookings.id,
      serviceId: bookings.serviceId,
      serviceName: services.name,
      priceMinor: services.priceMinor,
      resourceId: bookings.resourceId,
      resourceName: resources.name,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      status: bookings.status,
      customerName: bookings.customerName,
      customerPhone: bookings.customerPhone,
      source: bookings.source,
    })
    .from(bookings)
    .innerJoin(services, eq(services.id, bookings.serviceId))
    .innerJoin(resources, eq(resources.id, bookings.resourceId))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        gte(bookings.startsAt, range.from),
        lt(bookings.startsAt, range.to),
      ),
    )
    .orderBy(asc(bookings.startsAt))
    .limit(range.limit ?? 200);
}

export interface ConversationSummary {
  id: string;
  customerName: string | null;
  channel: "telegram" | "widget" | "whatsapp";
  status: "bot" | "needs_human" | "human" | "closed";
  /** True when the customer spoke last and no human has taken over. */
  unread: boolean;
  lastMessage: { role: MessageRow["role"]; text: string; at: Date } | null;
  updatedAt: Date;
}

export async function conversationSummaries(
  db: Database,
  tenantId: string,
  limit = 50,
): Promise<ConversationSummary[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.tenantId, tenantId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const thread = await db
    .select()
    .from(messages)
    .where(
      inArray(
        messages.conversationId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(desc(messages.createdAt));

  const latest = new Map<string, MessageRow>();
  for (const message of thread) {
    if (!latest.has(message.conversationId)) latest.set(message.conversationId, message);
  }

  return rows.map((row) => {
    const last = latest.get(row.id) ?? null;

    return {
      id: row.id,
      customerName: row.customerName,
      channel: row.channel,
      status: row.status,
      unread: last?.role === "user" && row.status !== "human" && row.status !== "closed",
      lastMessage: last ? { role: last.role, text: last.content, at: last.createdAt } : null,
      updatedAt: row.lastMessageAt,
    };
  });
}

/** The live booking a chat already owns, if any. Used to stop re-booking. */
export async function findBookingForConversation(
  db: Database,
  conversationId: string,
): Promise<BookingListItem | null> {
  const [row] = await db
    .select({
      id: bookings.id,
      serviceId: bookings.serviceId,
      serviceName: services.name,
      priceMinor: services.priceMinor,
      resourceId: bookings.resourceId,
      resourceName: resources.name,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      status: bookings.status,
      customerName: bookings.customerName,
      customerPhone: bookings.customerPhone,
      source: bookings.source,
    })
    .from(bookings)
    .innerJoin(services, eq(services.id, bookings.serviceId))
    .innerJoin(resources, eq(resources.id, bookings.resourceId))
    .where(and(eq(bookings.conversationId, conversationId), ne(bookings.status, "cancelled")))
    .limit(1);

  return row ?? null;
}

export async function getConversationById(
  db: Database,
  tenantId: string,
  conversationId: string,
): Promise<ConversationRow | null> {
  const row = await db.query.conversations.findFirst({
    where: and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)),
  });

  return row ?? null;
}
