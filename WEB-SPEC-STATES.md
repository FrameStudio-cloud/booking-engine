> **Frozen.** See `PLAN-V2.md` §8. Presentational work only; no new dashboard scope.

# States contract — dashboard loading, empty, offline

Scope: **presentational only.** Three new components, one preview page, one
`index.css` section. No API calls, no new dependencies, no data logic.

This exists so the engine agent can wire real data without waiting on UI states,
and so the two agents never edit the same file.

---

## §0 — File ownership (read first)

You may create or edit **only** these paths:

| Path | Access |
|---|---|
| `apps/web/src/components/Skeleton.jsx` | create |
| `apps/web/src/components/EmptyState.jsx` | create |
| `apps/web/src/components/EngineOffline.jsx` | create |
| `apps/web/src/components/StatesPreview.jsx` | create |
| `apps/web/src/App.jsx` | **one addition only** — the preview route in §4 |
| `apps/web/src/index.css` | **append only**, at the end, under the marker `/* --- states --- */` |

Do not touch anything else. Not `mock.js`, not the other components, not
`App.jsx` beyond §4, not `apps/api`, not `apps/widget`, not `PLAN.md`.

Do not run `git add`, `git commit`, `git checkout`, `pnpm add`, or any install
command. The engine agent owns git.

If something in this contract is ambiguous, pick the reading that needs fewer
files, and list the decision in your handoff (§6).

---

## §1 — What these states are for

The dashboard is about to read from a real API over a home connection. Three
moments currently have no design:

1. **Loading** — the first ~300ms, and every poll. Must not flash or jump.
2. **Empty** — a salon with no bookings today, or an inbox with no chats. This
   is the happy state for a new customer, not an error.
3. **Offline** — the engine is unreachable. The user must know the numbers on
   screen are stale, without being locked out.

Empty is never an error. Offline is never a full-page takeover — the shell stays
usable.

---

## §2 — Components (exact props)

### `Skeleton.jsx`

```jsx
<Skeleton variant="rows" count={4} />
```

- `variant`: `"rows"` (list of 2-line rows), `"table"` (header + rows, for
  Bookings), `"thread"` (alternating left/right message bubbles).
- `count`: number, default `3`.
- Renders `aria-hidden="true"` blocks with `role="status"` on a wrapper and a
  visually hidden label (`<span className="sr-only">Loading</span>`).
- Blocks: `bg-ink/5`, `rounded-[6px]`, heights matched to the real content
  (rows ~56px, table rows ~44px, bubbles ~48–64px).
- Optional single opacity pulse. Reuse the existing `.settle`/reduced-motion
  approach — **no shimmer sweep, no infinite animation**.

### `EmptyState.jsx`

```jsx
<EmptyState
  eyebrow="Today"
  title="No bookings yet today."
  body="When a customer messages, the booking appears here."
  action={{ label: "Open the inbox", href: "#/dashboard/inbox" }}
/>
```

- `eyebrow`: optional uppercase label.
- `title`: required, one sentence, ends with a period.
- `body`: optional, max two sentences.
- `action`: optional. `{ label, href }` renders an `<a>`; `{ label, onClick }`
  renders a `<button>`. Never both.
- Centred, `py-16`, max width `42ch`, ink only. No illustration, no icon, no
  colour.

### `EngineOffline.jsx`

```jsx
<EngineOffline onRetry={refetch} />
```

- One-line banner, not a page. `rounded-[10px]`, `border`, sits at the top of the
  dashboard content area.
- Copy: **"The engine is unreachable. Bookings and chats may be out of date."**
- `onRetry` renders a "Retry" text button. If omitted, no button.
- Accent is allowed here — this is an action-required state.
- `role="status"`, not `role="alert"` (it is not an interruption).

---

## §3 — Rules (these are not suggestions)

**Colour.** The palette is exactly four tokens: `ink`, `ink-soft`, `paper`,
`accent`. No new hex values, no greens, no reds.

`accent` (#ff5c35) means **something needs a human or is broken** — a waiting
customer, an unreachable engine. It is never decoration, never a status pill,
never a link colour. If you find yourself reaching for it twice in one view,
one of those is wrong.

**Type.** Existing scale and tracking only. Times are 24-hour (`09:00`, not
9am). Money via `formatKES` from `mock.js` — read it, do not reimplement it.

**Motion.** One idea: a short opacity settle. Everything must be static under
`prefers-reduced-motion: reduce` (already handled globally — do not fight it).

**Density.** `0.875rem` body, `0.75rem` meta, `tabular-nums` (`.data`) for every
number. Hairlines (`border-ink/10`), no drop shadows, no gradients, no rounded
values above `12px`.

**Accessibility.** Every interactive element keyboard-reachable with a visible
focus ring (global rule exists). No `onClick` on a `div` — use `button` or `a`.
Colour is never the only signal: pair `accent` with text.

**Copy.** Sentence case. No exclamation marks. No emoji. No "Oops".

---

## §4 — Preview route

Add exactly one route to `App.jsx`, following the existing `route` string
pattern:

- `#/dashboard/states` renders `<StatesPreview />` inside `<DashShell>`, with
  the page title `"States"`.
- `StatesPreview` shows every variant from §2 in labelled groups:
  `Skeleton` rows/table/thread, three `EmptyState` examples (Today, Inbox,
  Bookings), and `EngineOffline` twice (with and without Retry).
- Do **not** add "States" to the sidebar `NAV` array.
- The preview must render correctly at 360px and at 1440px.

---

## §5 — Acceptance

Before you hand back, all of these must be true:

- [ ] `pnpm --filter @booking/web build` passes with no warnings.
- [ ] No new dependencies in any `package.json`.
- [ ] `#/dashboard/states` renders all variants at 360px and 1440px.
- [ ] With OS "reduce motion" on, nothing animates.
- [ ] No `accent` outside `EngineOffline` and the focus ring.
- [ ] Every number uses `.data` or `tabular-nums`.
- [ ] Keyboard-only pass: tab reaches every button and link, focus is visible.
- [ ] `git status` shows only the files listed in §0.

---

## §6 — Handoff (reply with this, nothing longer)

1. Files created/edited, one line each.
2. Any prop or naming choice you made that differs from §2.
3. Anything you could not do, and why.
4. `git status --short` output.
