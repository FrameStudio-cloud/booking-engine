// StatesPreview.jsx — gallery of loading/empty/offline states.
import Skeleton from "./Skeleton.jsx";
import EmptyState from "./EmptyState.jsx";
import EngineOffline from "./EngineOffline.jsx";

export default function StatesPreview() {
  return (
    <div className="space-y-10">
      <div>
        <p className="mb-3 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
          Skeleton — rows
        </p>
        <Skeleton variant="rows" count={4} />
      </div>

      <div>
        <p className="mb-3 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
          Skeleton — table
        </p>
        <Skeleton variant="table" count={4} />
      </div>

      <div>
        <p className="mb-3 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
          Skeleton — thread
        </p>
        <Skeleton variant="thread" count={4} />
      </div>

      <div>
        <p className="mb-3 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
          EmptyState — Today
        </p>
        <EmptyState
          eyebrow="Today"
          title="No bookings yet today."
          body="When a customer messages, the booking appears here."
          action={{ label: "Open the inbox", href: "#/dashboard/inbox" }}
        />
      </div>

      <div>
        <p className="mb-3 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
          EmptyState — Inbox
        </p>
        <EmptyState
          eyebrow="Inbox"
          title="No conversations yet."
          body="When a customer messages the bot, the thread appears here."
          action={{ label: "Refresh", onClick: () => {} }}
        />
      </div>

      <div>
        <p className="mb-3 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
          EmptyState — Bookings
        </p>
        <EmptyState
          eyebrow="Bookings"
          title="Nothing booked for this day."
          body="The bot is still answering. Pick another day or wait for the next message."
        />
      </div>

      <div>
        <p className="mb-3 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
          EngineOffline — with Retry
        </p>
        <EngineOffline onRetry={() => {}} />
      </div>

      <div>
        <p className="mb-3 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
          EngineOffline — without Retry
        </p>
        <EngineOffline />
      </div>
    </div>
  );
}
