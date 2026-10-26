// ChannelList.jsx — channel rows with status pills (§5.5).
import Pill from "./Pill.jsx";

const channels = [
  { name: "Telegram", tone: "live", body: "Customers message a bot. No app, no form." },
  { name: "Website widget", tone: "next", body: "One script tag. Same engine, your colours." },
  { name: "WhatsApp", tone: "later", body: "Same code path — the adapter is small." },
];

export default function ChannelList() {
  return (
    <div className="border border-ink/10 rounded-[14px] bg-white/60">
      <div className="divide-y divide-ink/10">
        {channels.map((c) => (
          <div key={c.name} className="px-6 py-4 flex items-center justify-between last:pb-0">
            <div className="flex items-center gap-4">
              <span className="font-medium text-ink">{c.name}</span>
              <Pill tone={c.tone}>{c.tone}</Pill>
            </div>
            <p className="text-[0.875rem] leading-1.6 text-ink/60 max-w-xs">
              {c.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
