# Install kit

The automation is built once. A new customer site is a page you write, plus one
script tag that points the page at their business.

```html
<script src="https://YOUR-API-HOST/widget.js" data-tenant="glow-salon"></script>
```

That is the whole integration. The API serves its own widget bundle, so one URL
covers both: the script finds the engine on the origin it was loaded from. Add
`data-api="https://other-host"` only if you serve the bundle from a CDN.

The bubble, the panel, the conversation, the availability rules and the booking
all come from the engine. Nothing about a specific business lives in the widget
bundle — name, greeting, colours, services, staff and hours are read from the
database at runtime. **One widget build serves every customer.**

---

## 1. Add a business

Copy the closest preset and edit it. No code, no migrations.

```
presets/
  glow-salon.json      # salon: staff × service × time
  fade-factory.json    # barbershop: late hours, single-service walk-ins
```

```bash
cp presets/glow-salon.json presets/kilimani-spa.json
# edit slug, name, brand.accent, widget.greeting, facts, services, resources, hours
pnpm tenant:apply presets/kilimani-spa.json           # dry run: prints the diff
pnpm tenant:apply presets/kilimani-spa.json --write   # applies it
```

The command validates the file, prints exactly what would be added, changed or
deactivated, and writes nothing until you pass `--write`. A field you get wrong
is named by path, e.g. `services.0.durationMinutes: Expected number, received
string`.

**Changing a live business is the same command.** Edit the preset, run
`tenant:apply`. Services and staff that disappear from the file are set inactive,
never deleted, and existing bookings keep the price and duration they were made
at. Running it twice changes nothing the second time.

`pnpm tenant:new` still exists for demos, and **deletes** the slug first. Never
run it against a business with real bookings.

### Connect their Telegram bot

Each business talks through its own bot, and the token belongs to the business,
not to the deployment. Adding client #2 does not touch `.env`:

```bash
pnpm tenant:channel kilimani-spa --telegram-token=123456789:AA...   # or --adopt-env
pnpm tenant:channel kilimani-spa --show                             # prints the webhook URL
pnpm tenant:channel kilimani-spa --remove                           # stops listening, keeps the row
```

The command asks Telegram who the token belongs to before writing it, then stores
it encrypted (AES-256-GCM, keyed by `CHANNEL_SECRET_KEY`). The webhook secret is
derived from that key and the tenant id, so it is printed rather than stored.
Register the URL Telegram prints:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<the URL it printed>"
```

Two consequences worth knowing: rotating `CHANNEL_SECRET_KEY` changes every
webhook URL (re-register them all), and the database alone cannot impersonate a
business — the process key is needed too. Keep them apart.

The running API reads channel rows at boot, so **restart the service** after
adding or removing a bot. Nothing else about that business needs a deploy.

### What the file controls

| Key | Effect |
| --- | --- |
| `slug` | The only thing the customer's script tag needs |
| `name`, `facts` | What the agent may say: address, parking, payment, policies |
| `services` | Name, duration, price, buffer between appointments |
| `resources` | Who or what takes a slot — staff, units, tables |
| `hours` | Weekly opening hours, `0` = Sunday |
| `brand.accent`, `brand.position` | Widget colour and corner |
| `widget.greeting`, `widget.replyTime` | First line and the header subtitle |
| `demoBooking` | Optional: one row so a fresh demo has something to work around |

Prices are minor units — `250000` is KES 2,500. Times are `HH:MM` in the tenant's
timezone.

## 2. Build the customer's site

Write the page however you like — the two demos are plain static pages with no
framework, and both are fine starting points to copy:

```
examples/glow-salon/     # warm, editorial; bundle served beside the page
examples/fade-factory/   # bold, dark; one tag, bundle served by the API
```

Then:

1. Drop the snippet in before `</body>`, with their slug.
2. Optionally point your own buttons at the chat:

```html
<button onclick="window.BookingWidget.open()">Book in chat</button>
```

The widget lives in a Shadow DOM, so the host page's CSS cannot break it and its
CSS cannot leak out. It is ~20 kB raw, ~8 kB gzipped.

### Prices on their page

Never type a price into their HTML. Read it from the engine:

```
GET /api/tenants/<slug>/services
```

No key needed — a public page cannot hold one. It returns the business name,
currency, `catalogSyncedAt`, and each active service with `durationMinutes`,
`priceMinor` and a formatted `price` (e.g. `"KES 2,500"`). Cached for 60 seconds.
It never returns staff details or bookings.

The demo pages do exactly this, keeping their static rows as a no-JS fallback, so
one change in the preset reaches the page and the bot together.

If the customer wants the list locked to their own domain, add
`allowedOrigins` to the preset:

```json
"allowedOrigins": ["https://glowsalon.co.ke"]
```

Empty means any origin, which is fine for a public price list.

## 3. Run it

```bash
pnpm install
pnpm dev            # api on :8787, dashboard on :5173, widget harness
pnpm demo           # build the widget, serve examples/glow-salon on :8080
```

`pnpm demo` copies the built bundle next to the demo site, so the page's
`./widget.js` is always the current build.

The API needs, in `.env`:

```
DATABASE_URL=            # Neon
GROQ_API_KEY=            # chat model
TELEGRAM_BOT_TOKEN=      # optional: only if this business uses Telegram
TELEGRAM_MODE=polling    # polling locally, webhook in production
TELEGRAM_TENANT_SLUG=glow-salon

