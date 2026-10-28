> **Frozen.** This spec is retained for what was built; `apps/web` gets no new
> work unless `PLAN-V2.md` §8 changes. The product is the engine, not this shell.

# WEB-SPEC.md — the shell of the booking-engine web app

**Who this is for:** the agent building the UI shell.
**Who wrote it:** the engine agent (owns everything outside `apps/web/src/`).
**Status:** spec only. Nothing here is built yet except a placeholder `App.jsx`.

---

## 0. The contract (read this before touching anything)

Two agents are working in this repo at the same time. To avoid conflicts, this
document is a hard boundary, not a suggestion.

### You own exactly these files

```
apps/web/src/App.jsx            (rewrite freely)
apps/web/src/index.css          (extend the @theme block; do not replace tokens)
apps/web/src/components/*.jsx   (create as many as you like)
apps/web/src/mock.js            (create — all fake data lives here)
apps/web/index.html             (only <title> and <meta name="description">)
```

### Do not touch, at all

```
package.json  ·  pnpm-lock.yaml  ·  pnpm-workspace.yaml
vite.config.js
apps/web/index.html   (other than title/meta)
apps/api/**           ·  apps/widget/**  ·  packages/**
PLAN.md  ·  WEB-SPEC.md  ·  .env*  ·  anything at the repo root
```

### Hard rules

1. **No new dependencies.** No `pnpm add`, no `pnpm install`, no `npm`. If you
   think you need a package, you don't — the shell must build with:
   React 19, Vite 7, Tailwind 4. That's it.
2. **No router library.** Use the ~25 line hash router described in §6.1.
3. **No network calls**, with one exception: keep the existing `useEngineHealth()`
   hook (copy it verbatim out of the current `App.jsx`, render it in the header).
   Everything else reads from `mock.js`.
4. **No state management library.** `useState` + `useReducer` + context is plenty.
5. **No component library** (no shadcn, no MUI, no Radix). Hand-write the
   components. This is a design piece, not an assembly kit.
6. **Don't run the engine.** `apps/api` needs a database and an API key.
   `pnpm --filter @booking/web dev` is the only command you need.
7. **Verify with `pnpm --filter @booking/web build` before you hand back.**
   It must pass with zero warnings about unresolved imports.

If something in this spec seems to require a new dependency, stop and write the
question in your handoff notes instead of adding it.

---

## 1. What the product is

A booking engine for small Kenyan businesses — salons, B&Bs, restaurants.
Customers talk to a bot (Telegram now, website chat widget, WhatsApp later).
The bot checks real availability and books a spot. Staff can take over a
conversation when the bot gets stuck.

The web app has **two surfaces**:

| Surface | Audience | Goal |
|---|---|---|
| Public site | Thika small-business owners | Convince them this saves them bookings |
| Dashboard | Staff at the business | See the day, take a booking, answer a customer |

Both live in this one Vite app. Public at `/`, dashboard at `#/dashboard/...`.

---

## 2. The demo business (use this everywhere)

All mock data must describe the same business the database is seeded with, so
the shell later matches real data with no rewriting.

**Glow Salon** — salon, Thika Arcade, Mama Ngina Drive, 2nd floor.
Timezone `Africa/Nairobi`. Currency KES.

| Staff | Services | Duration | Price |
|---|---|---|---|
| Grace | Braiding | 120 min | KES 2,500 |
| Amani | Wash and blow-dry | 60 min | KES 1,200 |
| Amani | Trim | 45 min | KES 800 |

Hours: **Mon–Sat 09:00–18:00**, closed Sunday.

> Money is stored in minor units in the engine: `250000` = KES 2,500.
> Your mock should store the same shape and format for display, so the swap to
> real data is a one-line change.

---

## 3. Design system

### Tokens (already in `index.css` — keep them, extend if needed)

```css
--color-ink:       #0c0c0d;   /* type, primary buttons */
--color-ink-soft:  #16161a;
--color-paper:     #f6f4ef;   /* page background */
--color-accent:    #ff5c35;   /* vermilion — one action per view, and data highlights */
```

### The direction: **an editorial ledger**

A booking business already runs on a paper appointment book. Lean into that:

- Paper background, ink type, **hairline rules (1px, `rgba(12,12,13,0.08)`)** to
  separate things instead of cards floating on shadows.
- **Tabular numbers everywhere** that represent times, prices or counts:
  `font-variant-numeric: tabular-nums`. Times in `ui-monospace`.
- The accent appears at most **twice per screen** (one primary CTA + one live
  indicator). Everything else is ink at reduced opacity.
- Shadows are almost absent. One soft shadow is allowed on the widget mockup
  and the takeover banner.
- Left-aligned. Asymmetric. Generous vertical rhythm (sections 96–128px apart
  on desktop, 64px on mobile).

### Type

