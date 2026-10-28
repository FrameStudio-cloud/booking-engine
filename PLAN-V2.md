# Booking Engine — Plan v2

**Status:** active. Supersedes `PLAN.md` (phases 1–7, historical) and absorbs
`GAPS.md` (three gaps, now scheduled or explicitly deferred).

**Companion document:** `AGENTS.md`. That file holds the rules; this one holds
the order of work. Read both before starting. Do not edit `PLAN.md` or `GAPS.md`
to reflect new work — they are record, this is intent.

**Last updated:** 27 October 2026.

---

## 0. The scope statement, in one paragraph

One engine, sold as a package. A business keeps its own site, embeds our widget
with one script tag, and optionally talks to customers through our Telegram bot.
Both channels share one booking path, one calendar, one set of rules. We do not
give them a website, a dashboard, or a CMS. We are the brain, not the face.

Everything below serves that sentence. If a task would turn us into a dashboard
product or a CMS, it belongs in §8 (deferred), not in a phase.

---

## 1. Locked decisions

These were decided in conversation on 26–27 October 2026. Do not reopen them
without a reason that is written down here.

| # | Decision | Why |
|---|---|---|
| D1 | **One Postgres, tenant-scoped.** `tenant_id` on every row, every query filtered. No per-client database. | Extraction later is a migration; splitting now is premature and makes cross-tenant reporting impossible. |
| D2 | **The engine is never the only place a price exists.** One canonical catalog per tenant, replicated into the engine. | If we are the sole holder of a price, our outage erases the client's price list. A salon's real price also hangs on a board at the desk. |
| D3 | **Never fetch the catalog live inside a request.** Replicate, timestamp, mark stale. | A live fetch makes the client's shared hosting a hard dependency and lets the price change between quote and insert. |
| D4 | **Bookings carry an immutable snapshot** of service name, duration and price. | Makes a retention cleanup safe and stops price edits rewriting past revenue. |
| D5 | **Catalog source is an adapter**, not a code branch: `preset` now, `dashboard` and `remote` later. | A client with an API should be a configuration, not a fork. |
| D6 | **The dashboard is frozen.** Internal inspection tool only. No new pages, no editor this cycle. | It is the scope creep that stalled the first idea. Product surface = API + widget + bot. |
| D7 | **Owner awareness is a Telegram digest**, not a login. | A salon owner checks WhatsApp, not a web app. We already own the channel. |
| D8 | **Retention: transcripts 90 days (per tenant), catalog and bookings forever.** | Seven days is shorter than a customer's memory and shorter than a dispute. Snapshots make deletion safe. |
| D9 | **Security and price history are the floor, not a phase.** | Deferring them is what made the project undemoable to a real client. |
| D10 | **No payments in v1.** | Booking only; pay at the desk. Schema room exists, nothing else. |
| D11 | **Verification is part of the phase**, not a follow-up. Each task carries a proof. | "It compiles" is not "it works". The concurrency guarantee was proven once, by hand. |

---

## 2. What is actually true today (verified 27 Oct 2026)

Not claims — checked.

| Item | State |
|---|---|
| `pnpm verify` | **138 tests** (36 core, 17 channels, 15 agent, 14 db, 56 integration), typecheck clean |
| Database | Neon `proud-mouse-13812950`, Frankfurt, PG 17, branch `main` |
| Migrations | `0000`–`0008`; 10 tables including `tenant_channels` |
| Tenants live | `glow-salon`, `fade-factory` — both from presets |
| Channels | Telegram (one bot per tenant, token sealed in the DB), widget (POST, no SSE), WhatsApp adapter (tested at the boundary; route not wired) |
| Agent | Groq `openai/gpt-oss-120b`, 6 tools, offered-slot guard |
| Dashboard | Built, reads live API, machine-key auth, **frozen** |
| Auth | machine key on `/api/tenants/*`; widget and the public price read are exempt and rate limited |
| Rate limiting | LLM routes and the public reads |
| Price history | snapshotted per booking (`priceMinorAtBooking`); revenue never joins the current price |
| Cancel / reschedule | HTTP routes and agent tools, row-locked, idempotent cancel |
| Provisioning | `tenant:apply` is non-destructive; `tenant:new` still deletes (demos only) |
| Public price read | `GET /api/tenants/:slug/services`, 60s cache, per-tenant CORS |
| Privacy | retention 90d per tenant, `tenant:erase`, widget consent line, staff attribution |
| `.env` in git | no — only `.env.example` is tracked |
| Tracked files | 117 |

### Progress log

**27 Oct 2026 — Phase 8 opened**

