import type { BusinessType } from "@booking/shared";
import type { AvailabilityStrategy } from "./types";
import { staffStrategy } from "./strategies/staff";
import { tableStrategy } from "./strategies/table";

export * from "./types";
export * from "./time";
export * from "./availability";
export * from "./booking";
export { staffStrategy } from "./strategies/staff";
export { tableStrategy } from "./strategies/table";
export { findStays } from "./strategies/range";

/**
 * Business type -> strategy. Adding a business type is:
 *   1. add it to businessTypeSchema in @booking/shared
 *   2. write a strategy (or reuse one)
 *   3. register it here
 */
export function getStrategy(businessType: BusinessType): AvailabilityStrategy {
  switch (businessType) {
    case "salon":
      return staffStrategy;
    case "restaurant":
      return tableStrategy;
    case "bnb":
      // Stays are computed by findStays (range semantics, not clock slots).
      // The interface stays satisfied so callers can treat all types alike.
      return {
        businessType: "bnb",
        findSlots: () => [],
      };
  }
}
