// DashShell.jsx — left rail + top bar + children (§6.2).
import EnginePill from "./EnginePill.jsx";
import EngineOffline from "./EngineOffline.jsx";

const NAV = [
  { key: "dashboard", label: "Today" },
  { key: "dashboard/bookings", label: "Bookings" },
  { key: "dashboard/inbox", label: "Inbox" },
  { key: "dashboard/setup", label: "Setup" },
];

const ICONS = {
  Today: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>`,
  Bookings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  Inbox: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="5" width="22" height="14" rx="2" ry="2"/><polyline points="16 7 12 11 8 7"/></svg>`,
  Setup: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-1A1.65 1.65 0 0 0 9 14a1.65 1.65 0 0 0-1-1.51l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h1a1.65 1.65 0 0 0 1-1.51 1.65 1.65 0 0 0-1-1.51l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82-.33h1a1.65 1.65 0 0 0 1 1.51V16a1.65 1.65 0 0 0 1 1.51z"/></svg>`,
};

export default function DashShell({ children, title, route, health, onRetry }) {
  const activeKey = (label) => {
    if (label === "Today") return route === "dashboard";
    if (label === "Bookings") return route === "dashboard/bookings";
    if (label === "Inbox") return route === "dashboard/inbox" || route.startsWith("dashboard/inbox/");
    if (label === "Setup") return route === "dashboard/setup";
    return false;
  };

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div className="flex flex-col h-screen bg-paper">
      {/* Top bar */}
      <header className="flex h-16 items-center justify-between border-b border-ink/10 bg-white/60 px-6 sm:px-8 shrink-0">
        <div className="text-[1rem] font-semibold text-ink">{title}</div>
        <div className="flex items-center gap-3">
          <EnginePill health={health} />
          <button
            disabled
            title="wired in phase 5"
            className="disabled:opacity-100 flex items-center gap-2 rounded-lg bg-ink/10 px-4 py-2 text-[0.875rem] font-medium text-ink/40 cursor-not-allowed"
            aria-disabled="true"
          >
            + New booking
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop rail */}
        <nav className="hidden sm:flex w-64 flex-col shrink-0 border-r border-ink/10 bg-white/60">
          <div className="p-6">
            <div className="mb-10 flex items-center gap-2">
              <div className="h-6 w-6 bg-ink flex items-center justify-center text-paper text-xs font-semibold">
                B
              </div>
              <span className="text-sm font-semibold tracking-tight">booking engine</span>
            </div>
            <div className="space-y-1">
              {NAV.map((item) => {
                const active = activeKey(item.label);
                return (
                  <a
                    key={item.key}
                    href={`#/${item.key}`}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
                      active
                        ? "border-l-3 border-ink bg-ink/5 text-ink"
                        : "border-l-3 border-transparent text-ink/60 hover:bg-ink/5"
                    }`}
                  >
                    {item.label}
                  </a>
                );
              })}
            </div>
          </div>
          <div className="mt-auto p-6 border-t border-ink/10">
            <p className="text-[0.75rem] leading-1.5 text-ink/50">
              Glow Salon · Africa/Nairobi
            </p>
          </div>
        </nav>

        <main className="flex-1 overflow-y-auto bg-paper">
          {(health?.status === "offline" || health?.status === "degraded") && (
            <div className="px-6 pt-6">
              <EngineOffline onRetry={onRetry} />
            </div>
          )}
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      {isMobile ? (
        <nav className="fixed bottom-0 left-0 right-0 h-20 border-t border-ink/10 bg-white/60 flex justify-around items-center px-4 z-30">
          {NAV.map((item) => {
            const active = activeKey(item.label);
            return (
              <a
                key={item.key}
                href={`#/${item.key}`}
                className="flex flex-col items-center gap-1 px-2 py-1.5 transition-colors"
              >
                <span
                  className={`h-4 w-4 shrink-0 ${
                    active ? "text-ink" : "text-ink/40"
                  }`}
                  dangerouslySetInnerHTML={{ __html: ICONS[item.label] }}
                />
                <span className={`text-[0.65rem] leading-none font-medium ${
                  active ? "text-ink" : "text-ink/40"
                }`}>
                  {item.label}
                </span>
              </a>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
