// InboxList.jsx — conversation list pane (§6.5).
import { formatRelative } from "../mock.js";
import Pill from "./Pill.jsx";

export default function InboxList({ conversations, activeId, onSelect }) {
  const channelTone = (channel) => (channel === "Telegram" ? "live" : "booked");

  return (
    <div className="border-r border-ink/10 bg-white/60 flex flex-col">
      <ul className="flex-1 overflow-y-auto divide-y divide-ink/10">
        {conversations.map((c) => {
          const last = c.messages[c.messages.length - 1];
          const active = activeId === c.id;
          return (
            <li
              key={c.id}
              onClick={() => onSelect(c.id)}
              role="button"
              tabIndex={0}
              className={`px-5 py-4 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                active
                  ? "bg-ink/5 border-l-3 border-ink pl-2"
                  : "hover:bg-ink/5"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[0.875rem] font-semibold text-ink truncate">
                  {c.customerName}
                  {c.unread && (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                  )}
                </p>
                <p className="text-[0.75rem] leading-1.4 text-ink/60 truncate">
                  {last.text}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Pill tone={channelTone(c.channel)}>{c.channel}</Pill>
                <p className="text-[0.7rem] text-ink/40">
                  {formatRelative(last.at)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
