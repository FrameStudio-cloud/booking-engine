import { useEffect, useRef, useState } from "preact/hooks";

/**
 * The widget is a thin shell around the same engine the Telegram bot uses:
 * it posts a message, the server runs the one `handleInbound` pipeline, and the
 * reply comes back on the response. Nothing about availability or booking
 * lives in here.
 */

const GREETING =
  "Hi — I can check what's free and hold a spot for you. What are you after?";

const SESSION_RE = /^[A-Za-z0-9_-]{8,128}$/;

function sessionId(tenantSlug) {
  const key = `booking-engine:session:${tenantSlug}`;
  try {
    const existing = localStorage.getItem(key);
    if (existing && SESSION_RE.test(existing)) return existing;

    const fresh =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

    localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    // Private mode with storage disabled: the chat still works for this visit.
    return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

const timeLabel = (iso) =>
  iso
    ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

export function Widget({ tenantSlug, apiBase, businessName = "Glow Salon" }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("bot");
  const [messages, setMessages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState(null);

  const logRef = useRef(null);
  const inputRef = useRef(null);
  const session = useRef(sessionId(tenantSlug));

  const url = (path) => `${apiBase}${path}`;
  const base = () => url(`/api/tenants/${tenantSlug}/widget/messages`);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, open, notice]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Host sites open the chat with their own buttons:
  //   window.BookingWidget.open()
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("booking-widget:open", handler);
    return () => window.removeEventListener("booking-widget:open", handler);
  }, []);

  useEffect(() => {
    if (!open || loaded) return;
    let alive = true;

    fetch(`${base()}?sessionId=${encodeURIComponent(session.current)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (!alive) return;
        setMessages(data.messages ?? []);
        setStatus(data.status ?? "bot");
        setLoaded(true);
      })
      .catch(() => alive && setLoaded(true));

    return () => {
      alive = false;
    };
  }, [open, loaded]);

  async function handleSubmit(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    setInput("");
    setNotice(null);
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "user", text }]);
    setBusy(true);

    try {
      const res = await fetch(base(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: session.current, text }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);

      const replies = data.replies ?? [];
      setMessages((prev) => [
        ...prev,
        ...replies.map((reply, i) => ({
          id: `reply-${Date.now()}-${i}`,
          role: "assistant",
          text: reply,
        })),
      ]);

      setStatus(data.status ?? "bot");
      if (replies.length === 0) {
        setNotice("A team member has this chat open and will reply here.");
      }
    } catch (error) {
      const offline = error instanceof TypeError; // fetch never reached the server
      setNotice(
        offline || /50[23]/.test(error.message ?? "")
          ? "I can't reach the booking engine right now. Please try again in a moment."
          : error.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="bw-root">
      {open && (
        <div
          class="bw-panel"
          role="dialog"
          aria-label={`Chat with ${businessName}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <div class="bw-head">
            {businessName}
            <small>{status === "human" ? "A team member is replying" : "Usually replies instantly"}</small>
            <button class="bw-close" onClick={() => setOpen(false)} aria-label="Close chat">
              ×
            </button>
          </div>

          <div class="bw-log" ref={logRef} role="log" aria-live="polite">
            <div class="bw-msg assistant">{GREETING}</div>

            {messages.map((m) => (
              <div key={m.id} class={`bw-msg ${m.role === "user" ? "user" : "assistant"}`}>
                {m.text}
                {m.at && <span class="bw-time">{timeLabel(m.at)}</span>}
              </div>
            ))}

            {busy && (
              <div class="bw-msg assistant bw-typing" aria-label="Typing">
                <span />
                <span />
                <span />
              </div>
            )}

            {notice && <div class="bw-notice">{notice}</div>}
          </div>

          <form class="bw-form" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              value={input}
              onInput={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask about a service or a time…"
              aria-label="Message"
              maxLength={2000}
            />
            <button type="submit" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      )}

      <button
        class="bw-bubble"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close chat" : "Open chat"}
        aria-expanded={open}
      >
        {open ? "×" : "💬"}
      </button>
    </div>
  );
}
