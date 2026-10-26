import { findTimeSlots } from "../availability";
import type { AvailabilityStrategy, SlotQuery } from "../types";
import type { Slot } from "@booking/shared";

/**
 * Restaurant: a table x a time x a party size.
 * A table whose capacity is below the party is not a candidate at all,
 * which is the only real difference from the salon strategy.
 */
export const tableStrategy: AvailabilityStrategy = {
  businessType: "restaurant",
  findSlots: (query: SlotQuery): Slot[] => {
    const partySize = Math.max(1, query.partySize ?? 1);
    const bigEnough = query.resources.filter((r) => r.capacity >= partySize);
    if (bigEnough.length === 0) return [];

    return findTimeSlots({
      ...query,
      resources: bigEnough,
      // Seats are capacity, not parallel bookings: one party per table.
      capacity: Math.min(query.capacity, 1),
    });
  },
};
