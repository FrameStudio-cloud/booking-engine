import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTenantBySlug,
  listActiveTenantChannels,
  openSecret,
  sealSecret,
  upsertTenantChannel,
} from "@booking/db";

import { loadTelegramBots } from "../bots";
import { GLOW, FADE, setup, type Harness } from "./harness";

/**
 * Two businesses, two bot tokens, one process.
 *
 * The proof that matters: the map is keyed by slug, each bot holds the token
 * that belongs to it, and the webhook secrets are different values. If this
 * ever collapsed to one bot, a customer of one salon would be booked into the
 * other one's calendar.
 */

const KEY = Buffer.alloc(32, 3);
const GLOW_TOKEN = "111111111:AAglow-token-for-tests_000000000000";
const FADE_TOKEN = "222222222:AAfade-token-for-tests_000000000000";

let h: Harness;

beforeAll(async () => {
  h = await setup();

  const glow = await getTenantBySlug(h.db, GLOW);
  const fade = await getTenantBySlug(h.db, FADE);

  await upsertTenantChannel(h.db, {
    tenantId: glow!.id,
    channel: "telegram",
    externalId: "@glow_bot",
    secretCiphertext: sealSecret(GLOW_TOKEN, KEY),
  });

  await upsertTenantChannel(h.db, {
    tenantId: fade!.id,
    channel: "telegram",
    externalId: "@fade_bot",
    secretCiphertext: sealSecret(FADE_TOKEN, KEY),
  });
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe("channel credentials", () => {
  it("lists one live channel per business", async () => {
    const rows = await listActiveTenantChannels(h.db);
    const telegram = rows.filter((row) => row.channel === "telegram");

    expect(telegram.map((row) => row.slug).sort()).toEqual([FADE, GLOW]);
    expect(telegram.find((row) => row.slug === GLOW)?.externalId).toBe("@glow_bot");
  });

  it("stores ciphertext, not the token", async () => {
    const rows = await listActiveTenantChannels(h.db);

    for (const row of rows) {
      expect(row.secretCiphertext).not.toContain("token-for-tests");
      expect(row.secretCiphertext.startsWith("v1.")).toBe(true);
    }
  });

  it("upserts in place when a token rotates", async () => {
    const glow = await getTenantBySlug(h.db, GLOW);
    const rotated = "111111111:AAglow-rotated-token_111111111111";

    await upsertTenantChannel(h.db, {
      tenantId: glow!.id,
      channel: "telegram",
      externalId: "@glow_bot",
      secretCiphertext: sealSecret(rotated, KEY),
    });

    const rows = await listActiveTenantChannels(h.db);
    const row = rows.find((candidate) => candidate.slug === GLOW)!;

    expect(rows.filter((candidate) => candidate.slug === GLOW)).toHaveLength(1);
    expect(openSecret(row.secretCiphertext, KEY)).toBe(rotated);

    // Put the original back for the bot test below.
    await upsertTenantChannel(h.db, {
      tenantId: glow!.id,
      channel: "telegram",
      externalId: "@glow_bot",
      secretCiphertext: sealSecret(GLOW_TOKEN, KEY),
    });
  });
});

describe("the bot registry", () => {
  it("builds one bot per business with its own token", async () => {
    const bots = await loadTelegramBots(h.db, KEY, { init: false });

    expect([...bots.keys()].sort()).toEqual([FADE, GLOW]);
    expect(bots.get(GLOW)!.bot.token).toBe(GLOW_TOKEN);
    expect(bots.get(FADE)!.bot.token).toBe(FADE_TOKEN);
  });

  it("gives each business a different webhook secret", async () => {
    const bots = await loadTelegramBots(h.db, KEY, { init: false });

    expect(bots.get(GLOW)!.webhookSecret).not.toBe(bots.get(FADE)!.webhookSecret);
    expect(bots.get(GLOW)!.webhookSecret.length).toBeGreaterThan(20);
  });

  it("refuses to open a credential with the wrong key", async () => {
    await expect(loadTelegramBots(h.db, Buffer.alloc(32, 4), { init: false })).rejects.toThrow();
  });
});
