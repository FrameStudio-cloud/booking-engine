// TodayPage.jsx — /dashboard (§6.3).
import { todayIso, bookings as allBookings, stats, EMPTY_TODAY } from "../mock.js";
import StatStrip from "./StatStrip.jsx";
import Timeline from "./Timeline.jsx";

const todayBookings = allBookings.filter((b) => b.startsAt.slice(0, 10) === todayIso);

export default function TodayPage() {
  return (
    <div className="space-y-8">
      <StatStrip />

      {EMPTY_TODAY ? (
        <div className="rounded-[14px] border border-ink/10 bg-white/60 p-12 text-center">
          <p className="text-base text-ink/60">No bookings today. The day is open.</p>
          <p className="mt-2 text-sm text-ink/40">The bot is still answering.</p>
        </div>
      ) : (
        <Timeline bookings={todayBookings} />
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
