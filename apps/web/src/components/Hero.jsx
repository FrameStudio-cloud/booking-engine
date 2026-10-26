// Hero.jsx — hero + slot strip (§5.2).
import SlotStrip from "./SlotStrip.jsx";

export default function Hero() {
  return (
    <section className="relative py-20 sm:py-32">
      <div className="max-w-[1120px] mx-auto px-6 sm:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
          <div className="lg:col-span-7">
            <p className="mb-4 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40 settle">
              AUTOMATION FOR SMALL BUSINESS
            </p>
            <h1 className="mb-6 max-w-3xl text-[clamp(2.5rem,6vw,4.25rem)] font-[600] tracking-[-0.03em] leading-[1.02] text-ink settle" style={{ animationDelay: "60ms" }}>
              One booking engine.<br />
              <span className="block text-ink/35">Every channel your customers use.</span>
            </h1>
            <p className="mb-8 max-w-xl text-base leading-1.6 text-ink/60 settle" style={{ animationDelay: "120ms" }}>
              Availability, bookings and the conversation around them live in one
              place. Telegram and your website are just two front doors to the same
              engine — add WhatsApp later without touching the logic.
            </p>
            <div className="flex flex-wrap items-center gap-4 settle" style={{ animationDelay: "180ms" }}>
              <a
                href="https://wa.me/"
                target="_blank"
                rel="noopener"
                className="bg-accent rounded-lg px-5 py-2.5 text-[0.875rem] font-medium text-paper transition-colors hover:bg-ink-soft"
              >
                Book a demo
              </a>
              <a
                href="#pricing"
                className="text-[0.875rem] font-medium text-ink/60 hover:text-ink transition-colors underline underline-offset-4"
              >
                See what it covers
              </a>
            </div>
          </div>

          <div className="lg:col-span-5">
            <SlotStrip />
          </div>
        </div>
      </div>
    </section>
  );
}