| Task | State | Proof run |
|---|---|---|
| 8.1 auth gate | **done** | no key → 401, wrong key → 401, right key → 200, widget unchanged → 200 |
| 8.2 rate limit | **done** | 30 × 400 then 2 × 429 on `/chat`; 429 carries `Retry-After` |
| 8.3 webhook fail-closed | **done** | with `TELEGRAM_MODE=webhook` and no secret the process refuses to boot |
| 8.4 price snapshot | **done** | booking at 80,000 stayed 80,000 after the service was raised to 99,900 and restored |
| 8.5 catalog hygiene | **done** | tenant read route uses the tenant's own timezone (`glow-salon` → `Africa/Nairobi` from data, not a literal) |
| 8.6 secrets | partial | webhook secret rotated; Groq and Telegram tokens still need revoking by hand |
| 9.1 cancel + reschedule (core) | **done** | 9 new tests: idempotent cancel, started-booking refusal, move keeps duration, self-conflict removed, target-taken refused, outside-hours refused |
| 9.2 cancel + reschedule (HTTP) | **done** | live: cancel freed Grace's 14:00 (slot returned to the list); reschedule kept the same id and moved 11:00 → 12:00; move onto a taken slot → 409; second cancel → `alreadyCancelled: true` |
| 9.3 agent tools | **done** | `cancel_booking`, `reschedule_booking`; 4 new tests — cancels only its own booking, refuses with none, moves to an offered time, refuses an invented one |
| 9.4 status transitions | **done** | `statusChangedAt`, `statusChangedBy`, `statusReason` on `bookings` (migration 0004) |
| 9.5 owner ping + digest | **code done, send unproven** | sweep proven: a 30-day-idle thread closed, a fresh one untouched. Telegram delivery needs a real `notify.telegramChatId` — see note |
| 9.6 auto-close idle chats | **done** | same sweep run: 14-day window, closed only the idle row |

Notes for the next session:

- `ENGINE_API_KEY` is now required; the API will not boot without it. It lives in
  `.env`, and the dashboard reads it as `VITE_ENGINE_API_KEY` from
  `apps/web/.env.local`. Rotating it means editing both.
- Nothing consumed `GET /slots` except the API itself, so it sits behind auth
  too — no exception was needed.
- `provisionTenant` and `createBooking` both write the snapshot columns; any
  future insert into `bookings` must too.
- Cancel and reschedule are live on HTTP (`POST .../bookings/:id/cancel` and
  `.../reschedule`) and in chat. Both go through core, then a row-locked repo
  write — no second path to the table.
- A cancelled booking still appears in `GET /bookings?date=` with
  `status: "cancelled"`; the slot engine ignores it. The dashboard does not
  filter it yet.
- Owner notifications go to `tenants.settings.notify.telegramChatId`, set per
  tenant in the preset. Until that id exists, the engine silently sends nothing —
  which is why 9.5 has no delivery proof yet. Get the id from `@userinfobot`.
- The scheduler is one `setInterval` in the API process: one digest per tenant
  per local day, idle threads closed after 14 days. Restarting inside the 07:00
  hour can resend one digest; accepted, not solved.

**27 Oct 2026 — Phase 10 opened**

| Task | State | Proof run |
|---|---|---|
| 10.1 catalog columns | **done (columns only)** | `services.source`, `services.externalId`, `tenants.catalogSyncedAt` (migration 0005); the adapter interface itself is not built — `preset` is the only writer |
| 10.2 `tenant:apply` | **done** | dry run listed `+ Signature Trim`, `~ Braiding`, `- Trim (deactivated)`; `--write --force` applied it; the one existing booking still read `Braiding @ 250000` while the service became `300000`; second run said "already up to date"; reverting restored both retired rows |
| 10.3 public services read | **done** | no key → 200 + `cache-control: max-age=60`; prices matched the DB exactly; payload had no staff or phone data; with `allowedOrigins: ["https://glow.example"]` that origin got an ACAO header and `https://evil.example` got none |
| 10.4 demo pages from the API | **done** | Braiding raised to 300,000 in the DB → `glow-salon` page rendered `KES 3,000` with no rebuild → reverted → page showed `KES 2,500`; both demo boards render live rows, static rows stay as no-JS fallback |
| 10.5 one money formatter | **done** | `formatMoney` lives in `@booking/shared`; bot prompt printed `Braiding: 120 min, KES 3,000` while the page said `KES 3,000` |

Phase 10 notes:

- `tenant:apply` refuses to write when bookings exist unless `--force`. It never
  deletes: removed services/staff become `active = false`.
- Renaming a service is a create + deactivate, not an in-place rename. If a client
  cares about keeping one row, match the preset name exactly.
- The public read is deliberately unauthenticated. Origin restriction is real but
  optional; an open price list is public information.
- 10.1 is only half done. There is no `CatalogSource` interface, no `remote`
  adapter, and no `manual` writer. The columns exist so those can land without
  another migration.

**27 Oct 2026 — Phase 11 opened**

