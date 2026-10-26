// EmptyState.jsx — empty dashboard states (not an error).
export default function EmptyState({ eyebrow, title, body, action }) {
  return (
    <div className="py-16 text-center max-w-[42ch] mx-auto">
      {eyebrow && (
        <p className="mb-2 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
          {eyebrow}
        </p>
      )}
      <h3 className="text-[1.125rem] font-semibold text-ink leading-tight">
        {title}
      </h3>
      {body && (
        <p className="mt-2 text-[0.875rem] leading-1.6 text-ink/60">
          {body}
        </p>
      )}
      {action && (
        <div className="mt-6">
          {action.href ? (
            <a
              href={action.href}
              className="text-[0.875rem] font-medium text-ink underline underline-offset-2 hover:text-ink/60"
            >
              {action.label}
            </a>
          ) : (
            <button
              type="button"
              onClick={action.onClick}
              className="text-[0.875rem] font-medium text-ink underline underline-offset-2 hover:text-ink/60"
            >
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
