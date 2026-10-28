import type { BusinessType, LocalDate } from "@booking/shared";

/** The agent knows nothing about Postgres. It talks to a port. */

export interface TenantBrief {
  name: string;
  businessType: BusinessType;
  timezone: string;
  currency: string;
  facts: Record<string, string>;
}

export interface ServiceBrief {
  id: string;
  name: string;
  durationMinutes: number;
  /** Minor units: 250000 = KES 2,500. */
  priceMinor: number;
}

export interface StaffBrief {
  id: string;
  name: string;
  capacity: number;
}

export interface OfferedSlot {
  resourceId: string;
  resourceName: string;
  startsAt: Date;
  endsAt: Date;
}

export interface BookingBrief {
  id: string;
  serviceName: string;
  resourceName: string;
  startsAt: Date;
}

export type SlotsResult =
  | { ok: true; slots: OfferedSlot[] }
  | { ok: false; message: string };

export type BookingAttempt =
  | { ok: true; id: string; startsAt: Date }
  | { ok: false; message: string };

export interface AgentPort {
  tenant: TenantBrief;
  services: ServiceBrief[];
  staff: StaffBrief[];
  /** "Now" in the caller's clock — injected so the agent is testable. */
  now: Date;
  /** The live booking this chat already owns, if any. */
  existingBooking?: BookingBrief | null;
  findSlots(input: {
    service: string;
    date: LocalDate;
    partySize?: number;
  }): Promise<SlotsResult>;
  createBooking(input: {
    service: string;
    resourceId: string;
    startsAt: Date;
    customerName: string;
    customerPhone?: string | null;
  }): Promise<BookingAttempt>;
  /** Cancel a booking this conversation owns. */
  cancelBooking(input: { bookingId: string; reason?: string | null }): Promise<BookingAttempt>;
  /** Move a booking this conversation owns. Same anti-invention rules as create. */
  rescheduleBooking(input: {
    bookingId: string;
    startsAt: Date;
    reason?: string | null;
  }): Promise<BookingAttempt>;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentResult {
  text: string;
  escalated: boolean;
  bookingId: string | null;
  /** Tool calls made, for logs and for proving the model used the engine. */
  toolCalls: string[];
}
