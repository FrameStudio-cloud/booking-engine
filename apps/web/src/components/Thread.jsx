// Thread.jsx — message bubbles (§6.5).
import { formatTime } from "../api.js";

export default function Thread({ messages, staffName = "Staff" }) {
  const timeLabel = (iso) => formatTime(iso);

  return (
    <div role="log" aria-live="polite" className="space-y-4">
      {messages.map((m) => {
        const isUser = m.role === "user";
        const isStaff = m.role === "staff";
        return (
          <div key={m.id} className="relative mb-4">
            {isStaff && (
              <p className="mb-1 text-[0.7rem] font-medium uppercase tracking-[0.16em] text-ink/40">
                You · {staffName}
              </p>
            )}
            <div
              className={`max-w-[82%] rounded-[10px] px-4 py-3 text-[0.875rem] leading-1.6 ${
                isUser
                  ? "ml-auto bg-ink text-paper"
                  : isStaff
                  ? "border-l-2 border-ink bg-white/60 text-ink"
                  : "mr-auto bg-white/60 text-ink/90"
              }`}
            >
              {m.text}
            </div>
            <div className="flex justify-end">
              <span className={`text-[0.7rem] text-ink/40 ${isUser ? "ml-auto" : "mr-auto"}`}>
                {timeLabel(m.at)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