| Task | State | Proof run |
|---|---|---|
| 11.1 test database | **done** | every run creates `test_<time>_<rand>`, migrates it from the SQL files, seeds from presets, drops it; the auth and isolation suites ran as two separate processes at once and both passed (9 and 7), leaving zero `test_%` schemas behind; a crashed run is swept by the next one after 24h |
| 11.2 HTTP integration suite | **done** | 27 tests over the real app, real Postgres: auth matrix (no key / wrong key / prefix of the key → 401, real key → 200, writes guarded, calendar and inbox guarded), public services and widget config still open, slots, 201, 409, cancel idempotency, reschedule, cross-tenant id → 404. Sabotage proof: bypassing the auth middleware turned 5 of the 9 auth tests red |
| 11.3 concurrency, automated | **done** | 8 parallel writers on one slot, three rounds: always exactly one 201, seven 409, one row. The earlier 20-writer run gave the same result (1 × 201, 19 × 409) but took ~29s per round against Neon, so the suite keeps 8 |
| 11.4 restart / resume | **done** | a stub model books on turn one; turn two runs with no shared memory and the port still reports `existingBooking` with that id, inside the same conversation id |
| 11.5 two-tenant smoke | **done** | same wall clock booked at both businesses; each calendar contains only its own customer; each service list is its own; a booking that presents the other tenant's service id is refused 404; two chats sharing a session id stay two rows |
| 11.6 `pnpm verify` | **done** | typecheck ×6 + 84 tests (36 core, 15 agent, 6 channels, 27 integration) green in one command; `.github/workflows/verify.yml` runs the same command against a `postgres:16` service |

Phase 11 notes:

- The suite needs a real Postgres. It reads `DATABASE_URL_DIRECT` first, then
  `DATABASE_URL`. With neither, it fails loudly — it does not silently skip,
  because a skipped gate is worse than no gate.
- Migration SQL is applied straight from `packages/db/drizzle/*.sql`, with
  `"public".` rewritten to the test schema. Drizzle qualifies every object, so
  `search_path` alone was not enough. The drizzle journal is not used, which is
  what keeps runs independent.
- `apps/api/src/index.ts` no longer starts anything on import. `server.ts` owns
  the port, the bot, the scheduler and the webhook route; tests import the app.
- Two test seams exist and are deliberate: `useDatabase()` in `apps/api/src/db.ts`
  and `TurnInput.agentRunner`. Only the model and the socket are replaced; tools,
  locks and Postgres run for real.
- Against Neon the suite takes ~2.5 minutes because of round-trip latency; against
  the CI Postgres service it is seconds. Do not read the local duration as a
  performance signal.
- Known gap: nothing yet proves Telegram or Groq delivery. Those two still need a
  live key, so 8.6 and 9.5 remain open for the same reason.

**27 Oct 2026 — Phase 12 opened**

| Task | State | Proof run |
|---|---|---|
| 12.1 per-tenant channel config | **done** | `tenant_channels` (migration 0006) holds one row per business per channel; the token is AES-256-GCM sealed. `pnpm tenant:channel glow-salon --adopt-env` asked Telegram `getMe` first, then stored a 105-char `v1.…` ciphertext with no `:` anywhere in it. Booting the API printed `telegram @Opencode1lewis_bot polling for glow-salon` — from the database row, with the env token ignored |
| 12.2 tenant resolver cache | **done** | read the tenant, rename it with raw SQL around the repository → the cached read still returns the old name; `clearTenantCache` → the new name; `applyTenant` invalidates on its own; a second schema in the same process sees none of it |
| 12.3 WhatsApp adapter | **adapter done, route not wired** | decision: Meta Cloud API direct. 11 tests: request URL and body, bearer token, error text from Meta, empty body never sent, payload parsing (delivery receipts and images ignored), HMAC signature accepted/tampered/wrong-secret |
| 12.4 inbox semantics | **done** | unread is now "customer messages after `staffReadAt`": 2 unread → staff reply → 0 → customer answers again → 1 while the thread is still `human` (the old last-message rule showed 0). Same person on widget and Telegram is two threads with separate counts; another tenant's messages never appear |

Phase 12 notes:

- **The webhook secret is derived, not stored**: `HMAC(CHANNEL_SECRET_KEY,
  "webhook:<channel>:<tenantId>")`. Nothing to leak, nothing to sync, and each
  business has its own. The cost: rotating `CHANNEL_SECRET_KEY` changes every
  webhook URL at once and they must be re-registered.
- The bot token is only decrypted in the API process. No route returns it, and
  staff replies decrypt the tenant's own row at send time.
- The cache holds **only the tenant row**, for 30 seconds. Services and
  availability are never cached: a stale price is a lie and a stale slot is a
  double booking.
- The WhatsApp route is deliberately not wired yet. An endpoint that can write
  bookings has to be provable, and proving it needs a Meta app, a phone number
  and a real webhook — none of which exist today. The adapter is tested at its
  boundary, so the remaining risk is Meta's behaviour, not our code.
