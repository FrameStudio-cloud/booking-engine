// Attaches a channel credential to one business.
//
//   pnpm tenant:channel glow-salon --telegram-token=123456:ABC --username=glow_bot
//   pnpm tenant:channel glow-salon --show
//   pnpm tenant:channel glow-salon --remove
//
// The token is sealed before it reaches the database. The webhook secret is
// derived from CHANNEL_SECRET_KEY and the tenant id, so it is never stored —
// this command prints it once, and the same value comes back every run.
import { createDb } from "../client";
import {
  deactivateTenantChannel,
  getTenantChannel,
  upsertTenantChannel,
} from "../channels";
import { getTenantBySlug } from "../repo";
import { deriveWebhookSecret, parseSecretKey, sealSecret } from "../secrets";
import { databaseUrl } from "./env";

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith("--"));

function flag(name: string): string | undefined {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  return match?.slice(name.length + 3);
}

const show = args.includes("--show");
const remove = args.includes("--remove");
const adoptEnv = args.includes("--adopt-env");

// Loads .env first: the token and base URL below may come from it.
const url = databaseUrl();

const token = flag("telegram-token") ?? (adoptEnv ? process.env.TELEGRAM_BOT_TOKEN : undefined);
const username = flag("username");
const baseUrl = flag("url") ?? process.env.PUBLIC_BASE_URL;

if (!slug) {
  console.error(
    "usage: pnpm tenant:channel <slug> --telegram-token=<token> [--username=<bot>] [--url=<public base url>]",
  );
  console.error("       pnpm tenant:channel <slug> --show | --remove");
  process.exit(1);
}

const encodedKey = process.env.CHANNEL_SECRET_KEY;
if (!encodedKey) {
  console.error(
    "CHANNEL_SECRET_KEY is missing. Generate one with `openssl rand -base64 32` and put it in .env.",
  );
  process.exit(1);
}

const key = parseSecretKey(encodedKey);
const db = createDb(url);
const tenant = await getTenantBySlug(db, slug);

if (!tenant) {
  console.error(`no business with slug "${slug}"`);
  process.exit(1);
}

const tenantId = tenant.id;

function webhookUrl(): string {
  const secret = deriveWebhookSecret(key, tenantId, "telegram");
  const path = `/webhooks/telegram/${slug}/${secret}`;
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}${path}` : path;
}

if (show) {
  const row = await getTenantChannel(db, tenant.id, "telegram");
  console.log(`${tenant.name} (${tenant.slug})`);
  console.log(`  telegram   ${row?.active ? "configured" : "not configured"}`);
  if (row) {
    console.log(`  handle     ${row.externalId ?? "(not set)"}`);
    console.log(`  updated    ${row.updatedAt.toISOString()}`);
  }
  console.log(`  webhook    ${webhookUrl()}`);
  process.exit(0);
}

if (remove) {
  await deactivateTenantChannel(db, tenant.id, "telegram");
  console.log(`telegram disabled for ${tenant.slug}. The row is kept, not deleted.`);
  process.exit(0);
}

if (!token) {
  console.error(
    "--telegram-token=<token> is required (or --adopt-env to use TELEGRAM_BOT_TOKEN, or --show / --remove)",
  );
  process.exit(1);
}

// A Telegram token is `<bot id>:<secret>`; catching a paste error here is
// cheaper than discovering it when the bot fails to start.
if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
  console.error("that does not look like a Telegram bot token (expected 123456789:AA...)");
  process.exit(1);
}

// Ask Telegram who this token is before writing it. A token that cannot call
// getMe is a token that will fail at boot, and the database is not the place to
// find that out.
const me = await fetch(`https://api.telegram.org/bot${token}/getMe`)
  .then((response) => response.json() as Promise<{ ok: boolean; result?: { username?: string } }>)
  .catch((error: unknown) => {
    console.error(`cannot reach Telegram to check the token: ${String(error)}`);
    process.exit(2);
  });

if (!me.ok) {
  console.error("Telegram rejected that token — nothing written.");
  process.exit(2);
}

const handle = username ?? me.result?.username;

await upsertTenantChannel(db, {
  tenantId: tenant.id,
  channel: "telegram",
  externalId: handle ? `@${handle.replace(/^@/, "")}` : null,
  secretCiphertext: sealSecret(token, key),
});

console.log(
  `${tenant.name} (${tenant.slug}) — telegram token for @${handle ?? "(unknown bot)"} stored, sealed.`,
);
console.log("");
console.log("  webhook url:");
console.log(`    ${webhookUrl()}`);
console.log("");
console.log("  register it with:");
console.log(
  `    curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=${encodeURIComponent(webhookUrl())}"`,
);
console.log("");
console.log("  that URL contains the signing secret — treat it like a password.");
console.log("  rotating CHANNEL_SECRET_KEY changes every webhook URL at once.");
process.exit(0);
