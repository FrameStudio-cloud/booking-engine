// Header.jsx — public nav + engine status.
import EnginePill from "./EnginePill.jsx";

export default function Header({ health }) {
  return (
    <header className="border-b border-ink/10 bg-paper/80 backdrop-blur-md sticky top-0 z-20">
      <div className="max-w-[1120px] mx-auto px-6 sm:px-8 flex h-16 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 bg-ink flex items-center justify-center text-paper text-sm font-semibold">
            B
          </div>
          <span className="text-sm font-semibold tracking-tight">booking engine</span>
        </div>

        <div className="flex items-center gap-6">
          <nav className="hidden sm:flex items-center gap-8 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
            <a
              href="#how-it-works"
              className="text-ink/60 hover:text-ink transition-colors"
            >
              How it works
            </a>
            <a
              href="#pricing"
              className="text-ink/60 hover:text-ink transition-colors"
            >
              Pricing
            </a>
            <a
              href="https://wa.me/"
              target="_blank"
              rel="noopener"
              className="text-ink/60 hover:text-ink transition-colors"
            >
              Try the bot
            </a>
          </nav>

          <div className="flex items-center gap-4">
            <a
              href="https://wa.me/"
              target="_blank"
              rel="noopener"
              className="rounded-lg border border-accent px-5 py-2.5 text-[0.875rem] font-medium text-accent transition-colors hover:bg-accent hover:text-paper"
            >
              Book a demo
            </a>
            <div className="hidden sm:flex items-center gap-2">
              <EnginePill health={health} />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