System stack, no web font download (the audience is on Kenyan mobile data):

```css
font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
```

| Role | Size | Treatment |
|---|---|---|
| Hero | `clamp(2.5rem, 6vw, 4.25rem)` | 600, tracking `-0.03em`, leading `1.02` |
| Section head | `1.75rem` | 600, tracking `-0.02em` |
| Body | `1rem / 1.6` | `text-ink/60` |
| Small / label | `0.75rem` | 500, uppercase, tracking `0.16em`, `text-ink/40` |
| Data | `0.875rem` | `ui-monospace`, tabular |

### Spacing & shape

- 8px scale. Radii: `10px` inputs, `14px` panels, `999px` pills.
- Page max-width `1120px`, gutters `24px` mobile / `32px` desktop.
- Breakpoints: design at 390, 768, 1280. Nothing in between needs to be perfect.

### Motion

One idea only: things settle in with `transform` + `opacity`, `180ms`,
`cubic-bezier(0.22, 1, 0.36, 1)`. No parallax, no scroll-jacking, no spinners —
use a skeleton or a static "checking…" label instead.

```css
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
```

---

## 4. What "not generic" means here — banned

- Purple/blue gradients, glassmorphism, glow effects.
- Hero with a stock photo of a smiling receptionist.
- Three identical icon-in-a-circle cards in a row.
- Emoji as section markers (one 💬 inside the widget bubble is fine).
- Fake stats with no sourcing ("Trusted by 10,000 businesses"), fake logos, fake
  testimonials with invented full names and photos.
- Centered everything. Centered is the default; left is the choice.
- Lorem ipsum anywhere. Real sentences only — copy is provided in §5.
- A second accent colour. There is one.

---

## 5. Public site — section by section

Order matters. Each section gets a `max-w-[1120px]` inner container.

### 5.1 Header
- Left: wordmark `booking engine` with a 28px solid ink square containing a
  single white glyph (a `B`, or a bracket — keep it plain).
- Right: nav `How it works · Pricing · Try the bot` + one accent-outlined CTA
  `Book a demo` (links to `https://wa.me/`).
- On mobile: nav collapses to just the CTA. No hamburger for three links.
- The engine status pill (`useEngineHealth`) sits at the far right on desktop
  only: a 6px dot + `engine online` / `engine offline` / `checking engine`.

### 5.2 Hero
Asymmetric two-column on desktop (7/5), stacked on mobile.

Left:
```
[eyebrow] AUTOMATION FOR SMALL BUSINESS

One booking engine.
Every channel your customers use.

Availability, bookings and the conversation around
them live in one place. Telegram and your website
are just two front doors to the same engine —
add WhatsApp later without touching the logic.

[primary CTA] Book a demo        [secondary] See what it covers
```

Right — **the slot strip** (this is the hero image, hand-built, no photo):
A panel titled `Tomorrow · Glow Salon`, showing 8 ledger rows:

```
09:00   Grace    Braiding            —
09:30   Amani    Trim                —
10:00   Grace    Braiding            booked
10:30   Amani    Trim                —
11:00   Grace    —                   booked
12:00   Amani    Wash & blow-dry     —
14:00   Grace    Braiding            —

Booked by: Telegram · 2 min ago
```

Booked rows get `text-ink/30` + `line-through` + a small `booked` pill.
Live rows are hoverable-looking but do nothing. This strip is the single most
important thing on the page — it shows the product working.

### 5.3 The problem
One short block, no cards:

> A missed call is a booking somebody else got.
>
> Most small businesses answer bookings between customers, between shifts, after
> closing. The customer doesn't wait — they message the next salon on the list.

Then three facts on one row, separated by hairline rules, `tabular-nums`:
`~40%` of enquiries arrive outside working hours · `2 min` median reply before a
customer tries elsewhere · `1 in 5` bookings lost to a slow reply.
Mark them as `illustrative — replace with your own numbers before launch` in a
footnote. Do not invent a source.

### 5.4 How it works
Three numbered steps, laid out horizontally with vertical hairlines, **not**
cards:

```
01  Customer asks        "Anything free Saturday afternoon?"
02  Engine checks        Real staff, real hours, real bookings.
03  Spot is held         Confirmed in chat. Row written to the database.
```
Each number in `ui-monospace` at `text-ink/25`, large, top-aligned.

### 5.5 Channels
Three rows in a hairline-bordered list (not cards). Each row:

```
Telegram            live        Customers message a bot. No app, no form.
Website widget      next        One script tag. Same engine, your colours.
WhatsApp            later       Same code path — the adapter is small.
```

Status pill tones: `live` ink-on-paper, `next` accent-tinted, `later` `text-ink/40`.

### 5.6 Business types
A real table, hairline rules, `tabular`:

| Business | A slot is | Status |
|---|---|---|
| Salon | staff × service × time | Demo |
| B&B / stay | unit × date range | Next |
| Restaurant | table × party × time | Next |

