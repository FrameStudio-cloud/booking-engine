import { describe, expect, it } from "vitest";
import type { ConversationStatus, OutboundMessage } from "@booking/shared";
import { handleInbound } from "../pipeline";
import type {
  AgentRunner,
  BotMessage,
  Channel,
  ConversationHandle,
  ConversationStore,
  InboundEvent,
} from "../types";

const EVENT: InboundEvent = {
  tenantId: "tenant-1",
  channel: "telegram",
  externalId: "12345",
  text: "anything tomorrow for a trim?",
  customerName: "Wanjiku",
};

function fakeStore(status: ConversationStatus = "bot") {
  const appended: Array<{ role: string; content: string }> = [];
  const statuses: ConversationStatus[] = [];

  const store: ConversationStore = {
    getOrCreate: async (): Promise<ConversationHandle> => ({ id: "conv-1", status }),
    append: async (_id, role, content) => {
      appended.push({ role, content });
    },
    history: async (_id, limit): Promise<BotMessage[]> =>
      appended
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-limit)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    setStatus: async (_id, next) => {
      statuses.push(next);
    },
  };

  return { store, appended, statuses };
}

function fakeChannel() {
  const sent: Array<{ to: string; message: OutboundMessage }> = [];
  const channel: Channel = {
    name: "telegram",
    send: async (to, message) => {
      sent.push({ to, message });
    },
  };
  return { channel, sent };
}

function fakeAgent(impl?: AgentRunner["run"]): AgentRunner {
  return {
    run: impl ?? (async () => ({ text: "We have 09:00 or 10:00.", escalated: false })),
  };
}

describe("handleInbound", () => {
  it("stores the customer message, replies, and stores the reply", async () => {
    const { store, appended } = fakeStore();
    const { channel, sent } = fakeChannel();

    await handleInbound({ store, agent: fakeAgent(), channel }, EVENT);

    expect(appended).toEqual([
      { role: "user", content: "anything tomorrow for a trim?" },
      { role: "assistant", content: "We have 09:00 or 10:00." },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("12345");
    expect(sent[0]?.message.text).toBe("We have 09:00 or 10:00.");
  });

  it("passes the stored history to the agent, oldest first", async () => {
    const { store, appended } = fakeStore();
    const { channel } = fakeChannel();
    let seen: BotMessage[] = [];

    appended.push({ role: "user", content: "hi" });
    appended.push({ role: "assistant", content: "Hello, how can I help?" });

    await handleInbound(
      {
        store,
        channel,
        agent: fakeAgent(async (history) => {
          seen = history;
          return { text: "ok", escalated: false };
        }),
      },
      EVENT,
    );

    expect(seen.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(seen.at(-1)?.content).toBe("anything tomorrow for a trim?");
  });

  it("marks the conversation for a human when the agent escalates", async () => {
    const { store, statuses } = fakeStore();
    const { channel } = fakeChannel();

    await handleInbound(
      {
        store,
        channel,
        agent: fakeAgent(async () => ({ text: "A team member will reply.", escalated: true })),
      },
      EVENT,
    );

    expect(statuses).toEqual(["needs_human"]);
  });

  it("stays silent when a human already owns the thread", async () => {
    const { store, appended } = fakeStore("human");
    const { channel, sent } = fakeChannel();

    await handleInbound({ store, agent: fakeAgent(), channel }, EVENT);

    // The message is still recorded for staff to read...
    expect(appended).toEqual([{ role: "user", content: "anything tomorrow for a trim?" }]);
    // ...but the bot says nothing.
    expect(sent).toHaveLength(0);
  });

  it("apologises and escalates instead of going quiet when the agent throws", async () => {
    const { store, statuses } = fakeStore();
    const { channel, sent } = fakeChannel();

    await handleInbound(
      {
        store,
        channel,
        agent: fakeAgent(async () => {
          throw new Error("groq is down");
        }),
      },
      EVENT,
    );

    expect(statuses).toEqual(["needs_human"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message.text).toMatch(/team member/i);
  });

  it("ignores empty messages without calling the model", async () => {
    const { store, appended } = fakeStore();
    const { channel, sent } = fakeChannel();
    let called = false;

    await handleInbound(
      {
        store,
        channel,
        agent: fakeAgent(async () => {
          called = true;
          return { text: "x", escalated: false };
        }),
      },
      { ...EVENT, text: "   " },
    );

    expect(called).toBe(false);
    expect(appended).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
});
