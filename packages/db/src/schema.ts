import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const businessTypeEnum = pgEnum("business_type", [
  "salon",
  "bnb",
  "restaurant",
]);

export const resourceKindEnum = pgEnum("resource_kind", [
  "staff",
  "unit",
  "table",
]);

export const channelEnum = pgEnum("channel", ["telegram", "widget", "whatsapp"]);

export const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "cancelled",
  "no_show",
]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "bot",
  "needs_human",
  "human",
  "closed",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "staff",
  "system",
]);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 64 }).notNull(),
    name: text("name").notNull(),
    businessType: businessTypeEnum("business_type").notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull().default("Africa/Nairobi"),
    currency: varchar("currency", { length: 8 }).notNull().default("KES"),
    /** Facts the agent is allowed to quote: address, parking, policies. */
    facts: jsonb("facts")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /**
     * Machine settings — widget branding, channel handles. Deliberately kept
     * out of `facts` so the model never reads colours as business policy.
     */
    settings: jsonb("settings")
      .$type<{
        brand?: { accent?: string; position?: "left" | "right" };
        widget?: { greeting?: string; replyTime?: string };
        /** Where booking pings and the 07:00 digest go. */
        notify?: { telegramChatId?: string };
        /** Hosts allowed to read this tenant's public price list. Empty = any. */
        allowedOrigins?: string[];
        /**
         * What we promise the end customer. `retentionDays` bounds the chat
         * transcript; bookings and their snapshots are never purged.
         */
        privacy?: {
          retentionDays?: number;
          url?: string;
          notice?: string;
        };
      }>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** When the catalog replica was last written from its source. */
    catalogSyncedAt: timestamp("catalog_synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tenants_slug_idx").on(t.slug)],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    capacity: integer("capacity").notNull().default(1),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    /** Money in minor units, display only in v1. */
    priceMinor: integer("price_minor").notNull().default(0),
    /** Which catalog adapter wrote this row: preset, manual, remote. */
    source: varchar("source", { length: 16 }).notNull().default("preset"),
    /** Id in the source system, when the source has one. */
    externalId: text("external_id"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("services_tenant_idx").on(t.tenantId)],
);

/**
 * One table for staff, rooms/units and tables.
 * `kind` decides which strategy treats them as bookable.
 */
export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: resourceKindEnum("kind").notNull(),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull().default(1),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("resources_tenant_kind_idx").on(t.tenantId, t.kind)],
);

/** Weekly recurring hours. resourceId null = business-wide default. */
export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").references(() => resources.id, {
      onDelete: "cascade",
    }),
    weekday: integer("weekday").notNull(),
    opensAt: varchar("opens_at", { length: 5 }).notNull(),
    closesAt: varchar("closes_at", { length: 5 }).notNull(),
  },
  (t) => [index("availability_rules_tenant_idx").on(t.tenantId, t.weekday)],
);

/** Holidays, one-off closures, special hours. */
export const availabilityExceptions = pgTable(
  "availability_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").references(() => resources.id, {
      onDelete: "cascade",
    }),
    /** Local date in the tenant's timezone. */
    date: date("date").notNull(),
    opensAt: varchar("opens_at", { length: 5 }),
    closesAt: varchar("closes_at", { length: 5 }),
    note: text("note"),
  },
  (t) => [index("availability_exceptions_tenant_date_idx").on(t.tenantId, t.date)],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /**
     * What was agreed at the time of booking. Reads use these, never the
     * service row, so a later price or rename cannot rewrite history.
     */
    serviceNameAtBooking: text("service_name_at_booking").notNull(),
    durationMinutesAtBooking: integer("duration_minutes_at_booking").notNull(),
    priceMinorAtBooking: integer("price_minor_at_booking").notNull(),
    status: bookingStatusEnum("status").notNull().default("pending"),
    /** Who last changed the status, when, and why. */
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    statusChangedBy: varchar("status_changed_by", { length: 16 }),
    statusReason: text("status_reason"),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    source: varchar("source", { length: 32 }).notNull().default("dashboard"),
    /** Set when the booking came out of a chat — one live booking per thread. */
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The hot path: "what is already booked on this resource in this window?"
    index("bookings_resource_window_idx").on(t.resourceId, t.startsAt, t.endsAt),
    index("bookings_tenant_window_idx").on(t.tenantId, t.startsAt),
    index("bookings_conversation_idx").on(t.conversationId),
  ],
);

/**
 * Credentials for a channel that needs them. The widget needs none: its
 * session id is its identity. Telegram and WhatsApp each have a token and a
 * handle (bot username, phone-number id).
 *
 * One row per tenant per channel. The credential is sealed (§secrets.ts); no
 * API route ever returns this column.
 */
export const tenantChannels = pgTable(
  "tenant_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    /** Bot username, WhatsApp phone-number id — the source system's handle. */
    externalId: text("external_id"),
    /** AES-256-GCM, format `v1.iv.tag.ciphertext`. */
    secretCiphertext: text("secret_ciphertext").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tenant_channels_identity_idx").on(t.tenantId, t.channel)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    /** Telegram chat id, widget session id, WhatsApp wa_id. */
    externalId: text("external_id").notNull(),
    status: conversationStatusEnum("status").notNull().default("bot"),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    /**
     * When staff last opened or answered this thread. Unread is computed from
     * it, not from `status`: a customer can write again after a human replies,
     * and that message must still show as waiting.
     */
    staffReadAt: timestamp("staff_read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One live conversation per customer per channel per tenant.
    uniqueIndex("conversations_identity_idx").on(t.tenantId, t.channel, t.externalId),
    index("conversations_status_idx").on(t.tenantId, t.status),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    /**
     * Who wrote a staff message. A display name, not an account — there are no
     * accounts yet. Null for the bot and for the customer.
     */
    author: varchar("author", { length: 40 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export type TenantRow = typeof tenants.$inferSelect;
export type ServiceRow = typeof services.$inferSelect;
export type ResourceRow = typeof resources.$inferSelect;
export type AvailabilityRuleRow = typeof availabilityRules.$inferSelect;
export type AvailabilityExceptionRow = typeof availabilityExceptions.$inferSelect;
export type BookingRow = typeof bookings.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type TenantChannelRow = typeof tenantChannels.$inferSelect;
