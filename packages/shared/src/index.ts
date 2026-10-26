import { z } from "zod";

/**
 * A business type is a preset, never a codebase.
 * Adding one here + a strategy in @booking/core is the whole job.
 */
export const businessTypeSchema = z.enum(["salon", "bnb", "restaurant"]);
export type BusinessType = z.infer<typeof businessTypeSchema>;

/**
 * What a "slot" is booked against.
 * salon -> staff, bnb -> unit, restaurant -> table
 */
export const resourceKindSchema = z.enum(["staff", "unit", "table"]);
export type ResourceKind = z.infer<typeof resourceKindSchema>;

export const channelSchema = z.enum(["telegram", "widget", "whatsapp"]);
export type Channel = z.infer<typeof channelSchema>;

export const bookingStatusSchema = z.enum([
  "pending",
  "confirmed",
  "cancelled",
  "no_show",
]);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

/**
 * bot      - the agent is answering
 * needs_human - escalated, waiting for staff
 * human    - staff has taken over, agent is muted
 */
export const conversationStatusSchema = z.enum([
  "bot",
  "needs_human",
  "human",
  "closed",
]);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

/** "HH:MM" in the tenant's local timezone. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");
export type TimeOfDay = z.infer<typeof timeOfDaySchema>;

/** 0 = Sunday ... 6 = Saturday */
export const weekdaySchema = z.number().int().min(0).max(6);
export type Weekday = z.infer<typeof weekdaySchema>;

/** "YYYY-MM-DD" in the tenant's local timezone. */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export type LocalDate = z.infer<typeof localDateSchema>;

export const tenantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  businessType: businessTypeSchema,
  timezone: z.string().default("Africa/Nairobi"),
  /** Currency for display only; no payment handling in v1. */
  currency: z.string().default("KES"),
  /** Free-form facts the agent may quote (address, parking, policies). */
  facts: z.record(z.string(), z.string()).default({}),
});
export type Tenant = z.infer<typeof tenantSchema>;

export const serviceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  /** Salon: appointment length. Restaurant: dining time. BnB: unused. */
  durationMinutes: z.number().int().positive(),
  /** How many bookings may overlap on one resource. Usually 1. */
  capacity: z.number().int().positive().default(1),
  /** Buffer enforced before a start time (cleanup, turn-over). */
  bufferBeforeMinutes: z.number().int().nonnegative().default(0),
  priceMinor: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true),
});
export type Service = z.infer<typeof serviceSchema>;

export const resourceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  kind: resourceKindSchema,
  name: z.string(),
  /** Salon: "Grace (braids)". BnB: sleeps 2. Restaurant: seats 4. */
  capacity: z.number().int().positive().default(1),
  active: z.boolean().default(true),
});
export type Resource = z.infer<typeof resourceSchema>;

/**
 * Weekly hours. `resourceId` null = applies to the whole business,
 * otherwise it overrides/extends that resource only.
 */
export const availabilityRuleSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  resourceId: z.string().nullable(),
  weekday: weekdaySchema,
  opensAt: timeOfDaySchema,
  closesAt: timeOfDaySchema,
});
export type AvailabilityRule = z.infer<typeof availabilityRuleSchema>;

/** Holiday / one-off change. Closed all day when opensAt is null. */
export const availabilityExceptionSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  resourceId: z.string().nullable(),
  date: localDateSchema,
  opensAt: timeOfDaySchema.nullable(),
  closesAt: timeOfDaySchema.nullable(),
  note: z.string().nullable().default(null),
});
export type AvailabilityException = z.infer<typeof availabilityExceptionSchema>;

export const bookingSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  serviceId: z.string(),
  resourceId: z.string(),
  /** UTC instants. Rendered in tenant timezone. */
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  status: bookingStatusSchema,
  customerName: z.string(),
  customerPhone: z.string().nullable().default(null),
  /** Where this booking came from: telegram, widget, whatsapp, dashboard. */
  source: z.string().default("dashboard"),
  notes: z.string().nullable().default(null),
});
export type Booking = z.infer<typeof bookingSchema>;

