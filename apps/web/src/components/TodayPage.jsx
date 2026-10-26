// TodayPage.jsx — /dashboard (§6.3) on live engine data.
import { useMemo } from "react";
import {
  computeStats,
  getBookings,
  getConversations,
  getTenant,
  localDate,
  useAsync,
} from "../api.js";
import StatStrip from "./StatStrip.jsx";
import Timeline from "./Timeline.jsx";
import Skeleton from "./Skeleton.jsx";
import EmptyState from "./EmptyState.jsx";
import EngineOffline from "./EngineOffline.jsx";

export default function TodayPage() {
  const today = useMemo(() => localDate(), []);

  const bookingsQ = useAsync(() => getBookings(today), [today]);
  const conversationsQ = useAsync(getConversations, []);
  const tenantQ = useAsync(getTenant, []);

  const staff = tenantQ.data?.resources?.filter((r) => r.active) ?? [];
  const bookings = bookingsQ.data?.bookings ?? [];
  const conversations = conversationsQ.data?.conversations ?? [];

  const stats = computeStats({
    bookings,
    conversations,
    staffCount: staff.length,
  });

  const failed = bookingsQ.error || conversationsQ.error || tenantQ.error;

  if (failed) {
    return (
      <EngineOffline
        onRetry={() => {
          bookingsQ.retry();
          conversationsQ.retry();
          tenantQ.retry();
        }}
      />
    );
  }

  return (
    <div className="space-y-8">
      <StatStrip stats={stats} loading={bookingsQ.loading || conversationsQ.loading} />

      {bookingsQ.loading || tenantQ.loading ? (
        <Skeleton variant="rows" count={3} />
      ) : bookings.length === 0 ? (
        <EmptyState
          eyebrow="Today"
          title="No bookings yet today."
          body="When a customer messages, the booking appears here."
          action={{ label: "Open the inbox", href: "#/dashboard/inbox" }}
        />
      ) : (
        <Timeline bookings={bookings} staff={staff} />
      )}

      {stats.unanswered > 0 && (
        <div className="rounded-[10px] border border-ink/10 bg-white/60 p-4">
          <p className="text-sm text-ink/60">
            {stats.unanswered} unanswered conversation —{" "}
            <a
              href="#/dashboard/inbox"
              className="text-ink font-medium underline underline-offset-2 hover:text-ink/60"
            >
              open inbox
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
