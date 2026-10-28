import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createWhatsAppChannel,
  parseWhatsAppWebhook,
  verifyWhatsAppSignature,
} from "../whatsapp";

/**
 * The WhatsApp adapter, tested at its boundary: the request it would send and
 * the payload it would accept. No Meta account is required to prove either, and
 * when one exists the only new fact is whether Meta agrees.
 */

const PHONE_ID = "109876543210987";
const TOKEN = "EAAG-fake-system-user-token";
const APP_SECRET = "app-secret-for-tests";

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(response: Response | (() => Response)) {
  const calls: Captured[] = [];

  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return typeof response === "function" ? response() : response;
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

describe("sending", () => {
  it("posts a text message to the phone number id", async () => {
    const { fetchImpl, calls } = fakeFetch(new Response('{"messages":[{"id":"wamid.1"}]}', { status: 200 }));

    const channel = createWhatsAppChannel({
      phoneNumberId: PHONE_ID,
      token: TOKEN,
      fetch: fetchImpl,
    });

    await channel.send("254712345678", { text: "Your slot is 2pm.", quickReplies: [] });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`,
    );

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);

    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      to: "254712345678",
      type: "text",
      text: { body: "Your slot is 2pm." },
    });
  });

  it("throws with the API's own words when Meta refuses", async () => {
    const { fetchImpl } = fakeFetch(
      new Response('{"error":{"message":"Recipient not in allowed list"}}', { status: 400 }),
    );

    const channel = createWhatsAppChannel({
      phoneNumberId: PHONE_ID,
      token: TOKEN,
      fetch: fetchImpl,
    });

    await expect(
      channel.send("254712345678", { text: "hi", quickReplies: [] }),
    ).rejects.toThrow(/400.*allowed list/s);
  });

  it("never sends an empty body", async () => {
    const { fetchImpl, calls } = fakeFetch(new Response("{}", { status: 200 }));

    const channel = createWhatsAppChannel({
      phoneNumberId: PHONE_ID,
      token: TOKEN,
      fetch: fetchImpl,
    });

    await channel.send("254712345678", { text: "   ", quickReplies: [] });

    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.text.body).toBe("—");
  });
});

describe("parsing a webhook", () => {
  it("extracts a text message", () => {
    const messages = parseWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "254712345678",
                    id: "wamid.ABC",
                    timestamp: "1730000000",
                    type: "text",
                    text: { body: "Do you have space on Saturday?" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(messages).toEqual([
      {
        from: "254712345678",
        text: "Do you have space on Saturday?",
        id: "wamid.ABC",
        timestamp: "1730000000",
      },
    ]);
  });

  it("ignores delivery receipts and non-text messages", () => {
    const messages = parseWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: "wamid.1", status: "delivered" }],
                messages: [
                  { from: "254700000000", id: "wamid.2", type: "image" },
                  { from: "254700000000", id: "wamid.3", type: "text" },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(messages).toHaveLength(0);
  });

  it("copes with several entries in one delivery", () => {
    const messages = parseWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: "1", id: "a", type: "text", text: { body: "one" } }],
              },
            },
          ],
        },
        {
          changes: [
            {
              value: {
                messages: [{ from: "2", id: "b", type: "text", text: { body: "two" } }],
              },
            },
          ],
        },
      ],
    });

    expect(messages.map((message) => message.text)).toEqual(["one", "two"]);
  });

  it("returns nothing for a payload that is not a webhook", () => {
    expect(parseWhatsAppWebhook(null)).toEqual([]);
    expect(parseWhatsAppWebhook({})).toEqual([]);
  });
});

describe("signature", () => {
  const body = JSON.stringify({ entry: [] });
  const sign = (secret: string) =>
    `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

  it("accepts Meta's signature", () => {
    expect(verifyWhatsAppSignature(body, sign(APP_SECRET), APP_SECRET)).toBe(true);
  });

  it("rejects a body that changed after signing", () => {
    const header = sign(APP_SECRET);
    expect(verifyWhatsAppSignature(`${body} `, header, APP_SECRET)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(verifyWhatsAppSignature(body, sign("other-secret"), APP_SECRET)).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyWhatsAppSignature(body, undefined, APP_SECRET)).toBe(false);
    expect(verifyWhatsAppSignature(body, "deadbeef", APP_SECRET)).toBe(false);
    expect(verifyWhatsAppSignature(body, "sha256=", APP_SECRET)).toBe(false);
  });
});
