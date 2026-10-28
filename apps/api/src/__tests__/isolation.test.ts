import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countRows, getConversationByExternalId } from "@booking/db";
import type { AgentPort } from "@booking/agent";
import { addDays, toLocalDate } from "@booking/core";
import type { Channel } from "@booking/channels";
import { runTurn } from "../pipeline";
import { FADE, GLOW, book, firstSlot, getJson, postJson, setup, type Harness } from "./harness";

/**
 * Two businesses on one database, one conversation boundary, one booking per
 * chat — and a thread that survives the process that created it.
 */

let h: Harness;

beforeAll(async () => {
  h = await setup();
}, 120_000);

afterAll(async () => {
  await h?.close();
});

function silentChannel(name: "widget" | "telegram" = "widget"): Channel {
  return { name, send: async () => {} };
}

describe("tenant isolation", () => {
  it("books the same wall clock at both businesses without touching each other", async () => {
    const glowSlot = await firstSlot(h.app, GLOW, "Trim");
    const fadeSlot = await firstSlot(h.app, FADE, "Skin fade");

    expect((await book(h.app, GLOW, glowSlot, "Glow Only")).status).toBe(201);
    expect((await book(h.app, FADE, fadeSlot, "Fade Only")).status).toBe(201);

    const glow = await getJson(h.app, `/api/tenants/${GLOW}/bookings?date=${glowSlot.date}`);
    const fade = await getJson(h.app, `/api/tenants/${FADE}/bookings?date=${fadeSlot.date}`);

    const glowNames = glow.body.bookings.map((row: { customerName: string }) => row.customerName);
    const fadeNames = fade.body.bookings.map((row: { customerName: string }) => row.customerName);

    expect(glowNames).toContain("Glow Only");
    expect(glowNames).not.toContain("Fade Only");
    expect(fadeNames).toContain("Fade Only");
    expect(fadeNames).not.toContain("Glow Only");
  });

  it("never returns another tenant's service list", async () => {
    const glow = await getJson(h.app, `/api/tenants/${GLOW}`);
    const fade = await getJson(h.app, `/api/tenants/${FADE}`);

    const glowServices = glow.body.services.map((row: { name: string }) => row.name);
    const fadeServices = fade.body.services.map((row: { name: string }) => row.name);

    expect(glowServices).toContain("Braiding");
    expect(fadeServices).not.toContain("Braiding");
    expect(fadeServices).toContain("Skin fade");
    expect(glowServices).not.toContain("Skin fade");
  });

  it("rejects a booking that uses the other tenant's service id", async () => {
    const fade = await getJson(h.app, `/api/tenants/${FADE}`);
    const glowSlot = await firstSlot(h.app, GLOW, "Trim");
    const fadeServiceId = fade.body.services[0].id;

    const response = await book(
      h.app,
      GLOW,
      { ...glowSlot, serviceId: fadeServiceId },
      "Confused Customer",
    );

    expect(response.status).toBe(404);
  });
});