export const conversationSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  channel: channelSchema,
  /** Telegram chat id, widget session id, WhatsApp wa_id. */
  externalId: z.string(),
  status: conversationStatusSchema,
  customerName: z.string().nullable().default(null),
  customerPhone: z.string().nullable().default(null),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const messageRoleSchema = z.enum(["user", "assistant", "staff", "system"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  createdAt: z.coerce.date(),
});
export type Message = z.infer<typeof messageSchema>;

/** A concrete bookable window returned by an AvailabilityStrategy. */
export const slotSchema = z.object({
  resourceId: z.string(),
  resourceName: z.string(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  /** BnB: number of nights. Salon: unused. */
  units: z.number().int().positive().default(1),
});
export type Slot = z.infer<typeof slotSchema>;

/** Normalized message, identical shape on every channel. */
export const inboundMessageSchema = z.object({
  channel: channelSchema,
  externalId: z.string(),
  tenantId: z.string(),
  text: z.string(),
  customerName: z.string().nullable().default(null),
  customerPhone: z.string().nullable().default(null),
  receivedAt: z.coerce.date().default(() => new Date()),
});
export type InboundMessage = z.infer<typeof inboundMessageSchema>;

export const outboundMessageSchema = z.object({
  text: z.string(),
  /** Optional structured extras a channel may ignore. */
  quickReplies: z.array(z.string()).default([]),
});
export type OutboundMessage = z.infer<typeof outboundMessageSchema>;

// ---------------------------------------------------------------------------
// Tenant config — the file a new business starts from.
//
// One JSON file per business: who they are, what they sell, who works, when
// they open. `pnpm tenant:new presets/glow-salon.json` turns it into rows.
// ---------------------------------------------------------------------------

export const openingHoursSchema = z.object({
  weekday: weekdaySchema,
  opensAt: timeOfDaySchema,
  closesAt: timeOfDaySchema,
});
export type OpeningHours = z.infer<typeof openingHoursSchema>;

export const tenantConfigServiceSchema = z.object({
  name: z.string().min(1).max(80),
  durationMinutes: z.number().int().positive().max(24 * 60),
  capacity: z.number().int().positive().default(1),
  bufferBeforeMinutes: z.number().int().nonnegative().default(0),
  priceMinor: z.number().int().nonnegative().default(0),
});
export type TenantConfigService = z.infer<typeof tenantConfigServiceSchema>;

export const tenantConfigResourceSchema = z.object({
  kind: resourceKindSchema,
  name: z.string().min(1).max(80),
  capacity: z.number().int().positive().default(1),
});
export type TenantConfigResource = z.infer<typeof tenantConfigResourceSchema>;

export const tenantConfigSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, "lowercase letters, digits and dashes"),
  name: z.string().min(2).max(80),
  businessType: businessTypeSchema,
  timezone: z.string().default("Africa/Nairobi"),
  currency: z.string().min(1).max(8).default("KES"),

  /** What the widget wears. Values land in `tenants.settings`, not the prompt. */
  brand: z
    .object({
      accent: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, "hex colour like #a4502a")
        .default("#111111"),
      position: z.enum(["left", "right"]).default("right"),
    })
    .default({ accent: "#111111", position: "right" }),

  widget: z
    .object({
      greeting: z
        .string()
        .min(1)
        .max(200)
        .default("Hi — I can check what's free and hold a spot for you. What are you after?"),
      replyTime: z.string().min(1).max(60).default("Usually replies instantly"),
    })
    .default({
      greeting: "Hi — I can check what's free and hold a spot for you. What are you after?",
      replyTime: "Usually replies instantly",
    }),

  /** Facts the agent may quote: address, parking, payment, policies. */
  facts: z.record(z.string(), z.string()).default({}),

  services: z.array(tenantConfigServiceSchema).min(1),
  resources: z.array(tenantConfigResourceSchema).min(1),
  hours: z.array(openingHoursSchema).min(1),

  /** Optional pre-existing booking, so a fresh demo has something to work around. */
  demoBooking: z
    .object({
      service: z.string(),
      resource: z.string(),
      dayOffset: z.number().int().min(0).max(30).default(1),
      startsAt: timeOfDaySchema,
      customerName: z.string().min(1),
      source: z.enum(["telegram", "widget", "whatsapp"]).default("telegram"),
    })
    .optional(),
});
export type TenantConfig = z.infer<typeof tenantConfigSchema>;
