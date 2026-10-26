// SetupPage.jsx — /dashboard/setup (§6.6) on live engine data.
import { useState } from "react";
import { formatKES, getTenant, useAsync } from "../api.js";
import SetupBlock from "./SetupBlock.jsx";
import Skeleton from "./Skeleton.jsx";
import EngineOffline from "./EngineOffline.jsx";

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const snippet = `<script src="https://your-api-host/widget.js"
        data-tenant="glow-salon"></script>`;

export default function SetupPage() {
  const tenantQ = useAsync(getTenant, []);
  const [copied, setCopied] = useState(false);

  const services = tenantQ.data?.services?.filter((s) => s.active) ?? [];
  const resources = tenantQ.data?.resources?.filter((r) => r.active) ?? [];
  const rules = tenantQ.data?.rules ?? [];

  const hoursFor = (weekday) => {
    const rows = rules.filter((r) => r.weekday === weekday && !r.resourceId);
    if (rows.length === 0) return "Closed";
    return rows.map((r) => `${r.opensAt} – ${r.closesAt}`).join(", ");
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (tenantQ.error) {
    return <EngineOffline onRetry={tenantQ.retry} />;
  }

  return (
    <div className="space-y-6">
      <SetupBlock title="Services">
        {tenantQ.loading ? (
          <div className="p-4">
            <Skeleton variant="rows" count={3} />
          </div>
        ) : (
          <div className="divide-y divide-ink/10">
            {services.map((svc) => (
              <div key={svc.id} className="px-4 py-4 flex items-center justify-between last:pb-0">
                <div className="flex-1">
                  <p className="font-medium text-ink">{svc.name}</p>
                  <p className="text-[0.75rem] text-ink/40">
                    {svc.durationMinutes} min · buffer {svc.bufferBeforeMinutes} min
                  </p>
                </div>
                <p className="font-mono tabular-nums text-[0.875rem] text-ink">
                  KES {formatKES(svc.priceMinor)}
                </p>
              </div>
            ))}
          </div>
        )}
      </SetupBlock>

      <SetupBlock title="People and units">
        <div className="divide-y divide-ink/10">
          {resources.map((person) => (
            <div key={person.id} className="px-4 py-4 flex items-center justify-between last:pb-0">
              <div className="flex-1">
                <p className="font-medium text-ink">{person.name}</p>
                <p className="text-[0.75rem] text-ink/40">{person.kind}</p>
              </div>
              <p className="font-mono tabular-nums text-[0.875rem] text-ink">
                capacity {person.capacity}
              </p>
            </div>
          ))}
        </div>
      </SetupBlock>

      <SetupBlock title="Hours">
        <div className="divide-y divide-ink/10">
          {days.map((day, weekday) => (
            <div key={day} className="px-4 py-4 flex items-center justify-between last:pb-0">
              <p className="font-medium text-ink">{day}</p>
              <p className="font-mono tabular-nums text-[0.875rem] text-ink">
                {hoursFor(weekday)}
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
