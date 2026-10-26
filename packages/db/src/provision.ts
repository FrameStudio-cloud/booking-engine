import { eq } from "drizzle-orm";
import type { TenantConfig } from "@booking/shared";
import { addDays, toLocalDate, zonedTimeToUtc } from "@booking/core";

import type { Database } from "./client";
import {
  availabilityRules,
  bookings,
  resources,
  services,
  tenants,
} from "./schema";

export interface ProvisionResult {
  tenantId: string;
  slug: string;
  name: string;
  resources: string[];
  services: string[];
  demoBooking: string | null;
}

/**
 * Turn one config file into a working business.
 *
 * Deliberately a *replace*: deleting the tenant cascades to its services,
 * hours, bookings and conversations, so re-running a config gives you exactly
 * what the file says. That is the right behaviour for onboarding and for demo
 * resets, and the wrong one for a live business with real bookings — hence the
 * warning in the CLI.
 */
export async function provisionTenant(
  db: Database,
  config: TenantConfig,
): Promise<ProvisionResult> {
  await db.delete(tenants).where(eq(tenants.slug, config.slug));

  const [tenant] = await db
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
      },
    })
    .returning();

  if (!tenant) throw new Error(`tenant insert failed for ${config.slug}`);

  const resourceRows = await db
    .insert(resources)
    .values(
      config.resources.map((resource) => ({
        tenantId: tenant.id,
        kind: resource.kind,
        name: resource.name,
        capacity: resource.capacity,
      })),
    )
    .returning();

  const serviceRows = await db
    .insert(services)
    .values(
      config.services.map((service) => ({
        tenantId: tenant.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        capacity: service.capacity,
        bufferBeforeMinutes: service.bufferBeforeMinutes,
        priceMinor: service.priceMinor,
      })),
    )
    .returning();

  await db.insert(availabilityRules).values(
    config.hours.map((hours) => ({
      tenantId: tenant.id,
      resourceId: null,
      weekday: hours.weekday,
      opensAt: hours.opensAt,
      closesAt: hours.closesAt,
    })),
  );

  let demoBooking: string | null = null;

  if (config.demoBooking) {
    const demo = config.demoBooking;
    const service = serviceRows.find((s) => s.name === demo.service);
    const resource = resourceRows.find((r) => r.name === demo.resource);

    if (!service || !resource) {
      throw new Error(
        `demoBooking refers to unknown service/resource: ${demo.service} / ${demo.resource}`,
      );
    }

    const day = addDays(toLocalDate(new Date(), config.timezone), demo.dayOffset);
    const startsAt = zonedTimeToUtc(day, demo.startsAt, config.timezone);
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);

    await db.insert(bookings).values({
      tenantId: tenant.id,
      serviceId: service.id,
      resourceId: resource.id,
      startsAt,
      endsAt,
      status: "confirmed",
      customerName: demo.customerName,
      source: demo.source,
    });

    demoBooking = `${demo.customerName} · ${service.name} · ${day} ${demo.startsAt}`;
  }

  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    resources: resourceRows.map((r) => `${r.name} (${r.kind})`),
    services: serviceRows.map(
      (s) => `${s.name} · ${s.durationMinutes}min · ${s.priceMinor / 100} ${config.currency}`,
    ),
    demoBooking,
  };
}
