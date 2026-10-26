// Timeline.jsx — staff-grouped day timeline used by Today and Bookings (§6.3, §6.4).
import { useMemo } from "react";
import { formatTime } from "../mock.js";
import { staff as allStaff, services as allServices } from "../mock.js";
import Pill from "./Pill.jsx";

const OPEN_START = 9 * 60; // 09:00
const OPEN_END = 18 * 60; // 18:00

function minutesOf(iso) {
  const [h, m] = iso.slice(11, 16).split(":").map(Number);
  return h * 60 + m;
}

function formatMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function Timeline({ bookings }) {
  const byStaff = useMemo(() => {
    const map = new Map();
    allStaff.forEach((s) => map.set(s.id, []));
    bookings.forEach((b) => {
      const arr = map.get(b.staffId) || [];
      arr.push(b);
      map.set(b.staffId, arr);
    });
    return map;
  }, [bookings]);

  const serviceById = useMemo(() => {
    const map = new Map();
    allServices.forEach((s) => map.set(s.id, s));
    return map;
  }, []);

  const staffBookings = useMemo(() => {
    return allStaff.map((s) => {
      const bs = (byStaff.get(s.id) || []).slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      return { staff: s, bookings: bs };
    });
  }, [byStaff]);

  return (
    <div className="divide-y divide-ink/10">
      {staffBookings.map(({ staff, bookings: bs }) => {
        const bookedMinutes = bs.reduce((sum, b) => sum + minutesOf(b.endsAt) - minutesOf(b.startsAt), 0);
        const hours = Math.floor(bookedMinutes / 60);
        const mins = bookedMinutes % 60;

        // Build blocks: free gaps + bookings across the open window.
        const blocks = [];
        let cursor = OPEN_START;
        for (const b of bs) {
          const start = minutesOf(b.startsAt);
          const end = minutesOf(b.endsAt);
          if (start > cursor) blocks.push({ kind: "free", start: cursor, end: start });
          blocks.push({ kind: "booking", booking: b, start, end });
          cursor = Math.max(cursor, end);
        }
        if (cursor < OPEN_END) blocks.push({ kind: "free", start: cursor, end: OPEN_END });

        return (
          <section key={staff.id} className="p-6 last:pb-0">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-ink">{staff.name}</p>
                <p className="text-[0.75rem] text-ink/40">
                  {hours}h {mins}m booked
                </p>
              </div>
            </div>
            <div className="space-y-1">
              {blocks.map((block, i) => {
                if (block.kind === "free") {
                  return (
                    <div
                      key={i}
                      className="border border-ink/10 border-dashed rounded-[10px] px-4 py-3 flex items-center justify-between"
                    >
                      <span className="font-mono tabular-nums text-[0.875rem] text-ink/40">
                        {formatMinutes(block.start)} – {formatMinutes(block.end)}
                      </span>
                      <span className="text-[0.875rem] font-medium text-ink/40">free</span>
                    </div>
                  );
                }
                const b = block.booking;
                const svc = serviceById.get(b.serviceId);
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[150px,1fr,auto,auto] gap-4 items-center px-4 py-3 border-b border-ink/5 last:border-b-0"
                  >
                    <span className="font-mono tabular-nums text-[0.875rem] text-ink min-w-[150px]">
                      {formatTime(b.startsAt)} – {formatTime(b.endsAt)}
                    </span>
                    <span className="text-[0.875rem] font-medium text-ink min-w-0 break-words">
                      {svc ? svc.name : "Service"}
                    </span>
                    <span className="text-[0.875rem] text-ink/60 min-w-0 break-words">
                      {b.customerName}
                    </span>
                    <Pill tone="confirmed">{b.status}</Pill>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
