// InboxPage.jsx — /dashboard/inbox (§6.5).
import { useEffect, useState } from "react";
import { conversations, formatRelative } from "../mock.js";
import InboxList from "./InboxList.jsx";
import Thread from "./Thread.jsx";
import StatusBanner from "./StatusBanner.jsx";
import Composer from "./Composer.jsx";

const defaultId = () => {
  const unread = conversations.find((c) => c.unread);
  return unread ? unread.id : conversations[0]?.id;
};

export default function InboxPage({ initialId }) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [activeId, setActiveId] = useState(initialId || defaultId());
  const [view, setView] = useState(isMobile ? "list" : "split");
  const [status, setStatus] = useState("bot");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");

  const active = conversations.find((c) => c.id === activeId);

  useEffect(() => {
    if (active) {
      setStatus(active.status);
      setMessages([...active.messages]);
      setView(isMobile ? "list" : "split");
    }
  }, [activeId, active, isMobile]);

  const select = (id) => {
    setActiveId(id);
    if (isMobile) setView("thread");
  };

  const takeOver = () => setStatus("human");
  const handBack = () => setStatus("bot");

  const send = () => {
    if (!draft.trim()) return;
    const staffMsg = {
      id: `m-${Date.now()}`,
      role: "staff",
      text: draft.trim(),
      at: new Date().toISOString(),
    };
    setMessages((ms) => [...ms, staffMsg]);
    setDraft("");
  };

  return (
    <div className="flex flex-col h-full">
      {!isMobile ? (
        <div className="flex flex-1 overflow-hidden">
          <InboxList
            conversations={conversations}
            activeId={activeId}
            onSelect={select}
          />
          <div className="flex-1 flex flex-col overflow-hidden bg-paper">
            {active ? (
              <div className="flex flex-col">
                <Thread messages={messages} />
                <StatusBanner
                  status={status}
                  onTakeover={takeOver}
                  onHandback={handBack}
                />
                <Composer value={draft} onChange={setDraft} onSend={send} />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center pt-20">
                <p className="text-ink/40">Select a conversation to open it.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {view === "list" ? (
            <div className="flex-1 overflow-y-auto">
              <InboxList
                conversations={conversations}
                activeId={activeId}
                onSelect={select}
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-y-auto bg-paper">
              <button
                onClick={() => setView("list")}
                className="px-6 py-3 text-[0.75rem] font-medium text-ink/60 hover:text-ink"
                aria-label="Back to conversation list"
              >
                ← Back
              </button>
              {active ? (
                <div className="px-6 pb-6 flex flex-col">
                  <Thread messages={messages} />
                  <StatusBanner
                    status={status}
                    onTakeover={takeOver}
                    onHandback={handBack}
                  />
                  <Composer value={draft} onChange={setDraft} onSend={send} />
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