- Still missing for the phase's exit line: a **second real bot token**, to run
  two live Telegram bots at once. Two bots are proven with two tokens; the
  tokens are not from BotFather.

**27 Oct 2026 — Phase 13 opened**

| Task | State | Proof run |
|---|---|---|
| 13.1 retention job | **done** | `purgeTenantMessages` + `runRetention`. A message aged 120 days is deleted for Glow and kept for Fade in the same run; a 45-day message survives Fade's 90-day default and dies under Glow's 30; a cutoff of "now" removes every message and the booking count does not move. The scheduler ticks every 10 minutes and runs retention at most once per tenant per local day |
| 13.2 deletion request path | **done** | `pnpm tenant:erase <slug> --phone=… [--write]` (also `--external-id=`). Dry run changes nothing; `--write` turns the booking's name into "Deleted customer" and nulls the phone, while price, service name and start time are byte-identical to before. The conversation loses its name, phone and chat identity (`erased-<id>`) and its transcript; a second customer on another phone is untouched. `planErase({})` refuses to guess |
| 13.3 consent + notice | **done** | `GET /widget/config` returns `consent` and `privacyUrl`; the widget renders it under the input, before the customer types. Overridable per tenant through `privacy.notice` / `privacy.url` in the preset |
| 13.4 staff attribution | **done** | `messages.author` (migration 0008). A reply with `x-staff-name: Amina` comes back in the thread as `author: "Amina"`; the same name in the JSON body works; an 80-character name is cut to 40; bot and customer messages stay `null` |
| 13.5 client-facing DPA note | **done** | `INSTALL.md` §6: what is stored, for how long, that Groq (US) sees message content, how retention and erasure work, and the exact command |

Phase 13 notes:

- **Retention and erasure are different operations**, and the code says so in
  two files. Retention is scheduled and deletes transcripts; it never touches a
  booking. Erasure is manual, per request, and keeps the booking's business
  facts — service, time, duration, price — so the calendar and the revenue still
  add up after the person is gone.
- The retention window is **per tenant** (`settings.privacy.retentionDays`,
  default 90). One global cutoff would have quietly applied Glow's 30 days to
  Fade.
- Erasure replaces a conversation's `externalId` with `erased-<id>` rather than
  nulling it: the unique index stays honest, and a later WhatsApp message from
  that number starts a new thread instead of re-attaching to the erased one.
- Phone matching is digits-only, last 9. That survives `+254…`, `254…`, `07…`
  and spaces, and it is deliberately fuzzy — the CLI prints what it matched
  before writing, and `--write` is required.
- Attribution is a **display name, not an account**. Accounts belong with the
  editor (deferred). The header wins over the body so a proxy can set it.
- Nothing in either path logs message content. Retention logs a count per
  tenant; erasure prints counts only.

**Phase 13 exit:** a client can read `INSTALL.md` §6 and answer "what happens to
my customers' data?" without asking us. The two commands behind that answer have
tests, not just paragraphs.




---

## 3. The invariants

Defined in `AGENTS.md` §4 as I1–I10. They are not repeated here. Every task below
is judged against them, and no phase may break one to make a deadline.

The three that this plan exists to enforce:

- **I6** — never the only holder of a price.
- **I7** — history is immutable.
- **I10** — fail loudly, never silently.

---

## 4. Phases

Numbering continues from `PLAN.md`. Phases 1–7 are history; 8–14 are here.

Each task has an ID, a change, and a **proof** — the demonstration that it works.
A task without its proof is not done. Estimates are half-days of focused work.

---

### Phase 8 — Trust floor (≈2 days)

The phase that makes the engine safe to point at a real business. Nothing else
ships before it.

**8.1 Machine auth on every dashboard route** *(0.5d)*
Add `ENGINE_API_KEY`. A middleware applies to `/api/tenants/*` except `/widget/*`
and returns 401 with no detail on failure. Dashboard reads the key from its own
env and sends it on every call. Not user auth — machine auth. It closes the door
now; per-staff accounts come with the editor that does not exist yet.

> Proof: `curl` without the key → 401 on bookings, conversations, thread, reply,
> takeover, handback. With the key → 200. A wrong key does not leak whether the
> tenant exists.

**8.2 Rate limit the paid routes** *(0.25d)*
Token bucket per session id and per IP on `/chat` and `/widget/messages`.
Suggested: 20 messages/minute per session, 60/minute per IP, 429 with
`Retry-After`. In-memory is acceptable on one instance; note the Redis upgrade in
the runbook.

> Proof: 21st message in a minute → 429. Normal conversation of 10 turns → all
> 200. Limit resets after the window.

**8.3 Webhook fail-closed** *(0.1d)*
Remove the `dev-secret` default. If `TELEGRAM_MODE=webhook` and
`TELEGRAM_WEBHOOK_SECRET` is missing, refuse to start with a clear message.

> Proof: start with webhook mode and no secret → process exits with the reason.
> With the secret: correct path → 200, wrong path → 403.

