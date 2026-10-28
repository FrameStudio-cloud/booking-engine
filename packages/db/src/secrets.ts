import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Channel credentials at rest.
 *
 * A bot token is a password: whoever holds it can speak as the business. It
 * cannot live in a preset (presets are committed), and one env var per client
 * means a redeploy for every signup. So it lives in `tenant_channels`,
 * sealed with AES-256-GCM under one process key, and is only opened inside the
 * server process.
 *
 * The webhook secret is not stored at all: it is derived from the same key and
 * the tenant id. Nothing to leak, nothing to sync, and rotating the key rotates
 * every webhook at once (which is also the cost — re-register after rotation).
 */

const VERSION = "v1";
const IV_BYTES = 12;

export function parseSecretKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");

  if (key.length !== 32) {
    throw new Error(
      "CHANNEL_SECRET_KEY must be 32 bytes, base64-encoded — generate one with: openssl rand -base64 32",
    );
  }

  return key;
}

export function sealSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function openSecret(sealed: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = sealed.split(".");

  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error("channel secret is not in the expected v1 format");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * The per-tenant webhook secret. Stable for a given key + tenant + channel,
 * so a registered webhook keeps working across restarts.
 */
export function deriveWebhookSecret(
  key: Buffer,
  tenantId: string,
  channel: string,
): string {
  return createHmac("sha256", key)
    .update(`webhook:${channel}:${tenantId}`)
    .digest("base64url");
}

/** Constant-time comparison that tolerates unequal lengths. */
export function secretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  return a.length === b.length && timingSafeEqual(a, b);
}