Caption: `A business type is a config preset, not a separate product. Only the
meaning of "a slot" changes.`

### 5.7 Pricing
Two lines of text, no pricing table theatre:

```
KES 5,000   setup — bot, widget, your services and hours
KES 1,500   per month — hosting, updates, one change per month
```
Footnote: `Numbers are a placeholder. Confirm before publishing.`
One CTA below: `Book a demo`.

### 5.8 Footer
Hairline top rule. Three columns on desktop:
- Wordmark + one line: `Built in Thika.`
- Contact: WhatsApp link, email placeholder, phone placeholder
- `Phase 1b — bookings persist to Postgres. Channels land next.`

---

## 6. Dashboard

### 6.1 Routing (no library)

```jsx
// ~25 lines, in App.jsx
const [route, setRoute] = useState(() => window.location.hash.slice(1) || "/");
useEffect(() => {
  const onHash = () => setRoute(window.location.hash.slice(1) || "/");
  window.addEventListener("hashchange", onHash);
  return () => window.removeEventListener("hashchange", onHash);
}, []);
```

Routes:

```
/                         public site
/dashboard                Today
/dashboard/bookings       Bookings
/dashboard/inbox          Inbox
/dashboard/setup          Setup
/dashboard/inbox/:id      Inbox with a thread open
```

### 6.2 Shell
- **Left rail, 240px, `bg-white/60`, hairline right border.** Wordmark, then nav
  items with a 3px accent left bar on the active one. Bottom of rail:
  `Glow Salon · Africa/Nairobi`.
- **Top bar, 64px.** Page title, then on the right: engine status pill and a
  `+ New booking` button (opens nothing in the shell — mark it `disabled` with
  `title="wired in phase 5"`; do not fake a modal).
- Mobile: rail becomes a bottom tab bar with 4 icons + labels. Content gets
  `pb-24`.

### 6.3 Today (`/dashboard`)
1. **Stat strip** — four cells separated by hairlines, `tabular`:
   `Bookings today 6` · `Revenue KES 8,400` · `Unanswered 1` · `Occupancy 62%`
   (define occupancy as booked minutes ÷ open minutes, and compute it in
   `mock.js` from the mock bookings so the number is honest).
2. **Day timeline** — grouped by staff. Each staff section: name + total booked
   time, then rows `09:00 – 11:00  Braiding  Wanjiku  confirmed`. Free gaps are
   shown as dashed rows labelled `free`. This is the centrepiece of the page.
3. **"Needs attention"** — one row linking to the unread conversation. Only
   render if `stats.unanswered > 0`.

### 6.4 Bookings (`/dashboard/bookings`)
- Date stepper `‹ Today ›` (state only, no persistence).
- Same timeline component as Today, but for the selected day.
- Empty state: `Nothing booked. The bot is still answering.` with a quiet link
  back to Today.

### 6.5 Inbox (`/dashboard/inbox`)
Two panes on desktop (320px list / flex thread), one pane at a time on mobile.

- List row: customer name, last message truncated, channel pill (`Telegram` /
  `Widget`), relative time, unread dot.
- Thread: messages as bubbles — `assistant` left on paper, `user` right in ink,
  `staff` left with a 2px accent left rule and a `You · Grace` label.
- **Status banner** above the composer, three states:
  - `bot` → calm: `The bot is handling this.`
  - `needs_human` → accent-tinted: `Waiting for a human since 4m.` + `Take over`
  - `human` → ink: `You are replying as Grace.` + `Hand back to bot`
- Composer is a real `<textarea>` that appends to local state. Mark the
  `Take over` / `Hand back` buttons as wired in phase 5 in a `title` attr, but
  let the banner state change locally so the interaction is demoable.
- Include one thread whose last message is 4 minutes old and escalated, so the
  screen has something worth looking at.

### 6.6 Setup (`/dashboard/setup`)
Four hairline-separated blocks, all read-only in the shell:
1. **Services** — name, duration, price, buffer. Grace/Amani as a muted column.
2. **Staff** — name, kind (`staff`), how many services.
3. **Hours** — a 7-row grid Mon–Sun with `09:00 – 18:00` or `Closed`. Sunday closed.
4. **Embed** — a `<pre>` with the real snippet and a copy button that uses
   `navigator.clipboard` and shows `Copied` for 1.5s:

```html
<script src="https://your-domain/widget.js"
        data-tenant="glow-salon"
        data-api="https://api.your-domain.com"></script>
```

---

## 7. `mock.js` — the data contract

One default export. Shape it exactly like this so the swap to the real API is
mechanical. Money in minor units. Dates as ISO strings.

