import { and, eq } from "drizzle-orm";

import type { Database } from "./client";
import { tenantChannels, tenants } from "./schema";

export type TenantChannelName = "telegram" | "whatsapp" | "widget";

export interface TenantChannelWithSlug {
  tenantId: string;
  slug: string;
  channel: TenantChannelName;
  externalId: string | null;
  secretCiphertext: string;
}

/**
 * One credential row per tenant per channel. Upsert, never delete: a token
 * rotation should leave the same row behind so the history of "this tenant has
 * a Telegram channel" stays true.
 */
export async function upsertTenantChannel(
  db: Database,
  input: {
    tenantId: string;
    channel: TenantChannelName;
    externalId?: string | null;
    secretCiphertext: string;
  },
): Promise<void> {
  await db
    .insert(tenantChannels)
    .values({
      tenantId: input.tenantId,
      channel: input.channel,
      externalId: input.externalId ?? null,
      secretCiphertext: input.secretCiphertext,
      active: true,
    })
    .onConflictDoUpdate({
      target: [tenantChannels.tenantId, tenantChannels.channel],
      set: {
        externalId: input.externalId ?? null,
        secretCiphertext: input.secretCiphertext,
        active: true,
        updatedAt: new Date(),
      },
    });
}

/** Stop listening on a channel without losing the row. */
export async function deactivateTenantChannel(
  db: Database,
  tenantId: string,
  channel: TenantChannelName,
): Promise<void> {
  await db
    .update(tenantChannels)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(tenantChannels.tenantId, tenantId), eq(tenantChannels.channel, channel)));
}

export async function getTenantChannel(
  db: Database,
  tenantId: string,
  channel: TenantChannelName,
): Promise<typeof tenantChannels.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(tenantChannels)
    .where(and(eq(tenantChannels.tenantId, tenantId), eq(tenantChannels.channel, channel)))
    .limit(1);

  return row ?? null;
}

/**
 * Every live channel, with the slug the bot needs to run a turn.
 *
 * Inactive tenants and inactive channels are excluded here rather than at the
 * call site, so "stop paying us" and "turn the bot off" are both one flag.
 */
export async function listActiveTenantChannels(
  db: Database,
): Promise<TenantChannelWithSlug[]> {
  const rows = await db
    .select({
      tenantId: tenantChannels.tenantId,
      slug: tenants.slug,
      channel: tenantChannels.channel,
      externalId: tenantChannels.externalId,
      secretCiphertext: tenantChannels.secretCiphertext,
    })
    .from(tenantChannels)
    .innerJoin(tenants, eq(tenants.id, tenantChannels.tenantId))
    .where(and(eq(tenantChannels.active, true), eq(tenants.active, true)));

  return rows;
}
