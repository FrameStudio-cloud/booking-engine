import { and, eq, isNull } from "drizzle-orm";
import type { TenantConfig } from "@booking/shared";

import type { Database } from "./client";
import { availabilityRules, bookings, resources, services, tenants } from "./schema";
import { clearTenantCache } from "./tenant-cache";

/**
 * Non-destructive tenant upsert.
 *
 * `provisionTenant` deletes and rebuilds, which is right for demos and wrong for
 * a business that already has bookings. This compares the file to the database,
 * prints the difference, and only writes what changed. Nothing is ever deleted:
 * a service or staff member missing from the file is set `active = false`.
 */

export interface RowChange {
  create: string[];
  update: string[];
  restore: string[];
  retire: string[];
}

export interface TenantPlan {
  slug: string;
  isNew: boolean;
  tenantFields: string[];
  resources: RowChange;
  services: RowChange;
  hours: { before: number; after: number; changed: boolean };
  bookings: number;
  changed: boolean;
}

export interface ApplyResult {
  plan: TenantPlan;
  written: boolean;
}

const SOURCE = "preset";

function emptyChange(): RowChange {
  return { create: [], update: [], restore: [], retire: [] };
}

function hasChange(change: RowChange): boolean {
  return (
    change.create.length +
      change.update.length +
      change.restore.length +
      change.retire.length >
    0
  );
}

function sameFacts(a: Record<string, string>, b: Record<string, string>): boolean {
  const key = (value: Record<string, string>) =>
    JSON.stringify(Object.entries(value).sort(([x], [y]) => x.localeCompare(y)));
  return key(a) === key(b);
}

function normalise(name: string): string {
  return name.trim().toLowerCase();
}

/** Read-only: what would change if this file were applied. */
export async function planTenant(
  db: Database,
  config: TenantConfig,
): Promise<TenantPlan> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, config.slug));

  const plan: TenantPlan = {
    slug: config.slug,
    isNew: !tenant,
    tenantFields: [],
    resources: emptyChange(),
    services: emptyChange(),
    hours: { before: 0, after: config.hours.length, changed: false },
    bookings: 0,
    changed: false,
  };

  if (!tenant) {
    plan.resources.create = config.resources.map((r) => r.name);
    plan.services.create = config.services.map((s) => s.name);
    plan.hours.changed = true;
    plan.tenantFields = ["name", "businessType", "timezone", "currency", "facts"];
    plan.changed = true;
    return plan;
  }

  if (tenant.name !== config.name) plan.tenantFields.push("name");
  if (tenant.businessType !== config.businessType) plan.tenantFields.push("businessType");
  if (tenant.timezone !== config.timezone) plan.tenantFields.push("timezone");
  if (tenant.currency !== config.currency) plan.tenantFields.push("currency");
  if (!sameFacts(tenant.facts, config.facts)) plan.tenantFields.push("facts");

  const wantedSettings = {
    brand: config.brand,
    widget: config.widget,
    allowedOrigins: config.allowedOrigins,
    privacy: config.privacy,
    ...(config.notify ? { notify: config.notify } : {}),
  };

  const currentSettings = {
    brand: tenant.settings.brand,
    widget: tenant.settings.widget,
    allowedOrigins: tenant.settings.allowedOrigins ?? [],
    privacy: tenant.settings.privacy ?? { retentionDays: 90 },
    ...(tenant.settings.notify ? { notify: tenant.settings.notify } : {}),
  };

  if (JSON.stringify(wantedSettings) !== JSON.stringify(currentSettings)) {
    plan.tenantFields.push("settings");
  }

  const existingResources = await db
    .select()
    .from(resources)
    .where(eq(resources.tenantId, tenant.id));

  const resourceByName = new Map(existingResources.map((r) => [normalise(r.name), r]));
  const wantedResources = new Set(config.resources.map((r) => normalise(r.name)));

  for (const wanted of config.resources) {
    const current = resourceByName.get(normalise(wanted.name));

    if (!current) {
      plan.resources.create.push(wanted.name);
    } else if (!current.active) {
      plan.resources.restore.push(wanted.name);
    } else if (current.kind !== wanted.kind || current.capacity !== wanted.capacity) {
      plan.resources.update.push(wanted.name);
    }
  }

  for (const current of existingResources) {
    if (current.active && !wantedResources.has(normalise(current.name))) {
      plan.resources.retire.push(current.name);
    }
  }

  const existingServices = await db
    .select()
    .from(services)
    .where(eq(services.tenantId, tenant.id));

  const serviceByName = new Map(existingServices.map((s) => [normalise(s.name), s]));
  const wantedServices = new Set(config.services.map((s) => normalise(s.name)));

  for (const wanted of config.services) {
    const current = serviceByName.get(normalise(wanted.name));

    if (!current) {
      plan.services.create.push(wanted.name);
    } else if (!current.active) {
      plan.services.restore.push(wanted.name);
    } else if (
      current.durationMinutes !== wanted.durationMinutes ||
      current.capacity !== wanted.capacity ||
      current.bufferBeforeMinutes !== wanted.bufferBeforeMinutes ||
      current.priceMinor !== wanted.priceMinor
    ) {
      plan.services.update.push(wanted.name);
    }
  }

  for (const current of existingServices) {
    if (current.active && !wantedServices.has(normalise(current.name))) {
      plan.services.retire.push(current.name);
    }
  }

  const existingHours = await db
    .select()
    .from(availabilityRules)
    .where(and(eq(availabilityRules.tenantId, tenant.id), isNull(availabilityRules.resourceId)));

  const shape = (rows: { weekday: number; opensAt: string; closesAt: string }[]) =>
    rows
      .map((r) => `${r.weekday} ${r.opensAt}-${r.closesAt}`)
      .sort()
      .join("|");

  plan.hours.before = existingHours.length;
  plan.hours.changed = shape(existingHours) !== shape(config.hours);

  const bookingRows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.tenantId, tenant.id));
  plan.bookings = bookingRows.length;

  plan.changed =
    plan.tenantFields.length > 0 ||
    hasChange(plan.resources) ||
    hasChange(plan.services) ||
    plan.hours.changed;

  return plan;
}

