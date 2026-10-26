// BookingsPage.jsx — /dashboard/bookings (§6.4).
import { useState } from "react";
import { todayIso, tomorrowIso, bookings as allBookings, formatDate } from "../mock.js";
import Timeline from "./Timeline.jsx";

const dayIsoFromOffset = (offset) => {
  const d = new Date(todayIso);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

export default function BookingsPage() {
  const [offset, setOffset] = useState(0);
  const date = dayIsoFromOffset(offset);
  const bookings = allBookings.filter((b) => b.startsAt.slice(0, 10) === date);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setOffset((o) => o - 1)}
          disabled={offset <= -1}
          className="rounded-lg border border-ink/10 px-3 py-2 text-[0.875rem] font-medium text-ink/60 disabled:text-ink/20 disabled:border-transparent disabled:cursor-not-allowed"
          aria-label="Previous day"
        >
          ‹
        </button>
        <span className="font-mono tabular-nums text-[0.875rem] font-semibold text-ink min-w-[120px] text-center">
          {formatDate(date)}
        </span>
        <button
          onClick={() => setOffset((o) => o + 1)}
          className="rounded-lg border border-ink/10 px-3 py-2 text-[0.875rem] font-medium text-ink/60"
          aria-label="Next day"
        >
          ›
        </button>
        <span className="ml-auto text-[0.75rem] text-ink/40">State only, no persistence</span>
      </div>

      {bookings.length === 0 ? (
        <div className="rounded-[14px] border border-ink/10 bg-white/60 p-12 text-center">
          <p className="text-base text-ink/60">Nothing booked. The bot is still answering.</p>
          <a
            href="#/dashboard"
            className="mt-4 inline-block text-sm font-medium text-ink underline underline-offset-2 hover:text-ink/60"
          >
            Back to Today
          </a>
        </div>
      ) : (
        <Timeline bookings={bookings} />
      )}
    </div>
  );
}
