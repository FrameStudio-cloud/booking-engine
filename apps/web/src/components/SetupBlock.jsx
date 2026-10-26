// SetupBlock.jsx — one read-only setup block (§6.6).
export default function SetupBlock({ title, children }) {
  return (
    <div className="border-b border-ink/10 last:border-b-0 py-6 last:pb-0">
      <h4 className="mb-3 text-[0.875rem] font-semibold uppercase tracking-[0.16em] text-ink/40">
        {title}
      </h4>
      {children}
    </div>
  );
}
