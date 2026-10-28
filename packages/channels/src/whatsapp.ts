import { createHmac, timingSafeEqual } from "node:crypto";
import type { OutboundMessage } from "@booking/shared";
import type { Channel } from "./types";

/**
 * WhatsApp, through Meta's own Cloud API.
 *
 * The decision (recorded in PLAN-V2 §12.3): the official API, not Baileys.
 * Baileys is an unofficial WhatsApp Web client — free, but it breaks without
 * notice and gets numbers banned, which is a strange thing to sell. 360Dialog
 * is the same Cloud API with a reseller in front of it; a BSP only earns its fee
 * when a client needs a local number or invoice. Neither is needed for v1.
 *
 * Everything here is transport: one POST to send, one parser for the webhook,
 * one HMAC check. The pipeline, the tools and the booking path never learn that
 * WhatsApp exists.
 */

const GRAPH_VERSION = "v21.0";

export interface WhatsAppChannelOptions {
  /** Meta's "phone number id", not the phone number itself. */
  phoneNumberId: string;
  /** System-user or app access token. */
  token: string;
  /** Injected in tests; defaults to global fetch. */
  fetch?: typeof fetch;
}

export interface WhatsAppTextMessage {
  /** wa_id — the customer's phone number, digits only. */
  from: string;
  text: string;
  /** Meta's message id, useful for de-duplicating retries. */
  id: string;
  timestamp: string;
}

export function createWhatsAppChannel(options: WhatsAppChannelOptions): Channel {
  const request = options.fetch ?? fetch;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${options.phoneNumberId}/messages`;

  return {
    name: "whatsapp",
    async send(to: string, message: OutboundMessage): Promise<void> {
      const response = await request(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: {
            // WhatsApp rejects an empty body; the model never sends one, but a
            // silent 400 is a worse failure than a dash.
            body: message.text.trim() || "—",
            preview_url: false,
          },
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `whatsapp send failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        );
      }
    },
  };
}

/**
 * Pull the text messages out of a Cloud API webhook payload.
 *
 * A single delivery can contain several entries and several changes. Status
 * callbacks (delivered/read) arrive on the same endpoint and carry no
 * `messages` — they are not customer turns and must not become one.
 */
export function parseWhatsAppWebhook(payload: unknown): WhatsAppTextMessage[] {
  const body = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{
            from?: string;
            id?: string;
            timestamp?: string;
            type?: string;
            text?: { body?: string };
          }>;
        };
      }>;
    }>;
  };

  const out: WhatsAppTextMessage[] = [];

  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (message.type !== "text") continue;
        if (!message.from || !message.id || message.text?.body === undefined) continue;

        out.push({
          from: message.from,
          text: message.text.body,
          id: message.id,
          timestamp: message.timestamp ?? "",
        });
      }
    }
  }

  return out;
}

/**
 * Meta signs the raw request body with the app secret. Compare in constant
 * time; a webhook with a wrong signature is an anonymous stranger.
 */
export function verifyWhatsAppSignature(
  rawBody: string,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const received = header.slice("sha256=".length);

  const a = Buffer.from(expected);
  const b = Buffer.from(received);

  return a.length === b.length && timingSafeEqual(a, b);
}
