// Composer.jsx — staff reply box. Enter sends, Shift+Enter breaks the line.
export default function Composer({ value, onChange, onSend, disabled = false }) {
  return (
    <div className="border-t border-ink/10 pt-4">
      <div className="flex gap-3">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!disabled) onSend();
            }
          }}
          className="flex-1 rounded-[10px] border border-ink/10 bg-white px-4 py-3 text-[0.875rem] leading-1.6 text-ink focus:ring-0"
          placeholder="Type a reply…"
          rows={2}
          aria-label="Reply to the customer"
        />
        <button
          onClick={onSend}
          disabled={disabled || !value.trim()}
          className="rounded-lg bg-ink px-4 py-3 text-[0.875rem] font-medium text-paper transition-colors disabled:bg-ink/20 disabled:text-ink/40 disabled:cursor-not-allowed"
        >
          {disabled ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