**8.4 Price snapshot on bookings** *(0.75d)*
Migration adds `price_minor_at_booking`, `duration_minutes_at_booking`,
`service_name_at_booking` to `bookings`. Written inside `createBooking` from the
service row it already loads under the transaction. Backfill existing rows from
current services (documented as best-effort, with the date it ran). Every read
model and revenue calculation switches to the snapshot.

> Proof: book braiding at 2,500 → change the service to 3,000 → the old booking
> still reports 2,500 and revenue is unchanged. Deactivate the service entirely →
> the booking still describes itself. Then the reverse: book after the change →
> 3,000.

**8.5 Catalog hygiene** *(0.25d)*
Remove the hardcoded `Africa/Nairobi` in the tenant read route. Make `active`
filtering consistent across prompt, slots, and booking. Confirm every
tenant-scoped query has `tenantId` (I8) — a read-through of `db/*` and
`api/index.ts`.

> Proof: a tenant with a non-Nairobi timezone returns local dates correctly;
> deactivated service disappears from prompt and slots and is refused by booking.

**8.6 Secrets rotation + preflight** *(0.15d)*
Rotate the Groq key and the Telegram bot token (both have appeared in chat).
Confirm `.env` is untracked; add a preflight check that refuses to start if a
required secret looks like a placeholder.

> Proof: old Telegram token revoked, bot still answers with the new one. `git
> ls-files` shows no `.env`.

**Phase 8 exit:** no unauthenticated read of customer data exists; no price edit
rewrites history; the process refuses to run misconfigured.

---

### Phase 9 — Operations completeness (≈2.5 days)

A booking you cannot cancel is not a booking system. This phase closes the
biggest functional hole and replaces the dashboard's only real job with a
message.

**9.1 Cancel + reschedule in core** *(1d)*
`cancelBooking` and `rescheduleBooking` with the same validation path as create.
Reschedule is cancel-plus-create inside one transaction, keeping the booking id,
re-validating the new slot, and respecting the one-live-booking-per-conversation
rule. Both are pure functions over the same inputs `validateBooking` takes;
neither touches the network.

> Proof: unit tests — cancel frees the interval for a later create; reschedule
> into an occupied slot is refused; reschedule keeps the id and moves both
> `startsAt` and `endsAt`; cancelling twice is idempotent.

**9.2 HTTP surface** *(0.5d)*
`POST /api/tenants/:slug/bookings/:id/cancel` and `.../reschedule`, behind 8.1.
Reschedule takes a `startsAt` that must have come from a slots call for the same
service. 409 when the target slot was taken.

> Proof: integration test — cancel, then rebook the same slot for another
> customer and succeed. Reschedule while a parallel booking takes the target →
> 409, original booking intact.

**9.3 Agent tools** *(0.5d)*
`cancel_booking` and `reschedule_booking`, limited to the booking owned by the
current conversation (the agent already receives `existingBooking`). Prompt
updated with two sentences: it may cancel or move *this* customer's booking, and
must confirm before doing either.

> Proof: agent test — a conversation cancels its own booking and the slot frees;
> it refuses to cancel a booking id from another conversation; "move me to 3pm"
> reschedules rather than creating a second row.

**9.4 Booking status transitions** *(0.25d)*
`pending → confirmed → cancelled | no_show`, plus `statusChangedAt` and a short
`statusReason`. Cancelling records whether the customer, staff, or the agent did
it.

> Proof: every transition is traceable; no row can be cancelled twice with
> different actors.

**9.5 Owner notifications** *(0.5d)*
`tenants.settings.notify.telegramChatId`. Two messages: an instant ping on every
new booking ("Wanjiku · Braiding · Tue 28 Oct 11:00 · Grace"), and a 07:00 digest
of the day. Sent through the existing Telegram channel, no new transport.

> Proof: booking through the widget lands in the owner's chat within seconds. The
> digest fires on schedule with the right rows and timezone.

**9.6 Conversation lifecycle** *(0.25d)*
Auto-close conversations idle for N days (default 14). Closed and human-owned
threads stay silent to the bot — already true in `handleInbound`; this adds the
scheduled transition.

> Proof: a closed thread ignores a new customer message in the bot path but still
> stores it and still notifies.

**Phase 9 exit:** a customer can book, move, and cancel from chat or widget; the
owner sees the day without opening a browser.

---

### Phase 10 — One source of truth for the catalog (≈2 days)

This is the phase that answers "the client adds braids at 2,500 — how does the
engine know?" permanently.

**10.1 Catalog adapter** *(0.75d)*
One interface, one normalized shape. Three implementations behind it:

- `preset` — reads `presets/*.json` (exists today, extracted).
- `manual` — reads what a future editor writes (no UI yet; same interface).
- `remote` — pulls from a client's API/sheet (not built; interface only).

