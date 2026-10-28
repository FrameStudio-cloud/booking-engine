import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Channel } from "@booking/channels";
import { getConversationByExternalId } from "@booking/db";

import { runTurn } from "../pipeline";
import { FADE, GLOW, TEST_KEY, getJson, postJson, setup, type Harness } from "./harness";

/**
 * Inbox truth.
 *
 * The old rule was "the last message is from the customer" — which went quiet
 * the moment a human replied, even when the customer wrote again afterwards.
 * Unread is now a count of customer messages since staff last looked.
 */

let h: Harness;

beforeAll(async () => {
  h = await setup();
}, 120_000);

afterAll(async () => {
  await h?.close();
});

function silent(name: "widget" | "telegram" = "widget"): Channel {
  return { name, send: async () => {} };
}

const reply = (text: string) =>
  (async () => ({ text, escalated: false })) as never;

async function conversationOf(externalId: string, slug = GLOW) {
  const tenant = await getJson(h.app, `/api/tenants/${slug}`);
  return getConversationByExternalId(h.db, {
    tenantId: tenant.body.tenant.id,
    channel: "widget",
    externalId,
  });
}

async function summaryFor(slug: string, conversationId: string) {
  const { body } = await getJson(h.app, `/api/tenants/${slug}/conversations`);
  return body.conversations.find((row: { id: string }) => row.id === conversationId);
}

describe("unread counts", () => {
  it("counts every customer message, then clears on staff reply", async () => {
    const externalId = `inbox-${Date.now()}`;

    for (const text of ["Hi", "Do you have space on Saturday?"]) {
      await runTurn({
        db: h.db,
        tenantSlug: GLOW,
        channel: silent(),
        externalId,
        text,
        agentRunner: reply("Sure — what time?"),
      });
    }

    const conversation = await conversationOf(externalId);
    expect(conversation).not.toBeNull();

    const before = await summaryFor(GLOW, conversation!.id);
    expect(before.unreadCount).toBe(2);
    expect(before.unread).toBe(true);

    await postJson(
      h.app,
      `/api/tenants/${GLOW}/conversations/${conversation!.id}/reply`,
      { text: "We do — 2pm works." },
    );

    const after = await summaryFor(GLOW, conversation!.id);
    expect(after.unreadCount).toBe(0);
    expect(after.unread).toBe(false);
  });

  it("goes unread again when the customer answers a human", async () => {
    const externalId = `inbox-return-${Date.now()}`;

    const turn = await runTurn({
      db: h.db,
      tenantSlug: GLOW,
      channel: silent(),
      externalId,
      text: "Any slots today?",
      agentRunner: reply("Checking."),
    });

    const conversationId = turn!.conversationId;

    await postJson(h.app, `/api/tenants/${GLOW}/conversations/${conversationId}/reply`, {
      text: "We have 4pm.",
    });

    // A human has replied, so the thread is `human` — the old rule stopped
    // counting here and this message was invisible.
    await runTurn({
      db: h.db,
      tenantSlug: GLOW,
      channel: silent(),
      externalId,
      text: "4pm is fine, thank you.",
      agentRunner: reply("Booked."),
    });

    const summary = await summaryFor(GLOW, conversationId);
    expect(summary.status).toBe("human");
    expect(summary.unreadCount).toBe(1);
    expect(summary.unread).toBe(true);
  });

  it("clears from the explicit read route", async () => {
    const externalId = `inbox-read-${Date.now()}`;

    const turn = await runTurn({
      db: h.db,
      tenantSlug: GLOW,
      channel: silent(),
      externalId,
      text: "Hello?",
      agentRunner: reply("Hi."),
    });

    const response = await postJson(
      h.app,
      `/api/tenants/${GLOW}/conversations/${turn!.conversationId}/read`,
      {},
    );

    expect(response.status).toBe(200);
    expect(response.body.conversation.unreadCount).toBe(0);
    expect((await summaryFor(GLOW, turn!.conversationId)).unreadCount).toBe(0);
  });
});