DASHBOARD_ORIGIN=http://localhost:5173
```

Never ship `.env`, and never put the model key in the widget — the widget only
ever talks to your API.

## 4. Deploy

One web service is enough. It builds the widget, then serves the API *and* the
bundle, so the snippet you hand a customer points at that single host.

`render.yaml` is a Render blueprint for exactly this: Frankfurt (closest to
Kenya), `pnpm start` as the start command, `/api/health` as the health check.

1. Push the repo to GitHub.
2. Render → **New → Blueprint** → pick the repo. It reads `render.yaml`.
3. Fill the secret env vars it asks for: `DATABASE_URL` (Neon pooled),
   `GROQ_API_KEY`, `CHANNEL_SECRET_KEY`, `DASHBOARD_ORIGIN`. `ENGINE_API_KEY`
   too. The old `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` pair is only
   needed if you have not moved that business onto `tenant:channel`.
4. Deploy. Then check `https://YOUR-APP.onrender.com/api/health`.
5. Attach each business's bot and register its webhook:

```bash
pnpm tenant:channel glow-salon --telegram-token=... --url=https://YOUR-APP.onrender.com
# prints the exact setWebhook URL — /webhooks/telegram/<slug>/<derived secret>
```

Production snippet for a customer site — one line, that host:

```html
<script src="https://YOUR-APP.onrender.com/widget.js" data-tenant="glow-salon"></script>
```

Notes that will bite:

- **Free instances sleep.** The first message after idle can take ~30s while the
  instance wakes. Fine for a demo, not for a paying salon; the cheapest paid
  instance stays warm.
- **`TELEGRAM_MODE=webhook` in production.** Polling needs a long-lived process.
- **Two origins, one CORS rule.** `DASHBOARD_ORIGIN` must be the dashboard's real
  origin or its requests are refused. Widget routes answer any origin by design
  and are safe to expose — they only speak to one tenant's own data.
- The dashboard is a staff tool. Host it separately (Vercel/Netlify static) or
  leave it local until auth exists; without auth anyone with the URL can read the
  inbox.

## 5. When you add a feature

Add it to the engine, deploy the API, and every customer site has it. Rebuild the
widget bundle only when the widget's own behaviour changes — not when a customer
changes their colours, prices, staff or hours.

## 6. Customer data — the answer to give a client

This is the section to send when a business asks "what happens to my customers'
data?" It is accurate as of the code in this repo, not a template.

**What we store**

| Data | Where | Why |
|---|---|---|
| Customer name, phone | `bookings` (snapshot) and `conversations` | to hold the slot and greet them |
| Chat transcript | `messages` | so the bot can continue a thread and staff can help |
| Service, time, duration, price agreed | `bookings` (snapshot columns) | so history cannot be rewritten by a later price change |
| Staff display name on a reply | `messages.author` | so the customer knows a person answered |

We do **not** store payment details. Payment happens at the business.

**How long**

- Chat transcripts: **90 days by default**, per business, configurable in the
  preset (`privacy.retentionDays`). A scheduled job deletes older messages once a
  day. It logs a count, never content.
- Bookings, services and prices: kept. They are the business's records, and they
  carry their own snapshots, so they stay meaningful without the transcript.

**Who else sees it**

- **Groq** (United States) receives the message content of a turn, because that
  is where the model runs. Nothing else leaves our database.
- **Telegram / WhatsApp** carry the messages if that channel is used; the
  business's own bot token is used, and it is stored encrypted.
- Staff see the inbox through the dashboard. The dashboard is a staff tool and
  has no public login yet — do not host it on a public URL until it does.

**Deleting one customer, on request**

```bash
pnpm tenant:erase glow-salon --phone=+254712345678           # shows what matches
pnpm tenant:erase glow-salon --phone=+254712345678 --write   # erases it
```

Also accepts `--external-id=<chat id>`. What happens:

- the booking stays, with its service, time and price — the calendar and the
  revenue still add up;
- the customer's name becomes "Deleted customer" and the phone number is removed;
- the conversation loses its name, phone and chat identity, and its transcript
  is deleted.

A dry run is the default; `--write` is required. Nothing printed contains
message content.

**What the customer is told**

The widget shows, under the input and before they type: *"This chat is recorded
so we can help you, and our team can read it."* A business can override that line
and add a link to its own policy with `privacy.notice` and `privacy.url` in its
preset.

**What we do not have yet**

- No self-service export or deletion portal. Requests go through the command
  above.
- No formal Data Processing Agreement template. If a client needs one signed,
  that is a conversation, not a config change.
