import { useEffect, useState } from "react";
import Header from "./components/Header.jsx";
import Hero from "./components/Hero.jsx";
import Section from "./components/Section.jsx";
import StepList from "./components/StepList.jsx";
import ChannelList from "./components/ChannelList.jsx";
import TypeTable from "./components/TypeTable.jsx";
import Pricing from "./components/Pricing.jsx";
import Footer from "./components/Footer.jsx";
import DashShell from "./components/DashShell.jsx";
import TodayPage from "./components/TodayPage.jsx";
import BookingsPage from "./components/BookingsPage.jsx";
import InboxPage from "./components/InboxPage.jsx";
import SetupPage from "./components/SetupPage.jsx";

// Copied verbatim from the current App.jsx (§4 rule 4 — the only network call).
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

  // ~25 line hash router (§6.1)
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || "/");
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const isDashboard = route.startsWith("dashboard");

  // Dashboard sub-route
  let dashTitle = "Today";
  let dashPage = <TodayPage />;
  if (route === "dashboard/bookings") {
    dashTitle = "Bookings";
    dashPage = <BookingsPage />;
  } else if (route === "dashboard/inbox" || route.startsWith("dashboard/inbox/")) {
    dashTitle = "Inbox";
  } else if (route === "dashboard/setup") {
    dashTitle = "Setup";
    dashPage = <SetupPage />;
  }

  const inboxId = route.startsWith("dashboard/inbox/")
    ? route.split("/").pop()
    : null;

  return (
    <div className="min-h-screen bg-paper">
      {!isDashboard ? (
        <>
          <Header health={health} />
          <main className="relative">
            <Hero />

            <section id="how-it-works">
              {/* 5.3 The problem */}
              <Section
                eyebrow="The problem"
                title="A missed call is a booking somebody else got."
                lede="Most small businesses answer bookings between customers, between shifts, after closing. The customer doesn't wait — they message the next salon on the list."
              >
                <div className="mt-10 border-t border-ink/10 pt-8">
                  <div className="flex gap-12 border-b border-ink/10 pb-8 text-[0.875rem]">
                    <div className="flex-1 border-r border-ink/10 pr-8 last:border-0">
                      <p className="font-mono tabular-nums text-[1.5rem] font-semibold text-ink leading-none">~40%</p>
                      <p className="mt-1 text-[0.75rem] uppercase tracking-[0.16em] text-ink/40">
                        of enquiries arrive outside working hours
                      </p>
                    </div>
                    <div className="flex-1 border-r border-ink/10 pr-8 last:border-0">
                      <p className="font-mono tabular-nums text-[1.5rem] font-semibold text-ink leading-none">2 min</p>
                      <p className="mt-1 text-[0.75rem] uppercase tracking-[0.16em] text-ink/40">
                        median reply before a customer tries elsewhere
                      </p>
                    </div>
                    <div className="flex-1">
                      <p className="font-mono tabular-nums text-[1.5rem] font-semibold text-ink leading-none">1 in 5</p>
                      <p className="mt-1 text-[0.75rem] uppercase tracking-[0.16em] text-ink/40">
                        bookings lost to a slow reply
                      </p>
                    </div>
                  </div>
                  <p className="mt-6 text-[0.75rem] text-ink/40">
                    illustrative — replace with your own numbers before launch
                  </p>
                </div>
              </Section>

              {/* 5.4 How it works */}
              <Section
                eyebrow="How it works"
                title="From a message to a held spot, in three steps."
              >
                <StepList />
              </Section>

              {/* 5.5 Channels */}
              <Section eyebrow="Channels" title="Where your customers already are.">
                <ChannelList />
              </Section>

              {/* 5.6 Business types */}
              <Section eyebrow="Business types" title="One engine, any slot shape.">
                <TypeTable />
              </Section>

              {/* 5.7 Pricing */}
              <Section id="pricing" eyebrow="Pricing" title="Two lines, no theatre.">
                <Pricing />
              </Section>
            </section>

            <Footer />
          </main>
        </>
      ) : (
        <DashShell
          title={dashTitle}
          route={route}
          health={health}
        >
          {route === "dashboard/inbox" || route.startsWith("dashboard/inbox/")
            ? <InboxPage initialId={inboxId} />
            : dashPage}
        </DashShell>
      )}
    </div>
  );
}
