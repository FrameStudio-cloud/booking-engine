// Footer.jsx — hairline top rule, three columns (§5.8).
export default function Footer() {
  return (
    <footer className="border-t border-ink/10 py-16 sm:py-24">
      <div className="max-w-[1120px] mx-auto px-6 sm:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 sm:gap-16">
          <div className="lg:col-span-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-6 w-6 bg-ink flex items-center justify-center text-paper text-xs font-semibold">
                B
              </div>
              <span className="text-sm font-semibold tracking-tight">booking engine</span>
            </div>
            <p className="text-base leading-1.6 text-ink/60">Built in Thika.</p>
          </div>

          <div className="lg:col-span-4">
            <p className="mb-3 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
              Contact
            </p>
            <ul className="space-y-2 text-[0.875rem] text-ink/60">
              <li>
                <a href="https://wa.me/" target="_blank" rel="noopener" className="hover:text-ink transition-colors">
                  WhatsApp
                </a>
              </li>
              <li>hello@glow-salon.example</li>
              <li>+254 700 000 000</li>
            </ul>
          </div>

          <div className="lg:col-span-4">
            <p className="mb-3 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
              Status
            </p>
            <p className="text-[0.875rem] leading-1.6 text-ink/60">
              Phase 1b — bookings persist to Postgres. Channels land next.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
