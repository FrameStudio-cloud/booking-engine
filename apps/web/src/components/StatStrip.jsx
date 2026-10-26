// StatStrip.jsx — four hairline-separated stat cells (§6.3).
import { formatKES } from "../api.js";

export default function StatStrip({ stats, loading = false }) {
  const cells = [
    { label: "Bookings today", value: String(stats?.bookingsToday ?? 0) },
    { label: "Revenue", value: `KES ${formatKES(stats?.revenueMinor ?? 0)}` },
    { label: "Unanswered", value: String(stats?.unanswered ?? 0) },
    { label: "Occupancy", value: `${Math.round((stats?.occupancy ?? 0) * 100)}%` },
  ];

  return (
    <div className="border border-ink/10 rounded-[14px] bg-white/60">
      <div className="grid grid-cols-4 divide-x divide-ink/10">
        {cells.map((cell) => (
          <div key={cell.label} className="px-6 py-4 last:border-r-0">
            <p className="text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
              {cell.label}
            </p>
            <p
              className={`mt-1 font-mono tabular-nums text-[1rem] font-semibold text-ink ${
                loading ? "opacity-30" : ""
              }`}
            >
              {cell.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
