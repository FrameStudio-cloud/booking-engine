# Booking Engine — Plan

A reusable booking-automation engine. One core, many channels, many businesses.
First product: a demo site (one preset business) that uses the engine via Telegram + an embeddable chat widget.

## Status

**Phase 1 — complete** (schema, core, persistence). Phase 2 next: the agent.

Green right now: `pnpm test` (27 passing), `pnpm typecheck`, `apps/web` builds,
`apps/widget` builds (7.5 kB gzip), API reads and writes real Postgres rows,
and four simultaneous writes to one slot yield exactly one `201` and three `409`.

### Database

| | |
|---|---|
| Neon project | `proud-mouse-13812950` (booking-engine) |
| Region | aws-eu-central-1 — Frankfurt |
| Postgres | 17 |
| Branch | `main` (`br-morning-cell-b9r5x1q6`) |
| Credentials | repo-root `.env` (gitignored) |

Schema applied via `drizzle/0000_brainy_terrax.sql`. Verified: 8 tables, 6 enums.

---

## Done so far

- [x] Monorepo scaffold (pnpm workspace, tsconfig base, gitignore, env example)
- [x] `packages/shared` — zod schemas and types for every entity
- [x] `packages/db` — Drizzle schema for all 8 tables (migration not yet run)
- [x] `packages/core` — timezone-safe time helpers
- [x] `packages/core` — `findTimeSlots` (salon, restaurant) and `findStays` (BnB)
- [x] `packages/core` — `validateBooking`, the double-booking guard
- [x] `AvailabilityStrategy` interface + `staff` / `table` / `range` strategies
- [x] 27 Vitest cases: collisions, buffers, capacity, closed days, holidays,
      DST, back-to-back stays, past slots, party size
- [x] `apps/api` — Hono server: `/health`, `/tenants/:slug/slots`, `POST /bookings`
- [x] `packages/db` — repository layer: `loadTenantContext`, `loadBusyIntervals`,
      `createBooking` (transaction + `SELECT … FOR UPDATE`), `pingDatabase`
- [x] `packages/db` — idempotent seed: Glow Salon, 2 stylists, 3 services, Mon-Sat hours
- [x] `apps/api` reads Postgres; in-memory fixture deleted
- [x] `apps/web` — Vite + React (JSX) + Tailwind v4 landing page, live health check
- [x] `apps/widget` — Preact + Shadow DOM IIFE shell with a real slot lookup
- [x] End-to-end proof: correct slots from the DB, `201` then `409`, and a
      4-way concurrent write that resolves to one winner

---

## Decisions (locked)

| Decision | Choice | Reason |
|---|---|---|
| Language | TypeScript everywhere | `core` is shared by bot, widget, dashboard, API |
| Repo | pnpm workspaces monorepo | one install, shared types, no copy-paste |
| Database | Postgres (Neon) + Drizzle | multi-tenant, real concurrency, SQL-native migrations |
| API | Hono on Node | light, SSE for widget, deploys to Railway |
| Web | Vite + React (JSX) + Tailwind v4 | user's preferred stack |
| Widget | Preact + Shadow DOM, Vite IIFE | tiny bundle, styles can't leak into host site |
| Telegram | grammY | TS-first, maintained |
| LLM | Vercel AI SDK (Groq provider) | same Groq, but swappable provider later |
| Tests | Vitest | availability logic must be tested |
| Payments | **out of scope for v1** | booking only, pay on arrival |
| Business model | one engine + config presets | never fork per business type |
| Staff takeover | yes, via dashboard inbox | bot + human share the same `Channel.send` |

---

## Architecture

```
apps/
  api       engine server — Telegram webhook, widget SSE, REST for dashboard
  web       marketing site + tenant dashboard (Vite + React + Tailwind)
  widget    embeddable chat bundle (Preact, Shadow DOM)
packages/
  shared    zod schemas + shared types
  db        Drizzle schema + migrations
  core      availability strategies + booking logic  ← no AI, no network
  agent     LLM + tool definitions (calls core)
  channels  telegram | widget — one interface  ← Phase 3-4
```

### The three seams

1. `AvailabilityStrategy.findSlots(input)` — the only thing that differs per business type.
2. `Channel.send(conversationId, message)` — used by **both** the bot and a human agent.
3. `tools[]` — the LLM's only way to touch bookings. It never invents a slot.

### Why one `resources` table

Salon staff, BnB units and restaurant tables are all rows in `resources` with a `kind`.
A new business type is a **config preset**, not a codebase.

