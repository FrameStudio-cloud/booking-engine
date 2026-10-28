import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyTenant,
  clearTenantCache,
  execRaw,
  getTenantBySlug,
  loadPreset,
} from "@booking/db";

import { GLOW, setup, type Harness } from "./harness";

/**
 * The slug cache.
 *
 * The proof is a write that goes around the repository: the cache must keep
 * serving the old row (that is what a cache is), and must stop doing so the
 * moment anything legitimate writes the tenant. A cache you cannot prove is
 * stale is indistinguishable from a bug.
 */

let h: Harness;

beforeAll(async () => {
  h = await setup();
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe("tenant cache", () => {
  it("serves the row it already read, even after a write around it", async () => {
    const first = await getTenantBySlug(h.db, GLOW);
    expect(first).not.toBeNull();

    await execRaw(h.db, `update tenants set name = 'Written Around The Repo' where slug = '${GLOW}'`);

    const second = await getTenantBySlug(h.db, GLOW);
    expect(second!.name).toBe(first!.name);
    expect(second!.name).not.toBe("Written Around The Repo");
  });

  it("shows the new row once the cache is cleared", async () => {
    clearTenantCache(h.db, GLOW);

    const fresh = await getTenantBySlug(h.db, GLOW);
    expect(fresh!.name).toBe("Written Around The Repo");
  });

  it("invalidates itself when the tenant is applied from a preset", async () => {
    // Prime the cache with the name written above.
    expect((await getTenantBySlug(h.db, GLOW))!.name).toBe("Written Around The Repo");

    const preset = loadPreset(GLOW);
    await applyTenant(h.db, { ...preset, name: "Glow Salon Renamed" });

    expect((await getTenantBySlug(h.db, GLOW))!.name).toBe("Glow Salon Renamed");
  });

  it("caches the absence of a tenant too, and still returns null", async () => {
    expect(await getTenantBySlug(h.db, "no-such-business")).toBeNull();
    expect(await getTenantBySlug(h.db, "no-such-business")).toBeNull();
  });

  it("does not leak entries between database instances", async () => {
    // A second schema is a second WeakMap key, even in the same process.
    const other = await setup();
    try {
      const row = await getTenantBySlug(other.db, GLOW);
      expect(row!.name).toBe("Glow Salon");
    } finally {
      await other.close();
    }
  });
});
