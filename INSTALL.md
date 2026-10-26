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
pnpm tenant:new presets/kilimani-spa.json
```

The command validates the file, prints what it created, and gives you the snippet
for that customer. A field you get wrong is named by path, e.g.
`services.0.durationMinutes: Expected number, received string`.

**It replaces.** Provisioning a slug deletes that tenant and everything under it
(services, hours, bookings, conversations) before rebuilding from the file. That
is right for onboarding and demo resets, wrong for a business already taking
bookings. To change a live business, edit the rows — not the preset.

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

## 4. When you add a feature

Add it to the engine, deploy the API, and every customer site has it. Rebuild the
widget bundle only when the widget's own behaviour changes — not when a customer
changes their colours, prices, staff or hours.