| Business | `kind` | Slot means |
|---|---|---|
| Salon | `staff` | staff × service × time |
| BnB | `unit` | unit × date range (nights) |
| Restaurant | `table` | table × party size × time |

---

## Phase 1 — Schema + Core

- [x] Monorepo scaffold (pnpm workspace, tsconfig base, gitignore, env example)
- [x] `packages/shared` — zod schemas, shared types
- [x] `packages/db` — Drizzle schema
  - [x] `tenants`
  - [x] `services`
  - [x] `resources` (staff / unit / table, via `kind`)
  - [x] `availabilityRules` + `availabilityExceptions`
  - [x] `bookings`
  - [x] `conversations` / `messages`
  - [x] conversation identity folded into `conversations(tenantId, channel, externalId)`
- [x] `packages/core` — domain logic
  - [x] time helpers (timezone-safe, tenant-local)
  - [x] `findTimeSlots` — hours ∩ resource availability − existing bookings
  - [x] `validateBooking` — the double-booking guard
  - [x] `AvailabilityStrategy` interface
  - [x] `staffStrategy` (salon)
  - [x] `findStays` (BnB range semantics)
  - [x] `tableStrategy` (restaurant, party size)
- [x] Vitest suite: overlaps, closed days, exceptions, DST, capacity > 1, back-to-back stays
- [x] `pnpm test` green (27 cases)

### Phase 1b — persistence (done)

- [x] Provision Neon, set `DATABASE_URL` / `DATABASE_URL_DIRECT`
- [x] `pnpm db:generate` + `db:migrate` — migration `0000_brainy_terrax.sql` applied, committed
- [x] `packages/db` repository layer: `loadTenantContext`, `loadBusyIntervals`,
      `createBooking` (transaction + row lock), `pingDatabase`
- [x] Swap `apps/api/src/demo.ts` fixture for real queries (fixture deleted)
- [x] Seed script: Glow Salon with staff, services, hours, one existing booking
- [ ] `cancelBooking` / `rescheduleBooking` in core


## Phase 2 — Agent + tools

- [ ] `packages/agent` — system prompt per tenant, tool defs
- [ ] Tools: `check_availability`, `create_booking`, `cancel_booking`, `get_info`, `escalate`
- [ ] Guardrails: never confirm a slot not returned by a tool; confirm before writing
- [ ] Scripted end-to-end test: "do you have anything Saturday?" → booking row created

## Phase 3 — Telegram channel

- [ ] `packages/channels` — `Channel` interface
- [ ] Telegram adapter (grammY), webhook route in `apps/api`
- [ ] Conversation persistence (`conversations` + `messages`), resume on return
- [ ] Real booking from a phone (first demo moment)

## Phase 4 — Web widget

- [x] Preact + Shadow DOM bundle, IIFE, < 60kb (shell: 7.5 kB gzip)
- [ ] Agent behind the widget (replaces the temporary slot lookup)
- [ ] SSE stream from `apps/api`
- [ ] Embed snippet generator in dashboard
- [ ] Same conversation books the same slot as Telegram

## Phase 5 — Dashboard + staff takeover

- [ ] `apps/web` — auth, tenant switcher
- [ ] Services / resources / hours CRUD
- [ ] Bookings list + calendar
- [ ] Inbox: conversations, `status: bot | needs_human | human`
- [ ] Human reply goes out through `Channel.send` (same path as bot)

## Phase 6 — Presets + demo site

- [ ] `presets/salon.json`, `presets/bnb.json`, `presets/restaurant.json`
- [ ] Seed script: one demo business end-to-end
- [ ] Demo marketing page with the widget live

## Later (explicitly not now)

- [ ] WhatsApp adapter (Baileys or 360Dialog) — same `Channel` interface
- [ ] M-Pesa deposits (Daraja) — schema leaves room
- [ ] Reminders / no-show follow-ups
- [ ] Multi-staff calendar sync

---

## Commands

```bash
pnpm install          # install everything
pnpm test             # run core tests
pnpm typecheck        # tsc across packages
pnpm dev              # api + web + widget in parallel
pnpm db:generate      # drizzle migration from schema
pnpm db:push          # apply schema to Neon
```

## Open questions

- Which business is the demo preset? (salon is the easiest to make look real)
- Telegram bot token — who owns it, one per tenant or one shared for demo?
- Timezone: everything is `Africa/Nairobi` for v1, or per-tenant?
