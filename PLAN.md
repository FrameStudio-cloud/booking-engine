# Booking Engine — Plan

A reusable booking-automation engine. One core, many channels, many businesses.
First product: a demo site (one preset business) that uses the engine via Telegram + an embeddable chat widget.

## Status

**Phase 3 — Telegram live** (bot polling; first real phone message pending).
Phase 4 next: the widget talks to the same agent.

Green right now: `pnpm test` (39 passing: 27 core + 6 agent + 6 channels),
`pnpm typecheck`, `apps/web` and `apps/widget` build, a live Groq conversation that
checks availability, quotes **local** times, writes a confirmed booking to Postgres,
and a Telegram thread that resumes from the database on every message.

### Parallel work

`WEB-SPEC.md` is the contract for a separate agent building the dashboard/site
shell. It may only touch `apps/web/src/**`. Everything else in this repo stays
with the engine agent. Read §0 of that file before starting either side.

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
- [x] `packages/channels` — transport-agnostic `Channel` + `handleInbound` pipeline
- [x] `@Opencode1lewis_bot` answering on Telegram, history persisted and resumed

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
| LLM | AI SDK 7 + Groq `openai/gpt-oss-120b` | only good tool-caller left on Groq's free tier |
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

- [x] `packages/agent` — system prompt generated per tenant, tool defs
- [x] Tools: `check_availability`, `create_booking`, `get_business_info`, `escalate_to_human`
- [x] Guardrails: `create_booking` refuses any start time the engine never offered
- [x] Tools return `localTime` (wall clock) alongside UTC `startsAt` — the model
      quotes local time only, so it cannot tell a customer the wrong hour
- [x] 6 Vitest cases: invented slot refused, offered slot books, lost race surfaces,
      bad date recovers, escalation flag set, local time is not UTC
- [x] `POST /api/tenants/:slug/chat` wired to Postgres via an `AgentPort` adapter
- [x] Live proof: "anything tomorrow for a trim?" → slot list → "9am, Wanjiku"
      → booking row with `source: agent`, then a closed-Sunday refusal and an escalation

Notes:
- `llama-3.3-70b-versatile` was decommissioned on Groq; `openai/gpt-oss-120b` is the
  current tool-calling model. Groq's free tier only lists 11 models now.
- History is stateless per request (client sends it). Persistence lands in phase 3.

## Phase 3 — Telegram channel

- [x] `packages/channels` — `Channel` interface, `handleInbound` pipeline, 6 Vitest cases
- [x] Telegram adapter (grammY): polling locally, `/webhooks/telegram/:secret` in production
- [x] Conversation persistence (`conversations` + `messages`), resume on return
- [x] `handleInbound` stays silent once a human takes over; apologises + escalates if the model fails
- [ ] Real booking from a phone (first demo moment) — bot is live, waiting for a message

Notes:
- One pipeline, two transports: polling and webhook both call `handleInbound`, so
  behaviour cannot drift between local dev and production.
- The bot token lives in `.env` only. It was pasted in chat once, so revoke it with
  `/revoke` in @BotFather if it ever leaves this machine.
- `apps/api/src/dev/simulate.ts` replays a full conversation against the real
  database with a print-only channel — handy for testing without a phone.
  (It writes real bookings.)

## Phase 4 — Web widget

- [x] Preact + Shadow DOM bundle, IIFE, < 60kb (shell: 7.5 kB gzip)
- [ ] Agent behind the widget (replaces the temporary slot lookup)
- [ ] SSE stream from `apps/api`
- [ ] Embed snippet generator in dashboard
- [ ] Same conversation books the same slot as Telegram

## Phase 5 — Dashboard + staff takeover

- [ ] `apps/web` shell — built from `WEB-SPEC.md` by a separate agent
- [ ] Auth, tenant switcher
- [ ] Wire shell mock data to the real API (services / resources / hours / bookings)
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
