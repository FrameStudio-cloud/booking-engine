// api.js — the only place the dashboard talks to the engine.
// Dev traffic goes through the Vite proxy, so every path is same-origin.

import { useCallback, useEffect, useState } from "react";

export const TENANT = "glow-salon";

const base = () => `/api/tenants/${TENANT}`;

async function request(path, init) {
  const res = await fetch(base() + path, {
    headers: { "content-type": "application/json" },
    ...init,
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return body;
}

export function getTenant() {
  return request("");
}

export function getBookings(date) {
  return request(`/bookings${date ? `?date=${date}` : ""}`);
}

export function getConversations() {
  return request("/conversations");
}

export function getThread(id) {
  return request(`/conversations/${id}`);
}

export function sendReply(id, text) {
  return request(`/conversations/${id}/reply`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function takeOver(id) {
  return request(`/conversations/${id}/takeover`, { method: "POST" });
}

export function handBack(id) {
  return request(`/conversations/${id}/handback`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Loading primitive: one loader, one result, one retry.
// ---------------------------------------------------------------------------

export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    loader()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) =>
        alive && setState({ data: null, error: error.message, loading: false }),
      );

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, retry };
}

// ---------------------------------------------------------------------------
// Date helpers. The browser clock is not the business clock.
// ---------------------------------------------------------------------------

const NAIROBI = "Africa/Nairobi";

export function localDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: NAIROBI }).format(date);
}

export function shiftDay(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return localDate(date);
}

const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: NAIROBI,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatTime(iso) {
  return clock.format(new Date(iso));
}

export function formatDate(iso) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: NAIROBI,
    weekday: "short",
    day: "numeric",
    month: "short",
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

export function formatKES(minor) {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(minor / 100);
}

/** Minutes past midnight on the business clock. */
export function minutesOf(iso) {
  const [h, m] = clock.format(new Date(iso)).split(":").map(Number);
  return h * 60 + m;
}

// ---------------------------------------------------------------------------
// Stats — computed from real rows, not invented.
// ---------------------------------------------------------------------------

const OPEN_MINUTES = 18 * 60 - 9 * 60; // Mon–Sat 09:00–18:00

function unionMinutes(intervals) {
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
}

export function computeStats({ bookings = [], conversations = [], staffCount = 0 }) {
  const live = bookings.filter((b) => b.status !== "cancelled");

  const byStaff = new Map();
  for (const booking of live) {
    const list = byStaff.get(booking.resourceId) ?? [];
    list.push([minutesOf(booking.startsAt), minutesOf(booking.endsAt)]);
    byStaff.set(booking.resourceId, list);
  }

  const bookedMinutes = [...byStaff.values()].reduce(
    (sum, intervals) => sum + unionMinutes(intervals),
    0,
  );
  const capacity = OPEN_MINUTES * Math.max(1, staffCount);

  return {
    bookingsToday: live.length,
    revenueMinor: live.reduce((sum, b) => sum + (b.priceMinor ?? 0), 0),
    unanswered: conversations.filter((c) => c.unread).length,
    occupancy: capacity > 0 ? bookedMinutes / capacity : 0,
  };
}
