// SetupPage.jsx — /dashboard/setup (§6.6).
import { useState } from "react";
import { staff, services, hours } from "../mock.js";
import { formatKES } from "../mock.js";
import SetupBlock from "./SetupBlock.jsx";

const staffServiceCount = staff.map((s) => ({
  ...s,
  services: services.filter((sv) => {
    if (s.name === "Grace") return sv.id === "svc-braiding";
    return sv.id === "svc-wash" || sv.id === "svc-trim";
  }).length,
}));

const serviceStaff = {
  "svc-braiding": "Grace",
  "svc-wash": "Amani",
  "svc-trim": "Amani",
};

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const snippet = `<script src="https://your-domain/widget.js"
        data-tenant="glow-salon"
        data-api="https://api.your-domain.com"></script>`;

export default function SetupPage() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-6">
      <SetupBlock title="Services">
        <div className="divide-y divide-ink/10">
          {services.map((svc) => (
            <div key={svc.id} className="px-4 py-4 flex items-center justify-between last:pb-0">
              <div className="flex-1">
                <p className="font-medium text-ink">{svc.name}</p>
                <p className="text-[0.75rem] text-ink/40">
                  {serviceStaff[svc.id]} • {svc.durationMinutes} min • buffer {svc.bufferBeforeMinutes} min
                </p>
              </div>
              <p className="font-mono tabular-nums text-[0.875rem] text-ink">
                KES {formatKES(svc.priceMinor)}
              </p>
            </div>
          ))}
        </div>
      </SetupBlock>

      <SetupBlock title="Staff">
        <div className="divide-y divide-ink/10">
          {staffServiceCount.map((s) => (
            <div key={s.id} className="px-4 py-4 flex items-center justify-between last:pb-0">
              <div className="flex-1">
                <p className="font-medium text-ink">{s.name}</p>
                <p className="text-[0.75rem] text-ink/40">{s.kind}</p>
              </div>
              <p className="font-mono tabular-nums text-[0.875rem] text-ink">
                {s.services} service{s.services !== 1 ? "s" : ""}
              </p>
            </div>
          ))}
        </div>
      </SetupBlock>

      <SetupBlock title="Hours">
        <div className="divide-y divide-ink/10">
          {days.map((day, i) => (
            <div key={day} className="px-4 py-4 flex items-center justify-between last:pb-0">
              <p className="font-medium text-ink">{day}</p>
              <p className="font-mono tabular-nums text-[0.875rem] text-ink">
                {i === 6 ? "Closed" : "09:00 – 18:00"}
              </p>
            </div>
          ))}
        </div>
      </SetupBlock>

      <SetupBlock title="Embed">
        <div className="px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <pre className="flex-1 rounded-[10px] border border-ink/10 bg-white/60 p-4 text-[0.8rem] font-mono text-ink/80 overflow-x-auto">
            {snippet}
          </pre>
          <button
            onClick={handleCopy}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-soft"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </SetupBlock>
    </div>
  );
}
