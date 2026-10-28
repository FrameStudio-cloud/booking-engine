# AGENTS.md — booking-engine

Read this file before touching anything. It exists because a previous session lost
the plot: the code was fine, the context was not. If you are about to make a
decision this file already made, stop and follow it. If you think a decision here
is wrong, say so and change *this file* in the same commit — do not diverge
silently.

Last updated: 27 October 2026. Current plan: `PLAN-V2.md`.

---

## 1. What this is

A booking engine for small service businesses in Kenya (salons, barbershops,
later B&Bs and restaurants). One engine, many businesses, many channels.

A business gets:

- a **widget** they embed on their own site with one script tag,
- a **Telegram bot** (or WhatsApp, later) that answers the same questions,
- a **calendar** that cannot double-book, across both channels, because both go
  through one booking path.

They do **not** get a website from us. They keep their own site. We give them the
brain and the chat bubble.

## 2. What this is not

- **Not a SaaS dashboard product.** `apps/web` exists to inspect data during
  development. It is frozen: no new features, no new pages. The product surface
  is the API, `/widget.js`, and the bot. Awareness for the business owner is a
  Telegram digest, not a login.
- **Not a CMS.** We never own the canonical price list. See §6.
- **Not a payments product.** Bookings only; payment happens at the business.
  The schema leaves room; nothing else.
- **Not a per-business codebase.** A new business is a config file or an API
  call. If you find yourself writing `if (tenant === "glow-salon")`, the design
  has failed.
- **Not finished.** Read `PLAN-V2.md` for what is true today and what is next.
  Do not assume a phase is done because a file exists.

## 3. Architecture map

```
apps/
  api       Hono server. HTTP for dashboard, widget, Telegram webhook.
  web       Dashboard shell. FROZEN. Internal tool only.
  widget    Preact + Shadow DOM IIFE bundle. Public, embedded anywhere.
packages/
  shared    Zod schemas + types. No IO.
  db        Drizzle schema, migrations, repositories, provisioning, seed.
  core      Availability + booking logic. No network, no AI, no DB.
  agent     System prompt + tool definitions. Calls core through a port.
  channels  Channel interface + handleInbound pipeline. Transport-agnostic.
```

Dependency direction is one-way: `api -> {agent, channels, db, core, shared}`,
`agent -> core` via an interface, `channels -> nothing`. `core` must stay pure.
If `core` ever imports `db`, drizzle, or a network client, the package split has
been wasted.

### The three seams

1. `AvailabilityStrategy.findSlots` — the only thing that differs per business
   type (staff × service × time, unit × nights, table × party size).
2. `Channel.send` — the only outbound door. Used by **both** the bot and a human
   staff member, so a customer never gets two voices in one thread.
3. `tools[]` — the model's only way to touch a booking. It cannot read the
   schedule and it cannot invent a slot.

## 4. Invariants — never break these

**I1. One write path.** Every booking goes through `validateBooking` +
`createBooking`. No second path to the `bookings` table, ever. Not from the
dashboard, not from a webhook, not from a script.

**I2. No invented slots.** `create_booking` refuses any `startsAt` that
`check_availability` did not return earlier in that same conversation. The
`offered` set is not an optimisation; it is the anti-hallucination guard.

**I3. One live booking per conversation.** A chat owns at most one non-cancelled
booking. Enforced in the database (`conversations` + a guard inside
`createBooking`), not only in the prompt.

**I4. Local time is the only time a customer sees.** Tools return `localTime`
(wall clock) alongside UTC `startsAt`. The model quotes `localTime`. Never
`am`/`pm`. Never an ISO string. Never a UTC hour.

**I5. The prompt is generated.** `buildInstructions` is built per tenant per
turn from the database. No business-specific sentences. If the prompt needs a
fact, the fact goes in `tenants.facts` or `settings`, not in the template.

**I6. The engine may be the only place a booking exists. It must never be the
only place a price exists.** See §6.

**I7. History is immutable.** A booking row carries the service name, duration
and price that were agreed at the time. Changing a service later must not
rewrite what a customer already agreed to.

**I8. Every tenant-scoped query filters by `tenantId`.** No exceptions. A missing
tenant filter is a data leak between clients, which ends the relationship.

**I9. Persist before reply.** Inbound messages are stored before the model runs;
outbound is stored before delivery. A crash mid-turn must not lose the
customer's words.

**I10. Fail loudly, never silently.** A missing secret must stop the process, not
fall back to a default. A failed send is reported, not swallowed.

## 5. Money

- Stored as **minor units**, integer: `250000` is KES 2,500. Never floats.
- Displayed through one shared formatter so the bot, the API and any page agree.
- `priceMinor` on a service is a **quote**, not a payment.
- `bookings.priceMinorAtBooking` is the agreed amount. Revenue reads the
  snapshot, never the current service price.
- The model must never receive a raw minor-unit number without units. If a tool
  returns money, format it or name the unit in the field.

## 6. Catalog — where prices actually live

