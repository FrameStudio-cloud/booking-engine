import { and, eq, inArray, lt } from "drizzle-orm";

import type { Database } from "./client";
import { bookings, conversations, messages } from "./schema";

/**
 * The promises in AGENTS.md §9, made executable.
 *
 * Two different operations, often confused:
 *
 *  - **Retention** (scheduled): transcripts older than the tenant's window are
 *    deleted. Bookings, services and price snapshots are untouched — that is
 *    what makes the cleanup safe.
 *  - **Erasure** (on request): one customer's identity and transcript are
 *    removed while their bookings keep the business facts (service, time,
 *    price) so the calendar and revenue still add up.
 *
 * Neither one logs message content. Counts only.
 */

export interface RetentionReport {
  tenantId: string;
  slug: string;
  deleted: number;
}

/**
 * Delete this tenant's messages older than `before`.
 *
 * Scoped per tenant because the window is per tenant: a business that agreed to
 * 30 days must not be cleaned on someone else's 90. The booking rows, and the
 * price snapshot inside them, are not touched — that is what makes the cleanup
 * safe to run unattended.
 */
export async function purgeTenantMessages(
  db: Database,
  tenantId: string,
  before: Date,
): Promise<number> {
  const deleted = await db
    .delete(messages)
    .where(
      and(
        lt(messages.createdAt, before),
        inArray(
          messages.conversationId,
          db
            .select({ id: conversations.id })
            .from(conversations)
            .where(eq(conversations.tenantId, tenantId)),
        ),
      ),
    )
    .returning({ id: messages.id });

  return deleted.length;
}

/** The tenant's own window, in days. 90 when nobody has said otherwise. */
export function retentionDays(settings: {
  privacy?: { retentionDays?: number };
}): number {
  const days = settings.privacy?.retentionDays;
  return Number.isInteger(days) && days! > 0 ? days! : 90;
}

export interface EraseTarget {
  /** Any format; digits are compared, last 9 of them. */
  phone?: string;
  /** Telegram chat id, WhatsApp wa_id or widget session id. */
  externalId?: string;
}

export interface ErasePlan {
  conversations: Array<{ id: string; channel: string; externalId: string }>;
  bookings: Array<{ id: string; serviceName: string; startsAt: Date }>;
  messages: number;
}

function digits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Last 9 digits: survives +254, 254, 07… and spaces. Short numbers are exact. */
function phoneKey(value: string | null | undefined): string | null {
  const only = digits(value);
  if (only.length === 0) return null;
  return only.length > 9 ? only.slice(-9) : only;
}

/**
 * What would be erased. Read-only, and deliberately a separate function so the
 * CLI can print a dry run without a transaction.
 *
 * Matching is done in JS on the tenant's own rows. That is fine for a manual,
 * per-request command and would not be fine on a hot path.
 */
export async function planErase(
  db: Database,
  tenantId: string,
  target: EraseTarget,
): Promise<ErasePlan> {
  const wantedPhone = phoneKey(target.phone);
  const wantedExternal = target.externalId ?? null;

  if (!wantedPhone && !wantedExternal) {
    throw new Error("planErase needs a phone or an externalId");
  }

  const conversationRows = await db
    .select({
      id: conversations.id,
      channel: conversations.channel,
      externalId: conversations.externalId,
      customerPhone: conversations.customerPhone,
    })
    .from(conversations)
    .where(eq(conversations.tenantId, tenantId));

  const matchedConversations = conversationRows.filter((row) => {
    if (wantedExternal && row.externalId === wantedExternal) return true;
    if (wantedPhone && phoneKey(row.customerPhone) === wantedPhone) return true;
    // WhatsApp uses the phone number as the external id.
    if (wantedPhone && phoneKey(row.externalId) === wantedPhone) return true;
    return false;
  });

  const bookingRows = await db
    .select({
      id: bookings.id,
      customerPhone: bookings.customerPhone,
      serviceName: bookings.serviceNameAtBooking,
      startsAt: bookings.startsAt,
    })
    .from(bookings)
    .where(eq(bookings.tenantId, tenantId));

  const matchedBookings = bookingRows.filter(
    (row) => wantedPhone && phoneKey(row.customerPhone) === wantedPhone,
  );

  const messageCount =
    matchedConversations.length === 0
      ? 0
      : (
          await db
            .select({ id: messages.id })
            .from(messages)
            .where(
              inArray(
                messages.conversationId,
                matchedConversations.map((row) => row.id),
              ),
            )
        ).length;

  return {
    conversations: matchedConversations.map((row) => ({
      id: row.id,
      channel: row.channel,
      externalId: row.externalId,
    })),
    bookings: matchedBookings.map((row) => ({
      id: row.id,
      serviceName: row.serviceName,
      startsAt: row.startsAt,
    })),
    messages: messageCount,
  };
}

/**
 * Apply an erase plan.
 *
 * A conversation's `externalId` is the customer's identity, so it is replaced
 * with a random one rather than nulled: the unique index stays honest and the
 * channel cannot re-attach a new message to the erased thread. The row itself
 * survives, because `bookings.conversationId` points at it.
 */
export async function applyErase(
  db: Database,
  plan: ErasePlan,
): Promise<{ conversations: number; bookings: number; messages: number }> {
  return db.transaction(async (tx) => {
    let deletedMessages = 0;

    if (plan.conversations.length > 0) {
      const ids = plan.conversations.map((row) => row.id);

      const deleted = await tx
        .delete(messages)
        .where(inArray(messages.conversationId, ids))
        .returning({ id: messages.id });

      deletedMessages = deleted.length;

      for (const row of plan.conversations) {
        await tx
          .update(conversations)
          .set({
            customerName: null,
            customerPhone: null,
            externalId: `erased-${row.id}`,
            status: "closed",
          })
          .where(eq(conversations.id, row.id));
      }
    }

    if (plan.bookings.length > 0) {
      await tx
        .update(bookings)
        .set({ customerName: "Deleted customer", customerPhone: null, notes: null })
        .where(
          inArray(
            bookings.id,
            plan.bookings.map((row) => row.id),
          ),
        );
    }

    return {
      conversations: plan.conversations.length,
      bookings: plan.bookings.length,
      messages: deletedMessages,
    };
  });
}
