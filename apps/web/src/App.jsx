import { useEffect, useState } from "react";

const channels = [
  {
    name: "Telegram",
    status: "building",
    body: "Customers ask for a Saturday slot and get one. No app to install, no form to fill.",
  },
  {
    name: "Chat widget",
    status: "planned",
    body: "One script tag. Same engine, same bookings, styled to sit quietly in the corner.",
  },
  {
    name: "Dashboard",
    status: "planned",
    body: "Staff see the day, take a booking, or jump into a chat the bot couldn't finish.",
  },
];

const presets = [
  { type: "Salon", slot: "staff × service × time", state: "first" },
  { type: "Stay", slot: "unit × date range", state: "next" },
  { type: "Restaurant", slot: "table × party × time", state: "next" },
];

const phaseStyles = {
  first: "bg-ink text-paper",
  next: "bg-white/60 text-ink/60 ring-1 ring-ink/10",
  building: "bg-accent/15 text-accent ring-1 ring-accent/30",
  planned: "bg-white/60 text-ink/50 ring-1 ring-ink/10",
};

function Pill({ children, tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium tracking-tight ${phaseStyles[tone]}`}
    >
      {children}
    </span>
  );
}

function useEngineHealth() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => alive && setHealth(data))
      .catch(() => alive && setHealth({ status: "offline" }));
    return () => {
      alive = false;
    };
  }, []);

  return health;
}

export default function App() {
  const health = useEngineHealth();
  const online = health?.status === "ok";

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-ink text-sm font-semibold text-paper">
            B
          </div>
          <span className="text-sm font-semibold tracking-tight">booking engine</span>
        </div>

        <div className="flex items-center gap-2 text-xs text-ink/50">
          <span
            className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-500" : "bg-ink/25"}`}
          />
          {health === null ? "checking engine" : online ? "engine online" : "engine offline"}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="pt-14 pb-20 sm:pt-24">
          <p className="mb-5 text-xs font-medium uppercase tracking-[0.18em] text-ink/45">
            Automation for small business
          </p>
          <h1 className="max-w-3xl text-[2.75rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">
            One booking engine.
            <span className="block text-ink/35">Every channel your customers use.</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-relaxed text-ink/60">
            Availability, bookings and the conversation around them live in one place.
            Telegram and the website are just two front doors to the same engine — add
            WhatsApp later without touching the logic.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href="#presets"
              className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-ink-soft"
            >
              See what it covers
            </a>
            <span className="text-xs text-ink/45">
              {health?.phase ? `build: ${health.phase}` : "phase 1 · schema + core"}
            </span>
          </div>
        </section>

        <section className="grid gap-4 border-t border-ink/10 py-14 sm:grid-cols-3">
          {channels.map((c) => (
            <article
              key={c.name}
              className="rounded-xl bg-white/70 p-5 ring-1 ring-ink/8 backdrop-blur"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-tight">{c.name}</h2>
                <Pill tone={c.status}>{c.status}</Pill>
              </div>
              <p className="text-sm leading-relaxed text-ink/55">{c.body}</p>
            </article>
          ))}
        </section>

        <section id="presets" className="border-t border-ink/10 py-14">
          <h2 className="text-lg font-semibold tracking-tight">Same engine, different slots</h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-ink/55">
            A business type is a config preset, not a separate product. Only the meaning of
            "a slot" changes.
          </p>

          <div className="mt-7 overflow-hidden rounded-xl ring-1 ring-ink/10">
            <table className="w-full border-collapse bg-white/70 text-left text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-xs uppercase tracking-[0.12em] text-ink/40">
                  <th className="px-5 py-3 font-medium">Business</th>
                  <th className="px-5 py-3 font-medium">A slot is</th>
                  <th className="px-5 py-3 font-medium">Build order</th>
                </tr>
              </thead>
              <tbody>
                {presets.map((p) => (
                  <tr key={p.type} className="border-b border-ink/6 last:border-0">
                    <td className="px-5 py-4 font-medium">{p.type}</td>
                    <td className="px-5 py-4 font-mono text-[13px] text-ink/60">{p.slot}</td>
                    <td className="px-5 py-4">
                      <Pill tone={p.state}>{p.state === "first" ? "demo" : "later"}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="mx-auto mt-10 max-w-6xl border-t border-ink/10 px-6 py-8 text-xs text-ink/40">
        Phase 1 — schema and core. Channels land next.
      </footer>
    </div>
  );
}
