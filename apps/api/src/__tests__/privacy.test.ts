import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Channel } from "@booking/channels";
import {
  applyErase,
  countRows,
  execRaw,
  getTenantBySlug,
  listActiveTenants,
  messageThread,
  planErase,
  purgeTenantMessages,
  queryRaw,
  retentionDays,
} from "@booking/db";

import { runRetention } from "../retention";
import { runTurn } from "../pipeline";
import { FADE, GLOW, book, firstSlot, postJson, setup, type Harness } from "./harness";

/**
 * The privacy promises, made executable.
 *
 * Two operations that people conflate:
 *  - retention: transcripts expire, bookings do not;
 *  - erasure: a person disappears, their bookings keep the money facts.
 *
 * The tests below are the ones a client's lawyer would ask for.
 */

let h: Harness;
let glowId: string;

beforeAll(async () => {
  h = await setup();
  glowId = (await getTenantBySlug(h.db, GLOW))!.id;
}, 120_000);

afterAll(async () => {
  await h?.close();
});

const silent: Channel = { name: "widget", send: async () => {} };

async function conversationWithMessages(slug: string, externalId: string) {
  const turn = await runTurn({
    db: h.db,
    tenantSlug: slug,
    channel: silent,
    externalId,
    text: "Hello, I would like a booking.",
    agentRunner: (async () => ({ text: "Sure.", escalated: false })) as never,
  });

  return turn!.conversationId;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

interface BookingRow {
  customer_name: string;
  customer_phone: string | null;
  price_minor_at_booking: number;
  starts_at: string;
  service_name_at_booking: string;
}

describe("retention", () => {
  it("deletes old messages for one tenant and leaves the other alone", async () => {
    const glowConversation = await conversationWithMessages(
      GLOW,
      `retention-glow-${Date.now()}`,
    );
    const fadeConversation = await conversationWithMessages(
      FADE,
      `retention-fade-${Date.now()}`,
    );

    const [oldGlow] = await messageThread(h.db, glowConversation);
    const [oldFade] = await messageThread(h.db, fadeConversation);

    await execRaw(
      h.db,
      `update messages set created_at = now() - interval '120 days' where id = '${oldGlow!.id}'`,
    );
    await execRaw(
      h.db,
      `update messages set created_at = now() - interval '120 days' where id = '${oldFade!.id}'`,
    );

    const deleted = await purgeTenantMessages(h.db, glowId, daysAgo(90));
    expect(deleted).toBe(1);

    const glowLeft = await messageThread(h.db, glowConversation);
    expect(glowLeft.map((row) => row.id)).not.toContain(oldGlow!.id);

    // Fade's identical old message is untouched: windows are per tenant.
    const fadeLeft = await messageThread(h.db, fadeConversation);
    expect(fadeLeft.map((row) => row.id)).toContain(oldFade!.id);
  });

  it("keeps recent messages", async () => {
    const conversationId = await conversationWithMessages(GLOW, `retention-fresh-${Date.now()}`);
    const before = await messageThread(h.db, conversationId);

    await purgeTenantMessages(h.db, glowId, daysAgo(90));

    expect((await messageThread(h.db, conversationId)).length).toBe(before.length);
  });

  it("never deletes a booking", async () => {
    const slot = await firstSlot(h.app, GLOW, "Trim");
    await book(h.app, GLOW, slot, "Retention Customer");

    const before = await countRows(h.db, "bookings");
    await purgeTenantMessages(h.db, glowId, daysAgo(0));

    // A cutoff of "now" removes every message; bookings are a different promise.
    expect(await countRows(h.db, "bookings")).toBe(before);
  });

  it("defaults to 90 days when the tenant has said nothing", () => {
    expect(retentionDays({})).toBe(90);
    expect(retentionDays({ privacy: { retentionDays: 30 } })).toBe(30);
    expect(retentionDays({ privacy: { retentionDays: 0 } })).toBe(90);
  });

  it("gives each business its own window", async () => {
    // Glow agrees to 30 days; Fade stays on the 90-day default.
    await execRaw(
      h.db,
      `update tenants set settings = jsonb_set(settings, '{privacy}', '{"retentionDays":30}'::jsonb) where id = '${glowId}'`,
    );

    const glowConversation = await conversationWithMessages(GLOW, `window-glow-${Date.now()}`);
    const fadeConversation = await conversationWithMessages(FADE, `window-fade-${Date.now()}`);

    await execRaw(
      h.db,
      `update messages set created_at = now() - interval '45 days'
       where conversation_id in ('${glowConversation}', '${fadeConversation}')`,
    );

    const tenants = await listActiveTenants(h.db);
    const results = await runRetention(h.db, tenants);

    // The windows are resolved per tenant, not from one global cutoff.
    expect(results.find((row) => row.slug === GLOW)!.days).toBe(30);
    expect(results.find((row) => row.slug === FADE)!.days).toBe(90);

    // 45 days old: past Glow's 30, still inside Fade's 90.
    expect(await messageThread(h.db, glowConversation)).toHaveLength(0);
    expect((await messageThread(h.db, fadeConversation)).length).toBeGreaterThan(0);
  });
});

describe("erasure", () => {
  const phone = "254712345678";

  async function makeCustomer(name: string, customerPhone: string) {
    const slot = await firstSlot(h.app, GLOW, "Trim");
    const response = await postJson(h.app, `/api/tenants/${GLOW}/bookings`, {
      serviceId: slot.serviceId,
      resourceId: slot.resourceId,
      startsAt: slot.startsAt,
      customerName: name,
      customerPhone,
    });

    expect(response.status).toBe(201);

    // A WhatsApp thread, where the phone number is the identity.
    const conversationId = await conversationWithMessages(GLOW, customerPhone);
    await execRaw(
      h.db,
      `update conversations set customer_name = '${name}', customer_phone = '${customerPhone}' where id = '${conversationId}'`,
    );

    return { bookingId: response.body.booking.id as string, conversationId };
  }

  it("is a dry run: planning changes nothing", async () => {
    const { bookingId, conversationId } = await makeCustomer("Dry Run", phone);

    const plan = await planErase(h.db, glowId, { phone });
    expect(plan.conversations.length).toBeGreaterThan(0);
    expect(plan.bookings.length).toBeGreaterThan(0);

    const [row] = await queryRaw<BookingRow>(
      h.db,
      `select customer_name, customer_phone, price_minor_at_booking, starts_at, service_name_at_booking
       from bookings where id = '${bookingId}'`,
    );

    expect(row!.customer_name).toBe("Dry Run");
    expect(row!.customer_phone).toBe(phone);
    expect((await messageThread(h.db, conversationId)).length).toBeGreaterThan(0);
  });

  it("removes the person and keeps the money facts", async () => {
    const { bookingId, conversationId } = await makeCustomer("Erase Me", phone);

    const [before] = await queryRaw<BookingRow>(
      h.db,
      `select customer_name, customer_phone, price_minor_at_booking, starts_at, service_name_at_booking
       from bookings where id = '${bookingId}'`,
    );

    const plan = await planErase(h.db, glowId, { phone });
    const applied = await applyErase(h.db, plan);

    expect(applied.bookings).toBeGreaterThan(0);
    expect(applied.messages).toBeGreaterThan(0);

    const [after] = await queryRaw<BookingRow>(
      h.db,
      `select customer_name, customer_phone, price_minor_at_booking, starts_at, service_name_at_booking
       from bookings where id = '${bookingId}'`,
    );

    expect(after!.customer_name).toBe("Deleted customer");
    expect(after!.customer_phone).toBeNull();

    // The business facts are exactly what they were.
    expect(after!.price_minor_at_booking).toBe(before!.price_minor_at_booking);
    expect(after!.service_name_at_booking).toBe(before!.service_name_at_booking);
    expect(new Date(after!.starts_at).toISOString()).toBe(
      new Date(before!.starts_at).toISOString(),
    );

    const [conversation] = await queryRaw<{
      customer_name: string | null;
      customer_phone: string | null;
      external_id: string;
    }>(
      h.db,
      `select customer_name, customer_phone, external_id from conversations where id = '${conversationId}'`,
    );

    expect(conversation!.customer_name).toBeNull();
    expect(conversation!.customer_phone).toBeNull();
    expect(conversation!.external_id.startsWith("erased-")).toBe(true);

    expect(await messageThread(h.db, conversationId)).toHaveLength(0);
  });

  it("leaves a different customer untouched", async () => {
    const other = "254799999999";
    const { bookingId } = await makeCustomer("Innocent Bystander", other);

    const plan = await planErase(h.db, glowId, { phone });
    await applyErase(h.db, plan);

    const [row] = await queryRaw<BookingRow>(
      h.db,
      `select customer_name, customer_phone, price_minor_at_booking, starts_at, service_name_at_booking
       from bookings where id = '${bookingId}'`,
    );

    expect(row!.customer_name).toBe("Innocent Bystander");
  });

  it("matches a chat id as well as a phone number", async () => {
    const externalId = `widget-erase-${Date.now()}`;
    const conversationId = await conversationWithMessages(GLOW, externalId);

    const plan = await planErase(h.db, glowId, { externalId });
    expect(plan.conversations.map((row) => row.id)).toContain(conversationId);

    await applyErase(h.db, plan);
    expect(await messageThread(h.db, conversationId)).toHaveLength(0);
  });

  it("refuses a target with neither a phone nor a chat id", async () => {
    await expect(planErase(h.db, glowId, {})).rejects.toThrow(/phone or an externalId/);
  });
});
