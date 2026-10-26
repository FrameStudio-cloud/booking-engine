// Composer.jsx — real textarea that appends to local state (§6.5).
export default function Composer({ value, onChange, onSend }) {
  return (
    <div className="border-t border-ink/10 pt-4">
      <div className="flex gap-3">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          className="flex-1 rounded-[10px] border border-ink/10 bg-white px-4 py-3 text-[0.875rem] leading-1.6 text-ink focus:ring-0"
          placeholder="Type a reply…"
          rows={2}
        />
        <button
          onClick={onSend}
          disabled={!value.trim()}
          title="wired in phase 5"
          className="rounded-lg bg-ink px-4 py-3 text-[0.875rem] font-medium text-paper transition-colors disabled:bg-ink/20 disabled:text-ink/40 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  );
}
