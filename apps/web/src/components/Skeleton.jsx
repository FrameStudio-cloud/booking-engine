// Skeleton.jsx — loading placeholders (rows / table / thread).
export default function Skeleton({ variant = "rows", count = 3 }) {
  const n = Math.max(1, count);

  if (variant === "table") {
    return (
      <div role="status" className="border border-ink/10 rounded-[10px] bg-white/60 overflow-hidden">
        <span className="sr-only">Loading</span>
        <div className="px-6 py-3 border-b border-ink/10">
          <div className="h-3 w-32 bg-ink/5 rounded-[6px] settle" aria-hidden="true" />
        </div>
        <div className="divide-y divide-ink/10">
          {Array.from({ length: n }).map((_, i) => (
            <div key={i} className="px-6 py-4 flex items-center gap-4" style={{ minHeight: 44 }}>
              <div className="h-3 w-24 bg-ink/5 rounded-[6px] settle" aria-hidden="true" />
              <div className="h-3 w-40 bg-ink/5 rounded-[6px] settle" aria-hidden="true" />
              <div className="h-3 w-16 bg-ink/5 rounded-[6px] settle ml-auto" aria-hidden="true" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "thread") {
    return (
      <div role="status" className="space-y-4">
        <span className="sr-only">Loading</span>
        {Array.from({ length: n }).map((_, i) => {
          const left = i % 2 === 0;
          const h = i % 3 === 0 ? 64 : 48;
          return (
            <div
              key={i}
              className={`max-w-[80%] rounded-[10px] bg-ink/5 settle ${left ? "mr-auto" : "ml-auto"}`}
              style={{ height: h }}
              aria-hidden="true"
            />
          );
        })}
      </div>
    );
  }

  // rows (default)
  return (
    <div role="status" className="divide-y divide-ink/10 border border-ink/10 rounded-[10px] bg-white/60">
      <span className="sr-only">Loading</span>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="px-6 py-4" style={{ minHeight: 56 }} aria-hidden="true">
          <div className="h-3 w-40 bg-ink/5 rounded-[6px] settle" />
          <div className="mt-2 h-2.5 w-64 bg-ink/5 rounded-[6px] settle" />
        </div>
      ))}
    </div>
  );
}
