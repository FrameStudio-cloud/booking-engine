// InboxList.jsx — conversation list pane (§6.5), live data.
import { formatRelative } from "../api.js";
import Pill from "./Pill.jsx";

export default function InboxList({ conversations, activeId, onSelect }) {
  const channelTone = (channel) => (channel === "telegram" ? "live" : "booked");
  const channelLabel = (channel) =>
    channel === "telegram" ? "Telegram" : channel === "widget" ? "Widget" : "WhatsApp";

  if (conversations.length === 0) {
    return (
      <div className="border-r border-ink/10 bg-white/60 flex flex-col">
        <p className="px-5 py-4 text-[0.875rem] text-ink/40">No conversations</p>
      </div>
    );
  }

  return (
    <div className="border-r border-ink/10 bg-white/60 flex flex-col">
      <ul className="flex-1 overflow-y-auto divide-y divide-ink/10">
        {conversations.map((c) => {
          const last = c.lastMessage;
          const active = activeId === c.id;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={active ? "true" : undefined}
                className={`w-full text-left px-5 py-4 flex items-center justify-between gap-3 transition-colors ${
                  active ? "bg-ink/5 border-l-3 border-ink pl-2" : "hover:bg-ink/5 border-l-3 border-transparent"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[0.875rem] font-semibold text-ink truncate">
                    {c.customerName || "Unknown customer"}
                    {c.unread && (
                      <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                    )}
                  </p>
                  <p className="text-[0.75rem] leading-1.4 text-ink/60 truncate">
                    {last ? last.text : "No messages yet"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Pill tone={channelTone(c.channel)}>{channelLabel(c.channel)}</Pill>
                  <p className="text-[0.7rem] text-ink/40">
                    {formatRelative(last ? last.at : c.updatedAt)}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
