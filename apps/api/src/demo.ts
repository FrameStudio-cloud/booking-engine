import type {
  AvailabilityRule,
  BusinessType,
  LocalDate,
  Service,
  Tenant,
} from "@booking/shared";
import { zonedTimeToUtc } from "@booking/core";

/**
 * In-memory demo tenant, used until the Neon database is provisioned.
 * It is deliberately shaped exactly like the rows in @booking/db, so
 * swapping it for real queries is a change of data source, not of logic.
 */

export const demoTenant: Tenant = {
  id: "tenant-demo-salon",
  slug: "glow-salon",
  name: "Glow Salon",
  businessType: "salon" as BusinessType,
  timezone: "Africa/Nairobi",
  currency: "KES",
  facts: {
    address: "2nd floor, Thika Arcade, Mama Ngina Drive",
    parking: "Free parking behind the building after 5pm",
    payment: "Cash, M-Pesa or card at the salon",
    late: "Please arrive 5 minutes early. Over 15 minutes late we may need to shorten the service.",
  },
};

export const demoStaff = [
  { id: "staff-grace", name: "Grace", capacity: 1 },
  { id: "staff-amani", name: "Amani", capacity: 1 },
];

export const demoServices: Service[] = [
  {
    id: "svc-braids",
    tenantId: demoTenant.id,
    name: "Braiding",
    durationMinutes: 120,
    capacity: 1,
    bufferBeforeMinutes: 15,
    priceMinor: 250_000,
    active: true,
  },
  {
    id: "svc-wash",
    tenantId: demoTenant.id,
    name: "Wash and blow-dry",
    durationMinutes: 60,
    capacity: 1,
    bufferBeforeMinutes: 10,
    priceMinor: 120_000,
    active: true,
  },
  {
    id: "svc-trim",
    tenantId: demoTenant.id,
    name: "Trim",
    durationMinutes: 45,
    capacity: 1,
    bufferBeforeMinutes: 5,
    priceMinor: 80_000,
    active: true,
  },
];

/** Monday to Saturday 09:00-18:00, closed Sunday. */
export const demoRules: AvailabilityRule[] = [1, 2, 3, 4, 5, 6].map((weekday, i) => ({
  id: `rule-${i}`,
  tenantId: demoTenant.id,
  resourceId: null,
  weekday,
  opensAt: "09:00",
  closesAt: "18:00",
}));

/** One existing booking so the demo visibly has to work around it. */
export function demoBusy(date: LocalDate, timezone: string) {
  return [
    {
      resourceId: "staff-grace",
      startsAt: zonedTimeToUtc(date, "11:00", timezone),
      endsAt: zonedTimeToUtc(date, "13:00", timezone),
      status: "confirmed",
    },
  ];
}
