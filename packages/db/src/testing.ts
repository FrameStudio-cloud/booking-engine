import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import type { TenantConfig } from "@booking/shared";
import { tenantConfigSchema } from "@booking/shared";

import { createDb, type Database } from "./client";
import { applyTenant } from "./apply";
import { provisionTenant } from "./provision";

/**
 * A throwaway database for integration tests.
 *
 * Every run gets its own Postgres schema: created empty, migrated from the SQL
 * files, seeded from a preset, and dropped at the end. `public` is never
 * touched, and two runs cannot see each other, so parallel workers are safe.
 *
 * The connection pins `search_path` to that schema, which is why the migrations
 * can be applied as plain SQL instead of through drizzle-kit.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

export function loadRepoEnv(): void {
  for (const candidate of [
    resolve(process.cwd(), "../../.env"),
    resolve(process.cwd(), ".env"),
    resolve(repoRoot, ".env"),
  ]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}

/** Direct connection preferred: migrations and DDL are happier without a pooler. */
export function databaseUrl(): string | null {
  loadRepoEnv();
  return process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? null;
}

export interface TestDatabase {
  db: Database;
  schemaName: string;
  /** Close the pool, then drop the schema. Safe to call twice. */
  dispose(): Promise<void>;
}

export async function createTestDatabase(url: string): Promise<TestDatabase> {
  // The timestamp in the name is what lets the next run clean up after a crash.
  const schemaName = `test_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  const admin = postgres(url, { max: 1, prepare: false });

  await dropStaleSchemas(admin);
  await admin.unsafe(`create schema "${schemaName}"`);

  const db = createDb(url, { searchPath: schemaName, max: 10 });
  await applySqlMigrations(db, schemaName);

  let disposed = false;

  return {
    db,
    schemaName,
    async dispose() {
      if (disposed) return;
      disposed = true;

      await db.$client.end({ timeout: 5 }).catch(() => {});
      await admin.unsafe(`drop schema if exists "${schemaName}" cascade`);
      await admin.end({ timeout: 5 });
    },
  };
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * A crashed run never reaches `dispose`, so the next run sweeps its mess.
 * Only `test_<base36 time>_<random>` schemas old enough to be abandoned.
 */
async function dropStaleSchemas(admin: postgres.Sql): Promise<void> {
  const rows = await admin<{ nspname: string }[]>`
    select nspname from pg_namespace where nspname like 'test\\_%'
  `;

  for (const { nspname } of rows) {
    const stamp = Number.parseInt(nspname.split("_")[1] ?? "", 36);
    if (!Number.isFinite(stamp) || Date.now() - stamp < STALE_AFTER_MS) continue;

    await admin.unsafe(`drop schema if exists "${nspname}" cascade`);
  }
}

/**
 * Drizzle writes `"public"."booking_status"` into every file, so a search_path
 * alone would still put the schema in `public`. Rewrite the qualifier instead:
 * the generated SQL has no other use for the literal string `"public".`.
 */
async function applySqlMigrations(db: Database, schemaName: string): Promise<void> {
  const folder = resolve(here, "../drizzle");
  const files = readdirSync(folder)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (files.length === 0) throw new Error(`no migrations found in ${folder}`);

  for (const file of files) {
    const text = readFileSync(join(folder, file), "utf8").replaceAll(
      '"public".',
      `"${schemaName}".`,
    );

    for (const statement of text.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) await db.execute(sql.raw(trimmed));
    }
  }
}

/** Read a preset by slug, e.g. "glow-salon". */
export function loadPreset(slug: string): TenantConfig {
  const path = resolve(repoRoot, "presets", `${slug}.json`);
  return tenantConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Onboard a business the same way production does. */
export async function seedTenant(db: Database, slug: string): Promise<void> {
  await applyTenant(db, loadPreset(slug));
}

/** Used by the demo-data path in tests that want a booking on the calendar. */
export async function seedTenantDestructive(db: Database, slug: string): Promise<void> {
  await provisionTenant(db, loadPreset(slug));
}

/**
 * The tables a test may need to count. Lets a test assert "one row" without
 * depending on a repository helper.
 */
export async function countRows(
  db: Database,
  table: "bookings" | "conversations" | "messages" | "services" | "resources",
): Promise<number> {
  const result = await db.execute<{ count: string }>(
    sql.raw(`select count(*)::text as count from "${table}"`),
  );
  return Number(result[0]?.count ?? 0);
}

/**
 * Raw SQL for tests that must write *around* the repository — e.g. proving a
 * cache is stale. Never use this in application code.
 */
export async function execRaw(db: Database, statement: string): Promise<void> {
  await db.execute(sql.raw(statement));
}

/** Read-only counterpart to `execRaw`, for asserting a row the API does not return. */
export async function queryRaw<T>(
  db: Database,
  statement: string,
): Promise<T[]> {
  const rows = await db.execute(sql.raw(statement));
  return rows as unknown as T[];
}
