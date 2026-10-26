import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { addDays, toLocalDate, zonedTimeToUtc } from "@booking/core";
import { createDb } from "./client";
import {
  availabilityRules,
  bookings,
  resources,
  services,
  tenants,
} from "./schema";

for (const candidate of [resolve(process.cwd(), "../../.env"), resolve(process.cwd(), ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const db = createDb(url);

/**
 * Glow Salon — the demo tenant.
 * Idempotent: wipes the tenant by slug and rebuilds it, so re-running is safe.
 */
async function seed() {
  const TZ = "Africa/Nairobi";

  await db.delete(tenants).where(eq(tenants.slug, "glow-salon"));

  const [tenant] = await db
    .insert(tenants)
    .values({
      slug: "glow-salon",
      name: "Glow Salon",
      businessType: "salon",
      timezone: TZ,
      currency: "KES",
      facts: {
        address: "2nd floor, Thika Arcade, Mama Ngina Drive",
        parking: "Free parking behind the building after 5pm",
        payment: "Cash, M-Pesa or card at the salon",
        late: "Please arrive 5 minutes early. Over 15 minutes late we may shorten the service.",
        children: "Children are welcome, but please tell us so we book enough time.",
      },
    })
    .returning();

  if (!tenant) throw new Error("tenant insert failed");

  const staff = await db
    .insert(resources)
    .values([
      { tenantId: tenant.id, kind: "staff", name: "Grace", capacity: 1 },
      { tenantId: tenant.id, kind: "staff", name: "Amani", capacity: 1 },
    ])
    .returning();

  const grace = staff.find((s) => s.name === "Grace");

  const serviceRows = await db
    .insert(services)
    .values([
      {
        tenantId: tenant.id,
        name: "Braiding",
        durationMinutes: 120,
        capacity: 1,
        bufferBeforeMinutes: 15,
        priceMinor: 250_000,
      },
      {
        tenantId: tenant.id,
        name: "Wash and blow-dry",
        durationMinutes: 60,
        capacity: 1,
        bufferBeforeMinutes: 10,
        priceMinor: 120_000,
      },
      {
        tenantId: tenant.id,
        name: "Trim",
        durationMinutes: 45,
        capacity: 1,
        bufferBeforeMinutes: 5,
        priceMinor: 80_000,
      },
    ])
    .returning();

  await db.insert(availabilityRules).values(
    [1, 2, 3, 4, 5, 6].map((weekday) => ({
      tenantId: tenant.id,
      resourceId: null,
      weekday,
      opensAt: "09:00",
      closesAt: "18:00",
    })),
  );

  // One existing booking so the demo has something to work around.
  const tomorrow = addDays(toLocalDate(new Date(), TZ), 1);
  const braiding = serviceRows.find((s) => s.name === "Braiding");

  if (grace && braiding) {
    await db.insert(bookings).values({
      tenantId: tenant.id,
      serviceId: braiding.id,
      resourceId: grace.id,
      startsAt: zonedTimeToUtc(tomorrow, "11:00", TZ),
      endsAt: zonedTimeToUtc(tomorrow, "13:00", TZ),
      status: "confirmed",
      customerName: "Wanjiku",
      customerPhone: "+254700000000",
      source: "telegram",
    });
  }

  console.log(
    [
      `seeded ${tenant.name} (${tenant.slug})`,
      `  staff:    ${staff.map((s) => s.name).join(", ")}`,
      `  services: ${serviceRows.map((s) => s.name).join(", ")}`,
      `  hours:    Mon-Sat 09:00-18:00 ${TZ}`,
      `  existing: Grace, Braiding, ${tomorrow} 11:00-13:00`,
    ].join("\n"),
  );
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
