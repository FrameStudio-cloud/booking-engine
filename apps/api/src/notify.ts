import { createTelegramChannel } from "@booking/channels";
import type { TenantRow } from "@booking/db";
import { config } from "./env";

/**
 * Owner notifications.
 *
 * A salon owner checks Telegram, not a web app — so the engine talks to them on
 * the channel they already use. Delivery is best-effort: a failed ping must
 * never fail the booking that caused it.
 */

const channel = config.telegram.token ? createTelegramChannel(config.telegram.token) : null;

export interface BookingNotice {
  customerName: string;
  serviceName: string;
  resourceName: string;
  startsAt: Date;
  source: string;
}

export interface DigestRow {
  customerName: string;
  serviceName: string;
  resourceName: string;
  startsAt: Date;
}

function chatIdFor(tenant: TenantRow): string | null {
  return tenant.settings?.notify?.telegramChatId?.trim() || null;
}

function clock(tenant: TenantRow, date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tenant.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function day(tenant: TenantRow, date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tenant.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

async function send(tenant: TenantRow, text: string): Promise<boolean> {
  const chatId = chatIdFor(tenant);
  if (!chatId) return false;

  if (!channel) {
    console.warn(`[notify] ${tenant.slug} has a chat id but no Telegram token`);
    return false;
  }

  try {
    await channel.send(chatId, { text, quickReplies: [] });
    return true;
  } catch (error) {
    console.error(`[notify] ${tenant.slug} send failed`, error);
    return false;
  }
}

export async function notifyNewBooking(
  tenant: TenantRow,
  notice: BookingNotice,
): Promise<boolean> {
  return send(
    tenant,
    [
      `New booking — ${notice.customerName}`,
      `${notice.serviceName} with ${notice.resourceName}`,
      `${day(tenant, notice.startsAt)} at ${clock(tenant, notice.startsAt)}`,
      `via ${notice.source}`,
    ].join("\n"),
  );
}

/** The 07:00 message that replaces "open the dashboard and look". */
export async function sendDailyDigest(
  tenant: TenantRow,
  label: string,
  rows: DigestRow[],
): Promise<boolean> {
  if (rows.length === 0) {
    return send(tenant, `Today — ${label}\nNo bookings yet.`);
  }

  const lines = [...rows]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map(
      (row) =>
        `${clock(tenant, row.startsAt)}  ${row.customerName} — ${row.serviceName} with ${row.resourceName}`,
    );

  return send(
    tenant,
    [
      `Today — ${label}`,
      `${rows.length} booking${rows.length === 1 ? "" : "s"}`,
      "",
      ...lines,
    ].join("\n"),
  );
}

export function ownerConfigured(tenant: TenantRow): boolean {
  return Boolean(chatIdFor(tenant) && channel);
}
