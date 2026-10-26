import { useEffect, useRef, useState } from "preact/hooks";

/**
 * Widget UI only. Wiring to the agent (SSE, conversation persistence,
 * staff takeover) is phase 4 — the small slot lookup below is a temporary
 * bridge so the bubble demonstrates the real engine end to end today.
 */

const GREETING = "Hi 👋 I can check availability and hold a spot for you. Ask me what's free.";

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function lookupSlots(apiBase, tenantSlug) {
  const url = `${apiBase}/api/tenants/${tenantSlug}/slots?date=${tomorrow()}&service=svc-trim`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`lookup failed (${res.status})`);
  return res.json();
}

export function Widget({ tenantSlug, apiBase }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([{ role: "assistant", text: GREETING }]);
  const logRef = useRef(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const push = (role, text) => setMessages((prev) => [...prev, { role, text }]);

  async function handleSubmit(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    setInput("");
    push("user", text);

    const wantsTimes = /free|available|slot|time|tomorrow|book/i.test(text);
    if (!wantsTimes) {
      push("assistant", "The booking agent connects in the next phase — ask me about tomorrow's times and I'll query the engine directly.");
      return;
    }

    setBusy(true);
    try {
      const data = await lookupSlots(apiBase, tenantSlug);
      if (data.slots.length === 0) {
        push("assistant", "Nothing free tomorrow, I'm afraid. Try another day?");
      } else {
        const times = data.slots
          .slice(0, 4)
          .map((s) =>
            new Date(s.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          )
          .join(", ");
        push("assistant", `Tomorrow I have ${times} with ${data.slots[0].resourceName}. Want one?`);
      }
    } catch {
      push("assistant", "I couldn't reach the engine just now. Please try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="bw-root">
      {open && (
        <div class="bw-panel" role="dialog" aria-label="Booking chat">
          <div class="bw-head">
            Glow Salon
            <small>Usually replies instantly</small>
          </div>

          <div class="bw-log" ref={logRef}>
            {messages.map((m, i) => (
              <div key={i} class={`bw-msg ${m.role}`}>
                {m.text}
              </div>
            ))}
          </div>

          <form class="bw-form" onSubmit={handleSubmit}>
            <input
              value={input}
              onInput={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask about availability…"
              aria-label="Message"
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
      >
        {open ? "×" : "💬"}
      </button>
    </div>
  );
}
