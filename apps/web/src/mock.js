// mock.js — the data contract for the booking-engine web shell.
// Money is stored in minor units (e.g. 250000 = KES 2,500). Dates are ISO strings
// in Africa/Nairobi local time (+03:00) so the ledger clock matches the spec.
// Everything here is fake data; the swap to the real API is a one-line change.

export const tenant = {
  slug: "glow-salon",
  name: "Glow Salon",
  timezone: "Africa/Nairobi",
  currency: "KES",
};

export const staff = [
  { id: "staff-grace", name: "Grace", kind: "staff" },
  { id: "staff-amani", name: "Amani", kind: "staff" },
];

export const services = [
  { id: "svc-braiding", name: "Braiding", durationMinutes: 120, priceMinor: 250000, bufferBeforeMinutes: 15 },
  { id: "svc-wash", name: "Wash and blow-dry", durationMinutes: 60, priceMinor: 120000, bufferBeforeMinutes: 10 },
  { id: "svc-trim", name: "Trim", durationMinutes: 45, priceMinor: 80000, bufferBeforeMinutes: 5 },
];

export const hours = {
  0: null,
  1: ["09:00", "18:00"],
  2: ["09:00", "18:00"],
  3: ["09:00", "18:00"],
  4: ["09:00", "18:00"],
  5: ["09:00", "18:00"],
  6: ["09:00", "18:00"],
};

// ---------------------------------------------------------------------------
// "Today" / "tomorrow" are computed relative to the current day so the shell
// always has something to show, no matter which day it's opened. Dates come
// from the business timezone, not UTC — at 01:00 EAT those disagree.
// ---------------------------------------------------------------------------

