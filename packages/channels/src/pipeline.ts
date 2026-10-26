import type { InboundEvent, PipelineDeps } from "./types";

const FALLBACK =
  "Sorry — something went wrong on our side. A team member will pick this up shortly.";

/**
 * The one path every inbound message takes, on every channel.
 *
 * Order matters: persist first, then decide, then reply. If the process dies
 * mid-reply the customer's message is still in the database.
 */
export async function handleInbound(
  deps: PipelineDeps,
  event: InboundEvent,
): Promise<void> {
  const text = event.text.trim();
  if (text.length === 0) return;

  const { store, agent, channel, logger } = deps;
  const conversation = await store.getOrCreate({ ...event, text });
  await store.append(conversation.id, "user", text);

  // A person owns this thread, or it is finished. The bot stays quiet —
  // talking over staff is the fastest way to lose a customer's trust.
  if (conversation.status === "human" || conversation.status === "closed") {
    logger?.info("bot muted", { conversationId: conversation.id, status: conversation.status });
    return;
  }

  let reply: { text: string; escalated: boolean };

  try {
    const history = await store.history(conversation.id, deps.historyLimit ?? 20);
    reply = await agent.run(history);
  } catch (error) {
    // Never leave a customer in silence.
    logger?.error("agent failed", error);
    await store.setStatus(conversation.id, "needs_human");
    await channel.send(event.externalId, { text: FALLBACK, quickReplies: [] });
    return;
  }

  await store.append(conversation.id, "assistant", reply.text);
  if (reply.escalated) await store.setStatus(conversation.id, "needs_human");

  await channel.send(event.externalId, {
    text: reply.text,
    quickReplies: [],
  });
}
