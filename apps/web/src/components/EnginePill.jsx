// EnginePill.jsx — engine status pill rendered from useEngineHealth() (copied verbatim into App.jsx).
export default function EnginePill({ health, className = "" }) {
  const online = health?.status === "ok";
  const checking = health === null;
  // Accent means "something is wrong", so offline gets it, healthy does not.
  const dot = checking ? "bg-ink/25" : online ? "bg-ink/60" : "bg-accent";
  const label = checking
    ? "checking engine"
    : online
    ? "engine online"
    : "engine offline";

  return (
    <span className={`inline-flex items-center gap-2 text-[0.75rem] font-medium ${className}`}>
      <span className={`h-[6px] w-[6px] rounded-full ${dot}`} aria-hidden="true" />
      <span className="text-ink/60">{label}</span>
    </span>
  );
}