describe("staff attribution", () => {
  it("records who replied and shows it in the thread", async () => {
    const externalId = `attribution-${Date.now()}`;

    const turn = await runTurn({
      db: h.db,
      tenantSlug: GLOW,
      channel: silent(),
      externalId,
      text: "Can I move my appointment?",
      agentRunner: reply("Let me check."),
    });

    const conversationId = turn!.conversationId;

    const response = await h.app.request(
      `/api/tenants/${GLOW}/conversations/${conversationId}/reply`,
      {
        method: "POST",
        headers: {
          "x-engine-key": TEST_KEY,
          "x-staff-name": "Amina",
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: "Moved you to 3pm." }),
      },
    );

    expect(response.status).toBe(200);

    const thread = await getJson(h.app, `/api/tenants/${GLOW}/conversations/${conversationId}`);
    const staff = thread.body.messages.filter(
      (message: { role: string }) => message.role === "staff",
    );

    expect(staff).toHaveLength(1);
    expect(staff[0].author).toBe("Amina");

    // The bot and the customer stay anonymous.
    const others = thread.body.messages.filter(
      (message: { role: string }) => message.role !== "staff",
    );
    expect(others.every((message: { author: string | null }) => message.author === null)).toBe(true);
  });

  it("accepts the name in the body as well, and caps its length", async () => {
    const externalId = `attribution-body-${Date.now()}`;

    const turn = await runTurn({
      db: h.db,
      tenantSlug: GLOW,
      channel: silent(),
      externalId,
      text: "Hello",
      agentRunner: reply("Hi."),
    });

    const response = await postJson(
      h.app,
      `/api/tenants/${GLOW}/conversations/${turn!.conversationId}/reply`,
      { text: "Sure.", staff: "x".repeat(80) },
    );

    expect(response.body.message.author).toHaveLength(40);
  });
});

describe("consent", () => {
  it("tells the customer the chat is recorded, before they type", async () => {
    const { status, body } = await getJson(h.app, `/api/tenants/${GLOW}/widget/config`, "");

    expect(status).toBe(200);
    expect(body.consent).toMatch(/recorded/i);
    expect(body.privacyUrl).toBeNull();
  });
});

describe("per-channel identity", () => {
  it("keeps the same person on two channels as two threads with their own unread", async () => {
    const externalId = `person-${Date.now()}`;

    const widgetTurn = await runTurn({
      db: h.db,
      tenantSlug: GLOW,
      channel: silent("widget"),
      externalId,
      text: "from the widget",
      agentRunner: reply("ok"),
    });

    const telegramTurn = await runTurn({
      db: h.db,
      tenantSlug: GLOW,
      channel: silent("telegram"),
      externalId,
      text: "from telegram",
      agentRunner: reply("ok"),
    });

    expect(telegramTurn!.conversationId).not.toBe(widgetTurn!.conversationId);

    await postJson(
      h.app,
      `/api/tenants/${GLOW}/conversations/${widgetTurn!.conversationId}/read`,
      {},
    );

    expect((await summaryFor(GLOW, widgetTurn!.conversationId)).unreadCount).toBe(0);
    expect((await summaryFor(GLOW, telegramTurn!.conversationId)).unreadCount).toBe(1);
  });

  it("does not count another tenant's messages", async () => {
    const externalId = `cross-${Date.now()}`;

    await runTurn({
      db: h.db,
      tenantSlug: FADE,
      channel: silent(),
      externalId,
      text: "fade only",
      agentRunner: reply("ok"),
    });

    const { body } = await getJson(h.app, `/api/tenants/${GLOW}/conversations`);
    const leaked = body.conversations.filter(
      (row: { lastMessage: { text: string } | null }) =>
        row.lastMessage?.text === "fade only",
    );

    expect(leaked).toHaveLength(0);
  });
});
