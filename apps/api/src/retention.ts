import {
  purgeTenantMessages,
  retentionDays,
  type Database,
  type TenantRow,
} from "@booking/db";

/**
 * The retention pass, extracted from the scheduler so it can be tested.
 *
 * Each business has its own window. A salon that agreed to 30 days is not
 * cleaned on a neighbour's 90, so this loops tenants rather than issuing one
 * global cutoff.
 *
 * Returns counts only. Message content never leaves the database, and never
 * reaches a log line.
 */
export interface RetentionResult {
  tenantId: string;
  slug: string;
  days: number;
  deleted: number;
}

export async function runRetention(
  db: Database,
  tenants: TenantRow[],
  now: Date = new Date(),
): Promise<RetentionResult[]> {
  const results: RetentionResult[] = [];

  for (const tenant of tenants) {
    const days = retentionDays(tenant.settings ?? {});
    const cutoff = new Date(now.getTime() - days * 86_400_000);

    try {
      const deleted = await purgeTenantMessages(db, tenant.id, cutoff);
      results.push({ tenantId: tenant.id, slug: tenant.slug, days, deleted });
    } catch (error) {
      // One tenant's failure must not stop the others from being cleaned.
      results.push({ tenantId: tenant.id, slug: tenant.slug, days, deleted: -1 });
      console.error(`[retention] ${tenant.slug} failed`, error);
    }
  }

  return results;
}
