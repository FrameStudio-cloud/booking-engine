import type { Hono } from "hono";
import {
  createTestDatabase,
  databaseUrl,
  seedTenant,
  type Database,
} from "@booking/db";
import { addDays, toLocalDate } from "@booking/core";
import type { LocalDate } from "@booking/shared";

/**
 * Integration harness: one throwaway schema per test file, two real tenants.
 *
 * Nothing here talks to the model or to Telegram. Everything else — Postgres,
 * the slot engine, the booking locks, the channel pipeline — runs for real.
 */

export const TEST_KEY = "integration-test-key";
export const GLOW = "glow-salon";
export const FADE = "fade-factory";

export interface Harness {
  app: Hono;
  db: Database;
  close(): Promise<void>;
}

export async function setup(): Promise<Harness> {
  const url = databaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required for integration tests — copy .env.example to .env",
    );
  }

  const testDb = await createTestDatabase(url);
  await seedTenant(testDb.db, GLOW);
  await seedTenant(testDb.db, FADE);

  const { useDatabase } = await import("../db");
  useDatabase(testDb.db);

  const { app } = await import("../index");
  const { config } = await import("../env");

  // Deterministic auth, and no outbound calls even if .env has real keys.
  config.engineApiKey = TEST_KEY;
  config.groqApiKey = undefined;
  config.telegram.token = undefined;

  return { app, db: testDb.db, close: () => testDb.dispose() };
}

export function headers(key = TEST_KEY): Record<string, string> {
  return { "x-engine-key": key, "content-type": "application/json" };
}

export async function getJson(
  app: Hono,
  path: string,
  key = TEST_KEY,
): Promise<{ status: number; body: any }> {
  const response = await app.request(path, { headers: key ? headers(key) : {} });
  return { status: response.status, body: await response.json().catch(() => null) };
}

export async function postJson(
  app: Hono,
  path: string,
  body: unknown,
  key = TEST_KEY,
): Promise<{ status: number; body: any }> {
  const response = await app.request(path, {
    method: "POST",
    headers: key ? headers(key) : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

export interface Slot {
  date: LocalDate;
  serviceId: string;
  resourceId: string;
  startsAt: string;
}

/** First real slot in the next ten days, straight from the engine. */
export async function firstSlot(
  app: Hono,
  slug: string,
  serviceKey: string,
  timezone = "Africa/Nairobi",
): Promise<Slot> {
  const today = toLocalDate(new Date(), timezone);

  for (let offset = 1; offset <= 10; offset += 1) {
    const date = addDays(today, offset);
    const { status, body } = await getJson(
      app,
      `/api/tenants/${slug}/slots?date=${date}&service=${serviceKey}`,
    );

    if (status !== 200 || !body?.slots?.length) continue;

    const slot = body.slots[0];
    return {
      date,
      serviceId: body.service.id,
      resourceId: slot.resourceId,
      startsAt: slot.startsAt,
    };
  }

  throw new Error(`no slot found for ${slug}/${serviceKey} in the next ten days`);
}

export function book(
  app: Hono,
  slug: string,
  slot: Slot,
  customerName = "Test Customer",
) {
  return postJson(app, `/api/tenants/${slug}/bookings`, {
    serviceId: slot.serviceId,
    resourceId: slot.resourceId,
    startsAt: slot.startsAt,
    customerName,
  });
}