```js
export const tenant = { slug: "glow-salon", name: "Glow Salon", timezone: "Africa/Nairobi", currency: "KES" };

export const staff = [
  { id: "staff-grace", name: "Grace", kind: "staff" },
  { id: "staff-amani", name: "Amani", kind: "staff" },
];

export const services = [
  { id: "svc-braiding", name: "Braiding", durationMinutes: 120, priceMinor: 250000, bufferBeforeMinutes: 15 },
  { id: "svc-wash",     name: "Wash and blow-dry", durationMinutes: 60, priceMinor: 120000, bufferBeforeMinutes: 10 },
  { id: "svc-trim",     name: "Trim", durationMinutes: 45, priceMinor: 80000, bufferBeforeMinutes: 5 },
];

export const hours = { 0: null, 1: ["09:00","18:00"], 2: ["09:00","18:00"], 3: ["09:00","18:00"], 4: ["09:00","18:00"], 5: ["09:00","18:00"], 6: ["09:00","18:00"] };

export const bookings = [ /* 6 for today, 2 for tomorrow. See §2 for names/prices. */ ];
// each: { id, serviceId, staffId, startsAt, endsAt, status, customerName, source }

export const conversations = [ /* 3 total, one escalated and unread */ ];
// each: { id, customerName, channel, status, unread, messages: [{ id, role, text, at }] }
// role: "user" | "assistant" | "staff"

export const stats = { bookingsToday: 6, revenueMinor: 840000, unanswered: 1, occupancy: 0.62 };
```

Formatting helpers go in `mock.js` too, exported:
`formatKES(250000) → "2,500"`, `formatTime(iso) → "09:00"`, `formatRelative(iso) → "4m ago"`.
Write them with `Intl` — no date library.

---

## 8. Component inventory

Build these in `apps/web/src/components/`. Keep each one small and dumb —
props in, markup out. No component may fetch anything.

```
Header.jsx           public nav + engine status
Hero.jsx             hero + <SlotStrip />
SlotStrip.jsx        the ledger-style availability panel (§5.2)
Section.jsx          eyebrow + heading + optional lede, used by every section
StepList.jsx         01/02/03 hairline steps
ChannelList.jsx      channel rows with status pills
TypeTable.jsx        business-type table
Pricing.jsx          2-line pricing + CTA
Footer.jsx
Pill.jsx             tone: "live" | "next" | "later" | "booked" | "confirmed"
DashShell.jsx        rail + top bar + children
StatStrip.jsx
Timeline.jsx         used by Today and Bookings
BookingRow.jsx
InboxList.jsx
Thread.jsx
StatusBanner.jsx
Composer.jsx
SetupBlock.jsx
```

---

## 9. States you must actually render

Don't ship only the happy path. Implement these and make them reachable:

| State | Where | How to see it |
|---|---|---|
| Engine offline | header pill | stop the API — pill goes grey |
| No bookings today | Today | a `?empty=1` query flag or a toggle in `mock.js` |
| Unread / escalated inbox | Inbox | default mock already has one |
| Long text | anywhere | one customer name of 40+ chars, one service name of 30+ |
| Mobile 390px | everything | nothing overflows horizontally |

Long-text cases exist to catch layout breakage — name one customer
`Wanjiku Wairimu Njeri-Mwangi` and one service `Wash, deep-condition and blow-dry`.

---

## 10. Accessibility

- Every interactive element is a `<button>` or `<a>`, reachable by Tab, with a
  visible focus ring (`outline: 2px solid var(--color-accent); outline-offset: 2px`).
- Contrast: `text-ink/60` on paper passes; do not go lighter than `/60` for body
  copy. `/40` is labels only.
- The rail and the inbox list are `<nav>` and `<ul>`. The thread has
  `aria-live="polite"` on the message list.
- Status pills carry text, not colour alone.
- `prefers-reduced-motion` respected (§3).

---

## 11. Acceptance checklist

Hand back only when all of these are true:

- [ ] `pnpm --filter @booking/web dev` runs, no console errors
- [ ] `pnpm --filter @booking/web build` passes
- [ ] No dependency added — `git diff --stat` shows nothing in `package.json`,
      `pnpm-lock.yaml`, or `vite.config.js`
- [ ] Only files listed in §0 were created or changed
- [ ] All five dashboard routes reachable and render without a blank screen
- [ ] Public page has real copy from §5 — zero lorem ipsum
- [ ] 390 / 768 / 1280 checked, no horizontal scroll
- [ ] Keyboard-only pass through the dashboard works
- [ ] Nothing calls the network except the engine status pill
- [ ] `mock.js` matches §7 exactly (field names, minor units, ISO dates)

---

## 12. Handoff notes

When you're done, write a short note in your reply (not in a file) covering:

1. Any place where the spec was ambiguous and what you chose.
2. Anything you stubbed that a later phase must wire.
3. The one thing you'd change about the design if it were your call.

That last one matters — the engine agent will read it before wiring the real API.
