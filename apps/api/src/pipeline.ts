import { runAgent } from "@booking/agent";
import { handleInbound, type Channel, type ConversationStore } from "@booking/channels";
import {
  appendMessage,
  getConversationById,
  getOrCreateConversation,
  getTenantBySlug,
  recentMessages,
  setConversationStatus,
  toModelHistory,
  type Database,
} from "@booking/db";
import type { ConversationStatus } from "@booking/shared";

import { buildAgentPort } from "./agent-port";

/**
 * One inbound message, whatever the transport.
 *
 * Telegram polls, the widget posts, WhatsApp will call the same function. The
 * only thing that changes is which `Channel` carries the reply.
 */

export function createConversationStore(db: Database): ConversationStore {
  return {
    getOrCreate: async (event) => {
      const row = await getOrCreateConversation(db, {
        tenantId: event.tenantId,
        channel: event.channel,
        externalId: event.externalId,
        customerName: event.customerName,
      });
      return { id: row.id, status: row.status };
    },
    append: async (conversationId, role, content) => {
      await appendMessage(db, conversationId, role, content);
    },
    history: async (conversationId, limit) =>
      toModelHistory(await recentMessages(db, conversationId, limit)),
    setStatus: async (conversationId, status) => {
      await setConversationStatus(db, conversationId, status);
    },
  };
}

export interface TurnInput {
  db: Database;
  tenantSlug: string;
  channel: Channel;
  /** Telegram chat id, widget session id, WhatsApp wa_id. */
  externalId: string;
  text: string;
  customerName?: string | null;
  apiKey?: string;
  model?: string;
}

export interface TurnResult {
  tenantId: string;
  conversationId: string;
  status: ConversationStatus;
}

export async function runTurn(input: TurnInput): Promise<TurnResult | null> {
  const { db, tenantSlug, channel, externalId } = input;

  const tenant = await getTenantBySlug(db, tenantSlug);
  if (!tenant) return null;

  // The thread exists before the model runs, so the port can enforce
  // "one booking per chat" and the row is never orphaned.
  const conversation = await getOrCreateConversation(db, {
    tenantId: tenant.id,
    channel: channel.name,
    externalId,
    customerName: input.customerName ?? null,
  });

  const port = await buildAgentPort(db, tenant.slug, new Date(), conversation.id);
  if (!port) return null;

  await handleInbound(
    {
      store: createConversationStore(db),
      channel,
      agent: {
        run: async (history) => {
          const result = await runAgent(port, history, {
            apiKey: input.apiKey,
            model: input.model,
          });
          return { text: result.text, escalated: result.escalated };
        },
      },
      logger: {
        info: (message, meta) => console.log(`[${channel.name}] ${message}`, meta ?? ""),
        error: (message, error) => console.error(`[${channel.name}] ${message}`, error),
      },
    },
    {
      tenantId: tenant.id,
      channel: channel.name,
      externalId,
      text: input.text,
      customerName: input.customerName ?? null,
    },
  );

  const fresh = await getConversationById(db, tenant.id, conversation.id);

  return {
    tenantId: tenant.id,
    conversationId: conversation.id,
    status: fresh?.status ?? conversation.status,
  };
}
