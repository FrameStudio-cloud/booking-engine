// Section.jsx — eyebrow + heading + optional lede, used by every public section.
export default function Section({
  eyebrow,
  title,
  lede,
  className = "",
  children,
}) {
  return (
    <section className={`mb-20 sm:mb-32 settle relative ${className}`}>
      <div className="max-w-[1120px] mx-auto px-6 sm:px-8 relative">
        {eyebrow && (
          <p className="mb-2 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
            {eyebrow}
          </p>
        )}
        {title && (
          <h2 className="mb-3 text-[1.75rem] font-semibold tracking-[-0.02em] text-ink">
            {title}
          </h2>
        )}
        {lede && (
          <p className="mb-8 text-base leading-1.6 text-ink/60 max-w-2xl">
            {lede}
          </p>
        )}
        {children}
      </div>
    </section>
  );
}