describe("a conversation survives the process", () => {
  it("resumes the thread and the booking it already owns", async () => {
    const externalId = `resume-${Date.now()}`;
    let createdId: string | null = null;
    let resumedBooking: string | null | undefined;

    const turnOne = async (port: AgentPort) => {
      const date = addDays(toLocalDate(port.now, port.tenant.timezone), 2);
      const slots = await port.findSlots({ service: port.services[0]!.name, date });
      if (!slots.ok || slots.slots.length === 0) throw new Error("no slot for the stub");

      const slot = slots.slots[0]!;
      const attempt = await port.createBooking({
        service: port.services[0]!.name,
        resourceId: slot.resourceId,
        startsAt: slot.startsAt,
        customerName: "Resume Customer",
      });
      if (!attempt.ok) throw new Error(attempt.message);

      createdId = attempt.id;
      return { text: "Booked.", escalated: false };
    };

    const turnTwo = async (port: AgentPort) => {
      resumedBooking = port.existingBooking?.id ?? null;
      return { text: "You already have a booking.", escalated: false };
    };

    const first = await runTurn({
      db: h.db,
      tenantSlug: GLOW,
      channel: silentChannel(),
      externalId,
      text: "Book me in",
      agentRunner: turnOne as never,
    });

    expect(first).not.toBeNull();
    expect(createdId).toBeTruthy();

    // A new process would import the module fresh; here the only thing that
    // carries over is the database, which is the point.
    const second = await runTurn({
      db: h.db,
      tenantSlug: GLOW,
      channel: silentChannel(),
      externalId,
      text: "What did I book?",
      agentRunner: turnTwo as never,
    });

    expect(second!.conversationId).toBe(first!.conversationId);
    expect(resumedBooking).toBe(createdId);
  });

  it("keeps both sides of the conversation in the transcript", async () => {
    const externalId = `thread-${Date.now()}`;

    const runner = async () => ({ text: "Noted, see you then.", escalated: false });

    const turn = await runTurn({
      db: h.db,
      tenantSlug: GLOW,
      channel: silentChannel(),
      externalId,
      text: "Hello there",
      agentRunner: runner as never,
    });

    const conversation = await getConversationByExternalId(h.db, {
      tenantId: turn!.tenantId,
      channel: "widget",
      externalId,
    });
    expect(conversation).not.toBeNull();

    const thread = await getJson(
      h.app,
      `/api/tenants/${GLOW}/conversations/${conversation!.id}`,
    );

    const texts = thread.body.messages.map((row: { text: string }) => row.text);
    expect(texts).toContain("Hello there");
    expect(texts).toContain("Noted, see you then.");
  });

  it("lets staff reply into the same thread and marks it human", async () => {
    const externalId = `reply-${Date.now()}`;
    const runner = async () => ({ text: "The bot speaking.", escalated: false });

    const turn = await runTurn({
      db: h.db,
      tenantSlug: GLOW,
      channel: silentChannel(),
      externalId,
      text: "Can a person help?",
      agentRunner: runner as never,
    });

    const conversation = await getConversationByExternalId(h.db, {
      tenantId: turn!.tenantId,
      channel: "widget",
      externalId,
    });

    const reply = await postJson(
      h.app,
      `/api/tenants/${GLOW}/conversations/${conversation!.id}/reply`,
      { text: "This is Grace, I can help." },
    );

    expect(reply.status).toBe(200);
    expect(reply.body.message.role).toBe("staff");

    const thread = await getJson(
      h.app,
      `/api/tenants/${GLOW}/conversations/${conversation!.id}`,
    );

    const texts = thread.body.messages.map((row: { text: string }) => row.text);
    expect(texts).toContain("This is Grace, I can help.");
    expect(thread.body.conversation.status).toBe("human");
  });

  it("does not merge two businesses that share a session id", async () => {
    const externalId = `shared-${Date.now()}`;
    const runner = async () => ({ text: "ok", escalated: false });

    await runTurn({
      db: h.db,
      tenantSlug: GLOW,
      channel: silentChannel(),
      externalId,
      text: "glow",
      agentRunner: runner as never,
    });
    await runTurn({
      db: h.db,
      tenantSlug: FADE,
      channel: silentChannel(),
      externalId,
      text: "fade",
      agentRunner: runner as never,
    });

    const before = await countRows(h.db, "conversations");

    const glowTenant = await getJson(h.app, `/api/tenants/${GLOW}`);
    const fadeTenant = await getJson(h.app, `/api/tenants/${FADE}`);
    expect(glowTenant.body.tenant.id).not.toBe(fadeTenant.body.tenant.id);

    const glowThread = await getConversationByExternalId(h.db, {
      tenantId: glowTenant.body.tenant.id,
      channel: "widget",
      externalId,
    });
    const fadeThread = await getConversationByExternalId(h.db, {
      tenantId: fadeTenant.body.tenant.id,
      channel: "widget",
      externalId,
    });

    expect(glowThread!.id).not.toBe(fadeThread!.id);
    expect(before).toBeGreaterThanOrEqual(2);
  });
});
