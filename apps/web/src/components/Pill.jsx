// Pill.jsx — tone-based status pill. One accent used at most twice per screen.
export default function Pill({ children, tone = "later", className = "" }) {
  const base =
    "inline-flex items-center rounded-full text-xs font-medium tracking-tight";
  const styles = {
    live: `${base} text-ink bg-white`,
    // Ink, not accent: a status pill is information, not an alarm.
    next: `${base} bg-ink text-paper`,
    later: `${base} text-ink/40`,
    booked: `${base} bg-ink/10 text-ink/40 px-2 py-1`,
    confirmed: `${base} bg-ink/10 text-ink/70 ring-1 ring-ink/10`,
  };
  return <span className={`${styles[tone]} ${className}`}>{children}</span>;
}