One canonical source per tenant. Three possible sources, one normalized shape:

| Source | Who edits it | Used for |
|---|---|---|
| `preset` | us, a JSON file + `pnpm tenant:apply` | client #1, demos |
| `dashboard` | the client, later | once there is an editor |
| `remote` | the client's own site/API/sheet | when a client asks and has an API |

Rules:

- The engine keeps a **replica** in `services`, with `catalog_synced_at` and a
  per-service `source` + `external_id`.
- **Never fetch the catalog live inside a request.** A live fetch means the
  client's shared hosting being down stops bookings, and the price can change
  between the quote and the insert. Replicate, timestamp, and say when it is
  stale.
- The client's public page either renders from the canonical source or from our
  public read endpoint. It never hardcodes a number we also hold.
- A booking snapshots the price. This is what makes a retention cleanup safe.
- Deleting a service is `active = false`. `bookings.serviceId` is
  `onDelete: restrict` on purpose.
- The live path is `pnpm tenant:apply <preset> --write`. Dry run first: it prints
  what would be created, changed or deactivated, and refuses to write over a
  tenant with bookings without `--force`. `pnpm tenant:new` deletes first and is
  for demos only.
- The customer's page reads `GET /api/tenants/:slug/services` (no key, 60s
  cache). It must never hardcode a price the engine also holds. Static numbers in
  a page are allowed only as a no-JS fallback.

## 7. Time

- Every tenant has a `timezone`. Use it. Never hardcode `Africa/Nairobi` in a
  handler, even if every current client is in Kenya.
- Slot math is DST-safe and covered by tests. Do not hand-roll date arithmetic;
  `packages/core/src/time.ts` exists for this.
- Dates crossing midnight are not evaluated against daily opening hours (stays).
  Salons never hit this; B&Bs always do.

## 8. Security

- Every `/api/tenants/*` route requires the machine credential, with two public
  exceptions: `/widget/*` (the embed) and `GET /:slug/services` (the customer's
  public price list). Both are rate limited and return only that tenant's own
  marketing data. Everything else is keyed.
- Channel credentials live in `tenant_channels`, sealed with AES-256-GCM under
  `CHANNEL_SECRET_KEY`. No route returns them; only the API process opens them.
  A webhook secret is **derived** (`HMAC(key, "webhook:<channel>:<tenantId>")`),
  never stored — which means rotating the key re-keys every webhook at once.
- The database is therefore not enough to impersonate a business: an attacker
  with a dump still needs the process key. Do not put that key in the same
  backup, repo or password manager entry as the connection string.
- CORS is not authentication. It restricts browsers, not `curl`. Do not treat an
  origin allowlist as a door.
- Secrets live in `.env` (untracked) or the platform's env. `render.yaml` marks
  them `sync: false`. Nothing secret goes in the widget bundle.
- Webhook mode with no secret must refuse to start. No default secret strings.
- Rotate any token that has ever appeared in chat or a screenshot.
- Rate limit the LLM routes. They cost money per call and are reachable from the
  public internet.

## 9. Privacy

- We store names, phone numbers and full chat transcripts. That is personal data
  under Kenya's Data Protection Act 2019.
- Transcript retention is bounded (`settings.privacy.retentionDays`, default 90,
  per tenant). `runRetention` runs from the scheduler once per tenant per day and
  deletes messages older than that window. Bookings and services are never
  touched — their snapshots are what make the cleanup safe.
- `pnpm tenant:erase <slug> --phone=… [--write]` (or `--external-id=`) anonymises
  one customer: name and phone gone, transcript deleted, chat identity replaced
  with `erased-<id>`, while the booking keeps service, time, duration and price.
  Dry run by default. Never log message content from either path — counts only.
