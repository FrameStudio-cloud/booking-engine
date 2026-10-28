import type { Database } from "./client";
import type { TenantRow } from "./schema";

/**
 * Slug → tenant, memoised per process.
 *
 * Every request resolves the tenant once, and a turn resolves it again, so the
 * same row is fetched several times per customer message for data that changes
 * monthly. The cache is keyed by the database instance, so two test schemas in
 * one process never share an entry.
 *
 * Two rules keep it honest:
 *  - writes that touch a tenant call `clearTenantCache` (apply, provision);
 *  - everything else expires after 30 seconds, which is the longest a settings
 *    change from another process can stay invisible.
 *
 * Deliberately only the tenant row. Services and availability are NOT cached:
 * a stale price is a lie, and a stale slot is a double booking.
 */

const TTL_MS = 30_000;

interface Entry {
  row: TenantRow | null;
  at: number;
}

const caches = new WeakMap<Database, Map<string, Entry>>();

function cacheFor(db: Database): Map<string, Entry> {
  let cache = caches.get(db);
  if (!cache) {
    cache = new Map();
    caches.set(db, cache);
  }
  return cache;
}

/** `undefined` means "not cached"; `null` means "cached: no such tenant". */
export function readTenantCache(db: Database, slug: string): TenantRow | null | undefined {
  const entry = cacheFor(db).get(slug);
  if (!entry) return undefined;
  if (Date.now() - entry.at > TTL_MS) {
    cacheFor(db).delete(slug);
    return undefined;
  }
  return entry.row;
}

export function writeTenantCache(db: Database, slug: string, row: TenantRow | null): void {
  cacheFor(db).set(slug, { row, at: Date.now() });
}

/** Called after any write to `tenants`. Omit the slug to drop the whole cache. */
export function clearTenantCache(db: Database, slug?: string): void {
  if (slug) cacheFor(db).delete(slug);
  else cacheFor(db).clear();
}
