import { describe, expect, it } from "vitest";
import {
  deriveWebhookSecret,
  openSecret,
  parseSecretKey,
  sealSecret,
  secretsMatch,
} from "../secrets";

/**
 * The credential path. A bot token is a password; these are the properties that
 * make storing it in a database defensible at all.
 */

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const TOKEN = "123456789:AAHfake-token-for-tests-only_1234567890";

describe("sealing", () => {
  it("round-trips a token", () => {
    expect(openSecret(sealSecret(TOKEN, KEY), KEY)).toBe(TOKEN);
  });

  it("never produces the plaintext in the stored value", () => {
    const sealed = sealSecret(TOKEN, KEY);
    expect(sealed).not.toContain(TOKEN);
    expect(sealed).not.toContain("AAHfake");
  });

  it("produces a different ciphertext every time (fresh iv)", () => {
    expect(sealSecret(TOKEN, KEY)).not.toBe(sealSecret(TOKEN, KEY));
  });

  it("refuses a ciphertext edited by one byte", () => {
    const parts = sealSecret(TOKEN, KEY).split(".");

    const ciphertext = Buffer.from(parts[3]!, "base64url");
    ciphertext[0] = ciphertext[0]! ^ 0xff;
    parts[3] = ciphertext.toString("base64url");

    expect(() => openSecret(parts.join("."), KEY)).toThrow();
  });

  it("refuses a tag edited by one byte", () => {
    const parts = sealSecret(TOKEN, KEY).split(".");

    const tag = Buffer.from(parts[2]!, "base64url");
    tag[0] = tag[0]! ^ 0xff;
    parts[2] = tag.toString("base64url");

    expect(() => openSecret(parts.join("."), KEY)).toThrow();
  });

  it("refuses the wrong key", () => {
    expect(() => openSecret(sealSecret(TOKEN, KEY), OTHER_KEY)).toThrow();
  });

  it("refuses a value that is not in the expected format", () => {
    expect(() => openSecret("plain-token", KEY)).toThrow(/expected v1 format/);
  });
});

describe("the key itself", () => {
  it("rejects a key of the wrong length", () => {
    expect(() => parseSecretKey(Buffer.alloc(16, 1).toString("base64"))).toThrow(/32 bytes/);
    expect(() => parseSecretKey("")).toThrow(/32 bytes/);
  });

  it("accepts a 32-byte base64 key", () => {
    expect(parseSecretKey(KEY.toString("base64"))).toHaveLength(32);
  });
});

describe("derived webhook secrets", () => {
  it("are stable for the same tenant", () => {
    expect(deriveWebhookSecret(KEY, "tenant-a", "telegram")).toBe(
      deriveWebhookSecret(KEY, "tenant-a", "telegram"),
    );
  });

  it("differ between tenants — one leaked URL does not open the others", () => {
    expect(deriveWebhookSecret(KEY, "tenant-a", "telegram")).not.toBe(
      deriveWebhookSecret(KEY, "tenant-b", "telegram"),
    );
  });

  it("differ between channels of the same tenant", () => {
    expect(deriveWebhookSecret(KEY, "tenant-a", "telegram")).not.toBe(
      deriveWebhookSecret(KEY, "tenant-a", "whatsapp"),
    );
  });

  it("change when the master key rotates", () => {
    expect(deriveWebhookSecret(KEY, "tenant-a", "telegram")).not.toBe(
      deriveWebhookSecret(OTHER_KEY, "tenant-a", "telegram"),
    );
  });

  it("compare in constant time and reject different lengths", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
    expect(secretsMatch("abc", "abcd")).toBe(false);
    expect(secretsMatch("", "abc")).toBe(false);
  });
});
