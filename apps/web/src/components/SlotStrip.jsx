// SlotStrip.jsx — the ledger-style availability panel (§5.2).
import Pill from "./Pill.jsx";

export default function SlotStrip() {
  const rows = [
    { time: "09:00", staff: "Grace", service: "Braiding", status: "free" },
    { time: "09:30", staff: "Amani", service: "Trim", status: "free" },
    { time: "10:00", staff: "Grace", service: "Braiding", status: "booked" },
    { time: "10:30", staff: "Amani", service: "Trim", status: "free" },
    { time: "11:00", staff: "Grace", service: "—", status: "booked" },
    { time: "12:00", staff: "Amani", service: "Wash &amp; blow-dry", status: "free" },
    { time: "14:00", staff: "Grace", service: "Braiding", status: "free" },
    { time: "15:30", staff: "Amani", service: "Trim", status: "free" },
  ];

  return (
    <div className="border border-ink/10 bg-white/60 rounded-[14px] p-5 sm:p-6">
      <div className="mb-4">
        <h3 className="text-[1.125rem] font-semibold text-ink">Tomorrow · Glow Salon</h3>
        <p className="mt-1 text-[0.75rem] text-ink/40">8 ledger rows · booking engine</p>
      </div>

      <div className="divide-y divide-ink/10">
        {rows.map((row, i) => (
          <div
            key={row.time}
            className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0 hover:bg-ink/5 transition-colors"
          >
            <div className="flex items-center gap-6">
              <span className="font-mono text-[0.875rem] tabular-nums text-ink">
                {row.time}
              </span>
              <span className="text-[0.875rem] font-medium text-ink/80">{row.staff}</span>
              <span className="text-[0.875rem] text-ink/60 max-w-[140px] truncate">
                {row.service}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {row.status === "booked" ? (
                <>
                  <span className="font-mono text-[0.875rem] tabular-nums text-ink/30 line-through">
                    —
                  </span>
                  <Pill tone="booked">booked</Pill>
                </>
              ) : (
                <span className="font-mono text-[0.875rem] tabular-nums text-ink/60">
                  —
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[0.75rem] font-medium text-ink/40">
        Booked by: Telegram · 2 min ago
      </p>
    </div>
  );
}
