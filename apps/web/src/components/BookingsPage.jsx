// BookingsPage.jsx — /dashboard/bookings (§6.4) on live engine data.
import { useMemo, useState } from "react";
import {
  formatDate,
  getBookings,
  getTenant,
  localDate,
  shiftDay,
  useAsync,
} from "../api.js";
import Timeline from "./Timeline.jsx";
import Skeleton from "./Skeleton.jsx";
import EmptyState from "./EmptyState.jsx";
import EngineOffline from "./EngineOffline.jsx";

export default function BookingsPage() {
  const [offset, setOffset] = useState(0);
  const date = useMemo(() => shiftDay(localDate(), offset), [offset]);

  const bookingsQ = useAsync(() => getBookings(date), [date]);
  const tenantQ = useAsync(getTenant, []);

  const staff = tenantQ.data?.resources?.filter((r) => r.active) ?? [];
  const bookings = bookingsQ.data?.bookings ?? [];

  if (bookingsQ.error || tenantQ.error) {
    return (
      <EngineOffline
        onRetry={() => {
          bookingsQ.retry();
          tenantQ.retry();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setOffset((o) => o - 1)}
          className="rounded-lg border border-ink/10 px-3 py-2 text-[0.875rem] font-medium text-ink/60 disabled:text-ink/20 disabled:border-transparent disabled:cursor-not-allowed"
          aria-label="Previous day"
        >
          ‹
        </button>
        <span className="font-mono tabular-nums text-[0.875rem] font-semibold text-ink min-w-[120px] text-center">
          {formatDate(`${date}T12:00:00+03:00`)}
        </span>
        <button
          onClick={() => setOffset((o) => o + 1)}
          className="rounded-lg border border-ink/10 px-3 py-2 text-[0.875rem] font-medium text-ink/60"
          aria-label="Next day"
        >
          ›
        </button>
        {offset !== 0 && (
          <button
            onClick={() => setOffset(0)}
            className="text-[0.75rem] font-medium text-ink/60 underline underline-offset-2 hover:text-ink"
          >
            Today
          </button>
        )}
      </div>

      {bookingsQ.loading || tenantQ.loading ? (
        <Skeleton variant="table" count={5} />
      ) : bookings.length === 0 ? (
        <EmptyState
          eyebrow={formatDate(`${date}T12:00:00+03:00`)}
          title="Nothing booked this day."
          body="The bot is still answering. Slots stay open until someone takes them."
          action={{ label: "Back to today", href: "#/dashboard" }}
        />
      ) : (
        <Timeline bookings={bookings} staff={staff} />
      )}
    </div>
  );
}
