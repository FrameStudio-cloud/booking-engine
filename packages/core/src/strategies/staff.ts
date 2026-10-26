import { findTimeSlots } from "../availability";
import type { AvailabilityStrategy, SlotQuery } from "../types";
import type { Slot } from "@booking/shared";

/**
 * Salon: appointment length x staff member x start time.
 * Nothing special beyond the shared slot engine — that's the point.
 */
export const staffStrategy: AvailabilityStrategy = {
  businessType: "salon",
  findSlots: (query: SlotQuery): Slot[] => findTimeSlots(query),
};
