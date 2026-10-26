// InboxPage.jsx — /dashboard/inbox (§6.5) on live engine data.
import { useCallback, useEffect, useState } from "react";
import {
  getConversations,
  getThread,
  handBack,
  sendReply,
  takeOver,
} from "../api.js";
import InboxList from "./InboxList.jsx";
import Thread from "./Thread.jsx";
import StatusBanner from "./StatusBanner.jsx";
import Composer from "./Composer.jsx";
import Skeleton from "./Skeleton.jsx";
import EmptyState from "./EmptyState.jsx";
import EngineOffline from "./EngineOffline.jsx";

const POLL_MS = 8000;

export default function InboxPage({ initialId }) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(initialId || null);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [view, setView] = useState(isMobile ? "list" : "split");

  const loadConversations = useCallback(async () => {
    const data = await getConversations();
    setConversations(data.conversations);
    setError(null);
    return data.conversations;
  }, []);

  const loadThread = useCallback(async (id) => {
    if (!id) return;
    const data = await getThread(id);
    setActive(data.conversation);
    setMessages(data.messages);
  }, []);

  // First load: pick the interrupted thread, else the newest.
  useEffect(() => {
    let alive = true;

    loadConversations()
      .then((rows) => {
        if (!alive) return;
        const preferred =
          rows.find((c) => c.id === initialId) ??
          rows.find((c) => c.unread) ??
          rows[0] ??
          null;
        setActiveId(preferred?.id ?? null);
        if (!preferred) setLoading(false);
      })
      .catch((err) => alive && (setError(err.message), setLoading(false)));

    return () => {
      alive = false;
    };
  }, [initialId, loadConversations]);

  useEffect(() => {
    if (!activeId) return;
    let alive = true;

    setLoading(true);
    loadThread(activeId)
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [activeId, loadThread]);

  // Keep the inbox honest while it is open.
  useEffect(() => {
    const timer = setInterval(() => {
      loadConversations().catch(() => {});
      if (activeId) loadThread(activeId).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [activeId, loadConversations, loadThread]);

  const select = (id) => {
    setActiveId(id);
    if (isMobile) setView("thread");
  };

  const takeOverThread = async () => {
    if (!activeId) return;
    await takeOver(activeId);
    setActive((c) => (c ? { ...c, status: "human" } : c));
    loadConversations().catch(() => {});
  };

  const handBackThread = async () => {
    if (!activeId) return;
    await handBack(activeId);
    setActive((c) => (c ? { ...c, status: "bot" } : c));
    loadConversations().catch(() => {});
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !activeId || sending) return;

    setSending(true);
    try {
      const result = await sendReply(activeId, text);
      setMessages((rows) => [...rows, result.message]);
      setDraft("");
      setActive((c) => (c ? { ...c, status: "human" } : c));

      if (result.delivered === false) {
        setError(`Saved, but not delivered: ${result.error ?? "unknown reason"}`);
      }
      loadConversations().catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  if (error && conversations.length === 0) {
    return (
      <EngineOffline
        onRetry={() => {
          setLoading(true);
          loadConversations()
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
        }}
      />
    );
  }

  const list = (
    <InboxList conversations={conversations} activeId={activeId} onSelect={select} />
  );

  const threadPane = (
    <div className="flex-1 flex flex-col overflow-hidden bg-paper">
      {loading && messages.length === 0 ? (
        <div className="p-6">
          <Skeleton variant="thread" count={4} />
        </div>
      ) : active ? (
        <div className="flex flex-col">
          {error && (
            <div className="mb-3 rounded-[10px] border border-accent bg-accent/5 px-4 py-3 text-[0.875rem] text-ink">
              {error}
            </div>
          )}
          <Thread messages={messages} />
          <StatusBanner
            status={active.status}
            onTakeover={takeOverThread}
            onHandback={handBackThread}
          />
          <Composer value={draft} onChange={setDraft} onSend={send} disabled={sending} />
        </div>
      ) : (
        <EmptyState
          eyebrow="Inbox"
          title="No conversations yet."
          body="When someone messages your Telegram bot or the website widget, the thread appears here."
        />
      )}
    </div>
  );

  if (!isMobile) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex flex-1 overflow-hidden">
          {list}
          {threadPane}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {view === "list" ? (
        <div className="flex-1 overflow-y-auto">{list}</div>
      ) : (
        <div className="flex-1 flex flex-col overflow-y-auto bg-paper">
          <button
            onClick={() => setView("list")}
            className="px-6 py-3 text-[0.75rem] font-medium text-ink/60 hover:text-ink"
            aria-label="Back to conversation list"
          >
            ← Back
          </button>
          {threadPane}
        </div>
      )}
    </div>
  );
}
