// EngineOffline.jsx — one-line stale-data banner.
export default function EngineOffline({ onRetry }) {
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-4 rounded-[10px] border border-accent bg-accent/5 px-4 py-3"
    >
      <p className="text-[0.875rem] leading-1.6 text-ink">
        The engine is unreachable. Bookings and chats may be out of date.
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 text-[0.875rem] font-medium text-accent underline underline-offset-2 hover:text-ink"
        >
          Retry
        </button>
      )}
    </div>
  );
}