const nairobiDate = (date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(date);

export const todayIso = nairobiDate(new Date());
export const tomorrowIso = nairobiDate(new Date(Date.now() + 86400000));

const T = (dateIso, hhmm) => `${dateIso}T${hhmm}:00+03:00`;

export const bookings = [
  // Today — 6 bookings (Nairobi local clock time)
  {
    id: "bk-101",
    serviceId: "svc-braiding",
    staffId: "staff-grace",
    startsAt: T(todayIso, "09:00"),
    endsAt: T(todayIso, "11:00"),
    status: "confirmed",
    customerName: "Wanjiku Wairimu Njeri-Mwangi",
    source: "Telegram",
  },
  {
    id: "bk-102",
    serviceId: "svc-wash",
    staffId: "staff-amani",
    startsAt: T(todayIso, "09:30"),
    endsAt: T(todayIso, "10:30"),
    status: "confirmed",
    customerName: "Njeri Mwangi",
    source: "Widget",
  },
  {
    id: "bk-103",
    serviceId: "svc-trim",
    staffId: "staff-amani",
    startsAt: T(todayIso, "11:00"),
    endsAt: T(todayIso, "11:45"),
    status: "confirmed",
    customerName: "Aisha",
    source: "Telegram",
  },
  {
    id: "bk-104",
    serviceId: "svc-braiding",
    staffId: "staff-grace",
    startsAt: T(todayIso, "11:15"),
    endsAt: T(todayIso, "13:15"),
    status: "confirmed",
    customerName: "Wanjiku Mwangi",
    source: "Telegram",
  },
  {
    id: "bk-105",
    serviceId: "svc-wash",
    staffId: "staff-amani",
    startsAt: T(todayIso, "12:00"),
    endsAt: T(todayIso, "13:00"),
    status: "confirmed",
    customerName: "Grace Njeri",
    source: "Widget",
  },
  {
    id: "bk-106",
    serviceId: "svc-braiding",
    staffId: "staff-grace",
    startsAt: T(todayIso, "14:00"),
    endsAt: T(todayIso, "16:00"),
    status: "confirmed",
    customerName: "Aisha Njeri",
    source: "Telegram",
  },
  // Tomorrow — 2 bookings
  {
    id: "bk-201",
    serviceId: "svc-trim",
    staffId: "staff-amani",
    startsAt: T(tomorrowIso, "10:00"),
    endsAt: T(tomorrowIso, "10:45"),
    status: "confirmed",
    customerName: "Njeri Wanjiku",
    source: "Telegram",
  },
  {
    id: "bk-202",
    serviceId: "svc-braiding",
    staffId: "staff-grace",
    startsAt: T(tomorrowIso, "14:00"),
    endsAt: T(tomorrowIso, "16:00"),
    status: "confirmed",
    customerName: "Wanjiku",
    source: "Telegram",
  },
];

// Toggle for the empty-day state (§9). Set to true to render "no bookings today".
export const EMPTY_TODAY = false;

// ---------------------------------------------------------------------------
// Conversations (§6.5): three total, one escalated and unread.
// ---------------------------------------------------------------------------

const fourMinutesAgo = new Date(Date.now() - 4 * 60000).toISOString();

export const conversations = [
  {
    id: "conv-1",
    customerName: "Wanjiku Wairimu Njeri-Mwangi",
    channel: "Telegram",
    status: "needs_human",
    unread: true,
    messages: [
      { id: "m1", role: "user", text: "Hi, is there anything free this Saturday afternoon for a braid?", at: new Date(Date.now() - 2 * 60 * 60000).toISOString() },
      { id: "m2", role: "assistant", text: "I can check Grace's book for you. She has Saturday 14:00–16:00 open — shall I hold it?", at: new Date(Date.now() - 90 * 60000).toISOString() },
      { id: "m3", role: "user", text: "Yes please, but I need to bring my daughter too — can you fit a trim in as well?", at: fourMinutesAgo },
    ],
  },
  {
    id: "conv-2",
    customerName: "Aisha",
    channel: "Widget",
    status: "bot",
    unread: false,
    messages: [
      { id: "m4", role: "user", text: "What time do you open on weekdays?", at: new Date(Date.now() - 2 * 60 * 60000).toISOString() },
      { id: "m5", role: "assistant", text: "We're open Monday to Saturday, 09:00 to 18:00. Closed Sunday.", at: new Date(Date.now() - 100 * 60000).toISOString() },
    ],
  },
  {
    id: "conv-3",
    customerName: "Njeri Mwangi",
    channel: "Telegram",
    status: "human",
    unread: false,
    messages: [
      { id: "m6", role: "user", text: "Can I move my wash and blow-dry to tomorrow morning?", at: new Date(Date.now() - 3 * 60 * 60000).toISOString() },
      { id: "m7", role: "staff", text: "Sure — I've moved you to tomorrow 09:30. See you then.", at: new Date(Date.now() - 2 * 60 * 60000).toISOString() },
    ],
  },
];

// ---------------------------------------------------------------------------
// Stats — computed honestly from the mock bookings (§6.3, §7).
// Open window: Mon–Sat 09:00–18:00 = 540 minutes.
// ---------------------------------------------------------------------------

const openMinutes = 18 * 60 - 9 * 60; // 540

const todayBookings = bookings.filter((b) => b.startsAt.slice(0, 10) === todayIso);

const minutesOf = (iso) => {
  const [h, m] = iso.slice(11, 16).split(":").map(Number);
  return h * 60 + m;
};

/** Busy wall-clock minutes per person, with overlaps counted once. */
const unionMinutes = (intervals) => {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let start = null;
  let end = null;

  for (const [s, e] of sorted) {
    if (end === null || s > end) {
      if (end !== null) total += end - start;
      start = s;
      end = e;
    } else if (e > end) {
      end = e;
    }
  }

  return end === null ? 0 : total + (end - start);
};

const busyByStaff = staff.map((person) =>
  todayBookings
    .filter((b) => b.staffId === person.id)
    .map((b) => [minutesOf(b.startsAt), minutesOf(b.endsAt)]),
);

const bookedMinutes = busyByStaff.reduce((sum, intervals) => sum + unionMinutes(intervals), 0);
const capacityMinutes = openMinutes * staff.length;

const revenueMinor = todayBookings.reduce((sum, b) => {
  const svc = services.find((s) => s.id === b.serviceId);
  return sum + (svc ? svc.priceMinor : 0);
}, 0);

export const stats = {
  bookingsToday: todayBookings.length,
  revenueMinor,
  unanswered: conversations.filter((c) => c.unread).length,
  occupancy: capacityMinutes > 0 ? bookedMinutes / capacityMinutes : 0,
};

// ---------------------------------------------------------------------------
// Formatting helpers — Intl only, no date library (§7).
// ---------------------------------------------------------------------------

export function formatKES(minor) {
  const major = minor / 100;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(major);
}

export function formatTime(iso) {
  return new Intl.DateTimeFormat("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
  }).format(new Date(iso));
}

export function formatDate(iso) {
  return new Intl.DateTimeFormat("en-KE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Africa/Nairobi",
  }).format(new Date(iso));
}

export function formatRelative(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default {
  tenant,
  staff,
  services,
  hours,
  bookings,
  conversations,
  stats,
  formatKES,
  formatTime,
  formatDate,
  formatRelative,
};
