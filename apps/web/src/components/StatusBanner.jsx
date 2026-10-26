// StatusBanner.jsx — inbox status banner, three states (§6.5).
export default function StatusBanner({ status, staffName = "Grace", onTakeover, onHandback }) {
  const config = {
    bot: { tone: "calm", text: "The bot is handling this.", buttons: [] },
    needs_human: {
      tone: "escalated",
      text: "Waiting for a human since 4m.",
      buttons: [{ label: "Take over", onClick: onTakeover }],
    },
    human: {
      tone: "handed",
      text: `You are replying as ${staffName}.`,
      buttons: [{ label: "Hand back to bot", onClick: onHandback }],
    },
  };
  const c = config[status] || config.bot;

  const base =
    "rounded-[10px] px-4 py-3 text-[0.875rem] leading-1.6 border";
  const styles = {
    calm: `${base} border-ink/10 bg-white/60 text-ink/70`,
    escalated: `${base} border-accent bg-accent/5 text-accent`,
    handed: `${base} border-ink/10 bg-white text-ink`,
  };

  return (
    <div className={`mb-6 ${styles[c.tone]}`}>
      <p className="mb-2">{c.text}</p>
      <div className="flex gap-3">
        {c.buttons.map((b) => (
          <button
            key={b.label}
            onClick={b.onClick}
            title="wired in phase 5"
            className="rounded-lg bg-ink/10 px-3 py-1.5 text-[0.75rem] font-medium text-ink/60 transition-colors hover:bg-ink/20"
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