/**
 * Apply a config file to a live tenant. Safe to run twice: the second run finds
 * nothing to change. Bookings, conversations and price snapshots are untouched.
 */
export async function applyTenant(
  db: Database,
  config: TenantConfig,
): Promise<ApplyResult> {
  const plan = await planTenant(db, config);

  if (!plan.changed) return { plan, written: false };

  await db.transaction(async (tx) => {
    let tenantId: string;

    if (plan.isNew) {
      const [created] = await tx
        .insert(tenants)
        .values({
          slug: config.slug,
          name: config.name,
          businessType: config.businessType,
          timezone: config.timezone,
          currency: config.currency,
          facts: config.facts,
          settings: {
            brand: config.brand,
            widget: config.widget,
            allowedOrigins: config.allowedOrigins,
            privacy: config.privacy,
            ...(config.notify ? { notify: config.notify } : {}),
          },
        })
        .returning({ id: tenants.id });

      tenantId = created!.id;
    } else {
      const [current] = await tx.select().from(tenants).where(eq(tenants.slug, config.slug));
      tenantId = current!.id;

      await tx
        .update(tenants)
        .set({
          name: config.name,
          businessType: config.businessType,
          timezone: config.timezone,
          currency: config.currency,
          facts: config.facts,
          settings: {
            ...current!.settings,
            brand: config.brand,
            widget: config.widget,
            allowedOrigins: config.allowedOrigins,
            privacy: config.privacy,
            ...(config.notify ? { notify: config.notify } : {}),
          },
          catalogSyncedAt: new Date(),
        })
        .where(eq(tenants.id, tenantId));
    }

    const currentResources = plan.isNew
      ? []
      : await tx.select().from(resources).where(eq(resources.tenantId, tenantId));
    const resourceByName = new Map(currentResources.map((r) => [normalise(r.name), r]));

    for (const wanted of config.resources) {
      const current = resourceByName.get(normalise(wanted.name));

      if (!current) {
        await tx.insert(resources).values({
          tenantId,
          kind: wanted.kind,
          name: wanted.name,
          capacity: wanted.capacity,
        });
      } else {
        await tx
          .update(resources)
          .set({ kind: wanted.kind, name: wanted.name, capacity: wanted.capacity, active: true })
          .where(eq(resources.id, current.id));
      }
    }

    for (const name of plan.resources.retire) {
      const current = resourceByName.get(normalise(name));
      if (current) {
        await tx.update(resources).set({ active: false }).where(eq(resources.id, current.id));
      }
    }

    const currentServices = plan.isNew
      ? []
      : await tx.select().from(services).where(eq(services.tenantId, tenantId));
    const serviceByName = new Map(currentServices.map((s) => [normalise(s.name), s]));

    for (const wanted of config.services) {
      const current = serviceByName.get(normalise(wanted.name));

      if (!current) {
        await tx.insert(services).values({
          tenantId,
          name: wanted.name,
          durationMinutes: wanted.durationMinutes,
          capacity: wanted.capacity,
          bufferBeforeMinutes: wanted.bufferBeforeMinutes,
          priceMinor: wanted.priceMinor,
          source: SOURCE,
        });
      } else {
        await tx
          .update(services)
          .set({
            name: wanted.name,
            durationMinutes: wanted.durationMinutes,
            capacity: wanted.capacity,
            bufferBeforeMinutes: wanted.bufferBeforeMinutes,
            priceMinor: wanted.priceMinor,
            source: SOURCE,
            active: true,
          })
          .where(eq(services.id, current.id));
      }
    }

    for (const name of plan.services.retire) {
      const current = serviceByName.get(normalise(name));
      if (current) {
        await tx.update(services).set({ active: false }).where(eq(services.id, current.id));
      }
    }

    if (plan.isNew || plan.hours.changed) {
      await tx
        .delete(availabilityRules)
        .where(and(eq(availabilityRules.tenantId, tenantId), isNull(availabilityRules.resourceId)));

      await tx.insert(availabilityRules).values(
        config.hours.map((hours) => ({
          tenantId,
          resourceId: null,
          weekday: hours.weekday,
          opensAt: hours.opensAt,
          closesAt: hours.closesAt,
        })),
      );
    }
  });

  // A slug's settings may have changed; the next request must not read a stale row.
  clearTenantCache(db, config.slug);

  return { plan, written: true };
}
