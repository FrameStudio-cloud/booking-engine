import type {
  AvailabilityException,
  AvailabilityRule,
  BusinessType,
  LocalDate,
  Slot,
  TimeOfDay,
} from "@booking/shared";

export interface BookableResource {
  id: string;
  name: string;
  /** How many simultaneous bookings this resource takes (usually 1). */
  capacity: number;
}

/** An existing booking or block, used only to check for collisions. */
export interface BusyInterval {
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
  /** Cancelled bookings are ignored. */
  status?: string;
}

export interface SlotQuery {
  timezone: string;
  /** Length of the thing being booked (salon: appointment, restaurant: dinner). */
  durationMinutes: number;
  /** How many bookings the service allows at once. */
  capacity: number;
  /** Gap needed before the start (turn-over, setup). */
  bufferBeforeMinutes: number;
  resources: BookableResource[];
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
  busy: BusyInterval[];
  /** Slots starting before this instant are dropped (usually `now`). */
  from: Date;
  dateFrom: LocalDate;
  dateTo: LocalDate;
  /** Granularity of candidate start times, e.g. 15 or 30 minutes. */
  slotStepMinutes: number;
  /** Minutes of breathing room between `from` and the earliest start. */
  minLeadMinutes?: number;
  maxResults?: number;
  /** Restaurant only: filters out tables smaller than the party. */
  partySize?: number;
}

export interface RangeQuery extends Omit<SlotQuery, "durationMinutes"> {
  /** BnB: nights per stay, supplied by the customer. */
  nights: number;
  /** BnB check-in / check-out wall-clock times. */
  checkInTime: TimeOfDay;
  checkOutTime: TimeOfDay;
}

/**
 * The one seam that differs per business type.
 * Everything above it (chat, agent, channels) is identical.
 */
export interface AvailabilityStrategy {
  readonly businessType: BusinessType;
  findSlots(query: SlotQuery): Slot[];
}

export interface WorkingWindow {
  opensAt: TimeOfDay;
  closesAt: TimeOfDay;
}
