// Pricing.jsx — 2-line pricing + CTA (§5.7).
import { formatKES } from "../mock.js";

export default function Pricing() {
  return (
    <div className="border border-ink/10 rounded-[14px] bg-white/60 p-8 sm:p-12">
      <div className="mb-6 max-w-xl">
        <p className="mb-3 text-[1.25rem] font-semibold text-ink leading-1.4">
          <span className="font-mono tabular-nums text-ink">KES {formatKES(500000)}</span>{" "}
          setup — bot, widget, your services and hours
        </p>
        <p className="text-[1.25rem] font-semibold text-ink leading-1.4">
          <span className="font-mono tabular-nums text-ink">KES {formatKES(150000)}</span>{" "}
          per month — hosting, updates, one change per month
        </p>
      </div>
      <p className="mb-8 text-[0.75rem] leading-1.6 text-ink/40 max-w-xl">
        Numbers are a placeholder. Confirm before publishing.
      </p>
      <a
        href="https://wa.me/"
        target="_blank"
        rel="noopener"
        className="bg-accent rounded-lg px-5 py-2.5 text-[0.875rem] font-medium text-paper transition-colors hover:bg-ink-soft"
      >
        Book a demo
      </a>
    </div>
  );
}