- The widget shows a consent line before the customer types
  (`privacy.notice`, with a default; `privacy.url` for the business's policy).
- The model provider (Groq, US) receives message content. That is stated in
  `INSTALL.md` §6, not only here.

## 10. Testing — proof over assertion

A feature is not done because it compiles. It is done when the failure mode it
addresses can be demonstrated.

- Domain logic: Vitest in `packages/*`. Fast, no network, no DB.
- HTTP + DB: integration tests in `apps/api/src/__tests__`, against a throwaway
  Postgres schema per test file (`packages/db/src/testing.ts`). Auth, booking
  races, cancel, reschedule, tenant isolation, restart/resume, channel
  credentials, the slug cache, unread counts, retention windows, erasure and
  staff attribution. They need `DATABASE_URL_DIRECT` or `DATABASE_URL` and fail
  loudly without one.
- The app must stay importable: `apps/api/src/index.ts` builds routes only.
  `server.ts` owns the port, the bot, the scheduler and the webhook route. Never
  move that back into `index.ts` — the harness depends on importing the app
  without side effects.
- Two seams exist for tests: `useDatabase()` in `apps/api/src/db.ts` and
  `TurnInput.agentRunner` in `pipeline.ts`. Replace only the socket and the model.
- Time-dependent bugs get a test with an injected clock, not a comment.
- Concurrency claims get a test with parallel writers, not a one-time manual run.
- `pnpm verify` is the gate: typecheck + unit + integration + two-tenant smoke.
  If a suite has to be skipped, it is not a gate.

## 11. Commands

```bash
pnpm install
pnpm dev          # api :8787, dashboard :5173, widget harness
pnpm test         # unit + integration (needs DATABASE_URL)
pnpm test:unit    # packages only: fast, offline
pnpm test:integration  # API + real Postgres (schema per file)
pnpm typecheck
pnpm verify       # typecheck + everything; the only gate that matters
pnpm demo         # build widget, serve examples/glow-salon on :8080
pnpm start        # build widget, serve API + bundle on one host
pnpm db:generate  # drizzle migration from schema
pnpm db:migrate   # apply migrations
pnpm db:seed      # demo business from presets/glow-salon.json
pnpm tenant:apply presets/x.json   # non-destructive upsert: dry run, --write to apply
pnpm tenant:new presets/x.json     # destructive provision (demos only)
pnpm tenant:channel <slug> --adopt-env          # attach a Telegram bot, sealed in the DB
pnpm tenant:channel <slug> --show | --remove    # webhook URL / disable it
pnpm tenant:erase <slug> --phone=+2547… [--write]  # delete one customer's data, dry run by default
```

## 12. Env

| Name | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon pooled connection |
| `DATABASE_URL_DIRECT` | for migrations | direct, non-pooled |
| `GROQ_API_KEY` | for chat | absent = chat routes return 503 |
| `LLM_MODEL` | no | default `openai/gpt-oss-120b` |
| `TELEGRAM_BOT_TOKEN` | for Telegram | optional |
| `TELEGRAM_MODE` | no | `polling` local, `webhook` prod |
| `TELEGRAM_TENANT_SLUG` | for Telegram | single-bot phase only |
| `TELEGRAM_WEBHOOK_SECRET` | webhook mode | required, no default |
| `CHANNEL_SECRET_KEY` | when a tenant has a stored channel credential | 32 bytes, base64; seals tokens, derives webhook secrets |
| `PUBLIC_BASE_URL` | for printing webhook URLs | `https://api.example.com` |
| `ENGINE_API_KEY` | yes (phase 8) | machine auth for `/api/tenants/*` |
| `DASHBOARD_ORIGIN` | yes | dashboard CORS origin |

## 13. Where to change what

| I want to… | Touch |
|---|---|
| add a field to a service | `shared` schema → `db` schema → migration → `db/repo` mappers → `agent/prompt` if the model must see it → `api` response |
| add a business type | `shared` enum → `db` enum + migration → a strategy in `core` → a preset |
| change what the bot says | `agent/prompt.ts` (template) or `tenants.facts` (content) — never hardcode a business |
| add an API route | `apps/api/src/index.ts`, tenant-scoped, auth applied |
| add startup work (a port, a bot, a timer) | `apps/api/src/server.ts` — never `index.ts`, which must stay importable |
| change how integration tests get a database | `packages/db/src/testing.ts` (schema, migrations, seed) and `apps/api/src/__tests__/harness.ts` (app, helpers) |
| add a channel | implement `Channel` in `packages/channels`, reuse `handleInbound` |
| attach a bot to a business | `pnpm tenant:channel <slug> --adopt-env` — never a new env var, never a per-client branch |
| delete a customer's data | `pnpm tenant:erase <slug> --phone=… --write` — never hand-written SQL |
| change retention | `settings.privacy.retentionDays` in the preset, then `tenant:apply` |
| change availability logic | `packages/core`, then add a test that fails before the change |
| change prices | never by editing a page. Catalog source, then sync/snapshot |

## 14. Documentation map

| File | Status | Purpose |
|---|---|---|
| `AGENTS.md` | **current** | How to work here. Read first. |
| `PLAN-V2.md` | **current** | Roadmap, phases, proofs, decisions |
| `INSTALL.md` | current | Customer-facing setup, deploy |
| `WEB-SPEC.md`, `WEB-SPEC-STATES.md` | frozen | Dashboard contract. No new work. |
| `PLAN.md` | historical | Phases 1–7 as they happened. Superseded. |
| `GAPS.md` | historical | Three gaps as they stood. Absorbed into PLAN-V2. |

If you add a doc, add it to this table in the same commit. An unlisted doc is a
doc nobody will read.

## 15. Don'ts

- Don't build the dashboard out. It is frozen.
- Don't add a second way to write a booking.
- Don't let the model see a slot it did not get from `check_availability`.
- Don't duplicate a price into a page, a preset and a database without a
  canonical source and a snapshot.
- Don't delete a tenant to apply a config change.
- Don't fetch the catalog inside a request path.
- Don't commit `.env`, tokens, or screenshots of tokens.
- Don't add a dependency to `core`.
- Don't mark a phase done without its proof.