Add `services.source`, `services.externalId`, `tenants.catalogSyncedAt`.

> Proof: same tenant provisioned through two adapters produces identical rows;
> the engine behaves the same regardless of source.

**10.2 `pnpm tenant:apply` — non-destructive** *(0.75d)*
Replaces delete-and-rebuild for live businesses. Default is a **dry run**: print
what would be inserted, updated, deactivated. `--write` applies. Refuses to touch
a tenant with bookings unless `--force`. Removals become `active = false`, never
`DELETE`. `tenant:new` keeps the destructive behaviour and says so loudly — it is
for demos only.

> Proof: run apply twice → row counts identical, no duplicate services, bookings
> survive. Rename a service in the preset → apply → same row updated, no orphan.
> Drop a service → apply → row inactive, bookings still readable.

**10.3 Public services read** *(0.5d)*
`GET /api/tenants/:slug/services` — no auth, CORS limited to
`tenants.settings.allowedOrigins` (plus the tenant's own site), 60-second cache
header. Returns name, duration, price formatted and in minor units, and
`catalogSyncedAt`. Never returns staff phone numbers or anything personal.

> Proof: an allowed origin gets 200; a random origin gets no CORS header; the
> response contains no PII; a price change appears within the cache window.

**10.4 Demo pages render from the API** *(0.5d)*
Both `examples/*` pages drop their hardcoded price blocks and render from
10.3, with the static numbers kept only as a no-JS fallback. `WEB-SPEC` is not
touched.

> Proof: change braiding to 3,000 in the database, reload the page with no
> rebuild → page says 3,000. Ask the bot → 3,000. They agree.

**10.5 One money formatter** *(0.25d)*
Shared formatting so prompt, API and page cannot disagree on rounding or
separators. The model receives formatted strings or unit-labelled fields — never
a bare `priceMinor`.

> Proof: a tool response never contains an unlabelled minor-unit number; prompt
> and page strings match for all seeded services.

**Phase 10 exit:** one edit changes the price everywhere, and a page can never be
stale without saying so.

---

### Phase 11 — Verification harness (≈1.5 days)

You asked to know it works, not just that it is written. This phase makes that
repeatable.

**11.1 Test database** *(0.5d)*
Integration tests run against a Neon branch (or a dedicated schema) created per
run, migrated, seeded, dropped. Never against `main`.

> Proof: two runs in parallel do not interfere; a failed run leaves `main`
> untouched.

**11.2 HTTP integration suite** *(0.5d)*
Auth matrix (8.1), slots, booking 201/409, cancel, reschedule, widget round-trip,
thread read, staff reply. One file per surface.

> Proof: deleting the auth middleware turns the suite red, not green.

**11.3 Concurrency, automated** *(0.15d)*
N parallel booking requests for one slot → exactly one 201, N−1 409, one row.
The guarantee you proved by hand once, now a test.

> Proof: 20 parallel writers, repeated 10 times, always one winner.

**11.4 Restart / resume** *(0.15d)*
Simulated process restart mid-conversation → the thread resumes from the
database with the booking it already owns.

> Proof: history survives, the agent still refuses to double-book.

**11.5 Two-tenant smoke** *(0.15d)*
One script: book at glow-salon, book at fade-factory, read both calendars, assert
zero bleed in bookings, conversations, services and prices.

> Proof: deliberately break the tenant filter in one query → smoke fails.

**11.6 `pnpm verify`** *(0.15d)*
typecheck + unit + integration + smoke in one command, wired into CI.

> Proof: clean clone → install → `pnpm verify` → green, no manual steps.

**Phase 11 exit:** every claim in this document can be checked by a command.

---

### Phase 12 — Real multi-tenancy (≈3 days, pull forward when client #2 signs)

Today one bot serves one tenant chosen by env. That does not scale past the demo.

**12.1 Per-tenant channel config** *(1d)* — bot token, webhook secret and
notification chat id per tenant, stored encrypted or in platform secrets keyed by
slug. Webhook path per tenant.

**12.2 Tenant resolver with cache** *(0.5d)* — slug → tenant, TTL cache, so the
hot path is not a query per request.

**12.3 WhatsApp adapter** *(1d)* — decision required: 360Dialog (paid, stable)
vs Baileys (free, fragile). Same `Channel`, same `handleInbound`. Nothing else
changes, which is the point of the seam.

**12.4 Inbox semantics** *(0.5d)* — per-channel identity, correct unread
computation, staff attribution.

**Phase 12 exit:** two businesses on two channels, one engine, no env edits
between them.

---

### Phase 13 — Privacy and compliance (≈1.5 days)

**13.1 Retention job** *(0.5d)* — delete messages older than the tenant's window
(default 90d). Bookings and services untouched. Log what was deleted, by tenant,
as counts only.

**13.2 Deletion request path** *(0.5d)* — anonymize a customer (name, phone,
transcript) while keeping the booking's business facts. Document the command.

**13.3 Consent + notice** *(0.25d)* — one line in the widget greeting/footer
saying the conversation is recorded and handled by staff; privacy link.

**13.4 Staff attribution** *(0.25d)* — who took over, who replied. Minimal actor
field; full accounts wait for the editor.

**13.5 Client-facing DPA note** *(0.1d)* — in `INSTALL.md`: what we store, for how
long, where the model runs (Groq, US), and how deletion works.

**Phase 13 exit:** a client can answer "what happens to my customers' data?" from
our own document.

---

### Phase 14 — Ship to client #1 (≈2 days)

**14.1 Deploy** — paid instance (warm; free tier sleeps and the first customer of
the morning pays for it), health check, webhook registered, secrets rotated.

**14.2 Backup/restore drill** — restore the Neon branch to a point in time, run
the smoke test against the restored copy. A backup you have not restored is a
rumour.

**14.3 Monitoring** — structured logs, error alert to the owner's Telegram
channel, uptime check on `/api/health`. Alert on "agent failed" rate, not just
liveness.

**14.4 Onboarding checklist** — hours, staff, services with durations and buffers,
prices, notification chat id, allowed origins, timezone. One page, filled in with
the client.

**14.5 Runbook** — price change, staff add, cancel a booking, rotate a token,
roll back a deploy, handle an outage. Written for a non-engineer.

**14.6 Pilot exit criteria** — 7 days of real bookings, zero double-bookings, page
and bot agree on every price, owner uses the digest daily, no unhandled
conversation older than a day.

---

## 5. Reconciliation

### 5.1 `GAPS.md` — all three accounted for

| Gap | Original recommendation | Where it lives now | What changed |
|---|---|---|---|
| **1. Form on customer's site cannot book** | B + A: origin allowlist, then session token | **Partly Phase 8, rest Phase 15** | 8.1 closes the abuse surface for dashboard routes; 10.3 adds the public read and the per-tenant origin allowlist. The write path from a form (idempotency, no-conversation booking, confirmation) stays deferred — the widget already books, and a form is a second product. Revisit when a client insists on a form. |
| **2. Bot is text-only** | `media` on outbound + a `send_media` tool | **Phase 15** | Unchanged and still correctly deferred. No client has asked; it needs a client's CMS to design against. |
| **3. Two places hold prices** | Build-time render from the preset, or a public `GET /services` | **Phase 10, plus 8.4** | Both halves land: 10.3 gives the live read, 10.4 makes the pages consume it. 8.4 adds what GAPS.md missed — the *historical* half. Rendering fresh prices does not fix revenue already rewritten by a price edit. |

### 5.2 `PLAN.md` — every open item carried forward

| PLAN.md item | Status | Destination |
|---|---|---|
| `cancelBooking` / `rescheduleBooking` (Phase 1b, unchecked) | open | **9.1–9.3** |
| Dashboard auth, tenant switcher (Phase 5) | open | **8.1** (machine auth). User accounts deferred with the editor. |
| SSE stream for the widget (Phase 4) | open | **Dropped** — reply rides the POST; streaming is a nicety, not a gap. Recorded in §8 so it is not re-proposed. |
| First real deploy (Phase 7) | open | **14.1** |
| Dashboard auth before it leaves localhost (Phase 7) | open | **8.1** (machine auth); attribution landed in 13.4, user accounts deferred with the editor |
| `presets/bnb.json`, `presets/restaurant.json` | open | **Deferred (§8)** — strategies exist; not advertised until proven |
| WhatsApp adapter | later | **12.3** |
| M-Pesa deposits | later | **Deferred (§8)** — out of v1 by D10 |
| Reminders / no-show follow-ups | later | **Partially 9.5** (digest); full reminders deferred |
| Multi-staff calendar sync | later | **Deferred (§8)** |
| Open Q: which demo preset | answered | `glow-salon` |
| Open Q: Telegram token ownership | answered | **12.1** — one bot per tenant |
| Open Q: timezone per tenant | answered | per-tenant already; **8.5** removes the one hardcoded use |

### 5.3 Findings from the 27 Oct audit — all scheduled

| Finding | Phase |
|---|---|
| No auth anywhere; transcripts and phone numbers readable | 8.1 |
| Unauthenticated LLM proxy → cost abuse | 8.2 |
| Webhook secret defaults to `dev-secret` | 8.3 |
| Price edits rewrite historical revenue | 8.4 |
| Provisioning deletes the tenant | 10.2 |
| No cancel / reschedule | 9.1–9.3 |
| Prices hardcoded in four places | 10.1–10.4 |
| Money unit ambiguity for the model | 10.5 |
| Hardcoded `Africa/Nairobi` | 8.5 |
| Domain-only tests; one-off concurrency proof | 11.1–11.6 |
| Multi-tenancy is env-level, not data-level | 12.1–12.2 |
| `console.error` only; no alerting | 14.3 |
| Free tier sleeps | 14.1 |
| No retention, deletion or consent | 13.1–13.5 |
| Takeover has no actor | 13.4 |
| No backup restore drill | 14.2 |

---

## 6. Execution order

| Order | Phase | Estimate | Blocks |
|---|---|---|---|
| 1 | 8 — Trust floor | 2d | everything |
| 2 | 9 — Operations | 2.5d | first real client |
| 3 | 10 — Catalog | 2d | price drift, `tenant:apply` |
| 4 | 11 — Verification | 1.5d | confidence in 8–10 |
| 5 | 14 — Ship | 2d | revenue |
| 6 | 13 — Privacy | 1.5d | can run in parallel with 14 |
| 7 | 12 — Multi-tenancy | 3d | client #2 |

Phases 8–11 are the critical path: **~8 days** to an engine you can point at a
paying salon without lying to anyone. 14 adds two more. 12 waits for a second
client. 13 is parallelisable.

If time is short: 8 → 9 → 14. Catalog drift is embarrassing; an unauthorised
transcript leak is fatal.

---

## 7. Definition of done (applies to every task)

A task is done when all six are true:

1. The change is in the layer that owns it (`AGENTS.md` §13).
2. No invariant in `AGENTS.md` §4 is broken.
3. Its proof exists and passes — as a test where possible, as a scripted check
   otherwise.
4. `pnpm typecheck` and `pnpm test` are green; `pnpm verify` once phase 11 lands.
5. `AGENTS.md` or this file is updated if a decision, env var, command, or
   dependency direction changed. Undocumented changes are how the last session
   lost its context.
6. The failure it prevents can be described in one sentence.

---

## 8. Explicitly deferred (do not build without a client asking)

| Item | Why not now |
|---|---|
| Dashboard editor / service CRUD UI | D6. The engine works without it; `tenant:apply` covers us. |
| Form bookings on a client site (Gap 1 write path) | The widget already books. A form is a second product surface. |
| Media in chat (Gap 2) | Needs a client's CMS to design against. |
| Payments / M-Pesa deposits | D10. |
| SSE streaming for the widget | Reply rides the POST. One round trip, survives proxies. |
| B&B and restaurant presets | Strategies exist; unproven. Advertising them before proving them is how trust dies. |
| Reminders / no-show automation | Digest first; reminders after a client misses someone. |
| Multi-staff calendar sync (Google/Outlook) | Every client so far uses paper. |
| Per-client databases | D1. |
| User accounts / roles | Machine auth now; accounts with the editor. |

---

## 9. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A leaked transcript before 8.1 ships | medium | fatal | Ship 8.1 first; do not expose the demo with real conversations in the database. Seed only. |
| Price snapshot backfill is wrong for old rows | medium | medium | Backfill from current services, record the date and method in the migration, treat pre-backfill rows as approximate in the UI. |
| Groq model deprecation (happened once already) | high | medium | Model id is env-driven; keep a fallback model and a one-line switch documented. |
| Telegram rate limits / token revocation | medium | medium | Token per tenant in 12.1; alert on send failure. |
| Free-tier sleep loses the first customer of the day | high | high | 14.1 paid warm instance. |
| Dashboard keeps growing despite D6 | medium | high | It is frozen in `AGENTS.md` §2 and §15. Any dashboard PR needs a written reason here. |
| Retention job deletes something it should not | low | high | Dry-run mode first, counts logged, bookings never touched, tested on a branch. |
| Two-tenant bleed from a missing filter | low | fatal | 11.5 smoke test that fails when the filter is removed. |
| Documentation drifts again | medium | high | §7.5: a change that alters a decision updates the doc in the same commit. |

---

## 10. Open decisions (defaults chosen; change them in writing)

| Question | Default chosen | Change if |
|---|---|---|
| Catalog source for client #1 | `preset` + `tenant:apply` | the client has an API and edits prices weekly |
| Retention window | 90 days for transcripts | a client demands otherwise, or storage cost bites |
| WhatsApp vendor | decide at 12.3 | client #2 asks for WhatsApp before signing |
| Dashboard future | frozen, internal only | three clients ask for a login in writing |
| Per-tenant bots | yes (12.1) | client #2 arrives sooner — then 12.1 jumps the queue |

---

## 11. Relationship to other docs

```
AGENTS.md      rules, invariants, map           ← read first
PLAN-V2.md     order of work, proofs, decisions ← this file
INSTALL.md     customer-facing setup            ← keep current
WEB-SPEC*.md   frozen dashboard contract        ← no new work
PLAN.md        phases 1–7, historical           ← do not edit
GAPS.md        three gaps, historical           ← do not edit
```

When this plan and `AGENTS.md` disagree, `AGENTS.md` wins on rules and this file
wins on order. When they disagree with the code, the code is wrong or the docs
are stale — fix one of them in the same commit.
