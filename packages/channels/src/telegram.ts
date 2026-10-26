import { Api } from "grammy";
import type { OutboundMessage } from "@booking/shared";
import type { Channel } from "./types";

/**
 * grammY's Api client, kept to the `send` boundary only.
 * The bot object lives in the app, not here, so this package stays
 * transport-shaped and testable.
 */
export function createTelegramChannel(token: string): Channel {
  const api = new Api(token);

  return {
    name: "telegram",
    async send(chatId: string, message: OutboundMessage): Promise<void> {
      await api.sendMessage(chatId, message.text, {
        link_preview_options: { is_disabled: true },
      });
    },
  };
}
