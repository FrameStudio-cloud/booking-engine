> **Historical — absorbed into [`PLAN-V2.md`](./PLAN-V2.md) §5.1.**
> All three gaps are now scheduled (Phase 10, Phase 15) or explicitly deferred.
> Do not treat this file as the current backlog.

# Open gaps

Three things stand between the engine as it is and handing it to a paying client.
This file is for deciding, not for tracking work — PLAN.md tracks work.

Status: **discussion**, nothing here is built.

---

## Gap 1 — A form on the customer's site cannot book

**Correction to an earlier claim:** the write endpoint exists.
`POST /api/tenants/:slug/bookings` validates the slot, then writes through
`createBooking` under a row lock, returning `409` if it lost a race. `GET
/api/tenants/:slug/slots` exists too. The booking logic is already there.

The door is just locked from the wrong side.

### What is actually broken

1. **CORS.** Both routes live under `/api/tenants/…`, so the global middleware
   answers them with `Access-Control-Allow-Origin: DASHBOARD_ORIGIN`. A page on
   `glowsalon.co.ke` gets a failed preflight — it cannot read slots or submit a
   booking from the browser. Only the dashboard can.
2. **No identity.** The route trusts its body. A site can post any `customerName`,
   any `customerPhone`, and a free-text `source` of its choosing.
3. **No idempotency.** Double-tap "Book", or a retry after a flaky network, and
   you get two bookings. The chat is protected by one-booking-per-conversation;
   a form has no conversation, so nothing protects it.
4. **No abuse limit.** Anyone with the slug can fill the calendar. Today the only
   scarce thing is knowing the slug — which is public by design.
5. **No confirmation.** Nothing tells the customer it worked beyond the page, and
   nothing tells the salon. A form booking also creates no conversation row, so
   it never appears in the Inbox — only in Bookings (which is correct, but staff
   should still be told).
6. **No linkage.** `bookings.conversation_id` stays null, so "this booking came
   from that chat" is lost, and a subsequent chat can't say "you already have a
   booking" unless we look it up by name/phone.

### Options

| Approach | Cost | What it buys |
| --- | --- | --- |
| **A. Session token** — `POST /widget/session` returns an opaque token; slots + booking require it | Small | Idempotency key, per-session rate limit, ties form bookings to a session for dedupe |
| **B. Origin allowlist per tenant** — `settings.allowedOrigins`; CORS echoes only those | Small | Stops a slug being embedded/abused from anywhere else |
| **C. Nothing new; just open CORS on `/widget/*` and move slots+booking under it** | Smallest | A form that works, open to abuse |
| **D. Email/SMS confirmation** | Medium | Turns a form into a real booking experience |

### Recommendation

**B + A, in that order.** Allowlist is one column and one middleware branch and
makes the slug useless to strangers. A session token then gives idempotency
(`Idempotency-Key` header or a `requestId` body field) and a place to attach rate
limits. Skip D until a client asks.

Both must keep the existing invariant: **every write goes through
`validateBooking` + `createBooking`**. No second path to the bookings table.

### Open questions

- Does a form booking belong in the Inbox at all, or only in Bookings?
- Customer-facing confirmation: the page itself, or a message to their Telegram?
- Do we generate the form, or does the person building the site write it against
  `GET /slots`? (If we generate it, it becomes a second widget.)

---

## Gap 2 — The bot is text-only

`OutboundMessage` is `{ text, quickReplies }`. Telegram maps that to a message;
the widget renders a paragraph. Inbound non-text is refused with "I can only read
text for now".

So a client cannot say "send them our price list photo" or "let them send a
picture of the style they want".

### What it takes

- **Outbound:** add `media?: { url, kind: "image" | "video", caption? }[]` to
  `OutboundMessage`. Telegram channel → `sendPhoto` / `sendVideo`; widget renders
  `<img>` / `<video>` under the caption. One shape, both channels.
- **Agent access:** a `send_media` tool reading a per-tenant media list —
  `label`, `url`, `kind`, `tags`. New table (`media`) or a `settings.media`
  array. Tool-driven, never automatic: an image on every turn is noise and cost.
- **Source of the files:** the client's CMS, referenced by URL. The engine should
  not host images. Risk: hotlink protection or expiring CDN URLs — then we need
  a proxy or a copy.
- **Inbound:** a customer photo is personal data. Minimum: store the file id/URL
  on the message row so staff can see it, and say "thanks, a team member will
  look". Don't attempt image understanding in v1.

### Open questions

- Do we want the bot sending pictures at all for salons, or is this a B&B thing
  (room photos)? It changes which tenant type carries the feature.
- Retention: how long do we keep customer-sent media, and who deletes it?
- Is a `media` table worth it before a second client asks?

---

## Gap 3 — Two places hold the prices

The preset holds services, prices and hours. The demo pages hardcode the same
numbers. The dashboard reads them from Postgres. Nothing reconciles them.

The failure looks like this: a salon raises braiding from 2,500 to 3,000 in the
dashboard; the page still says 2,500; the bot quotes 3,000; the customer argues
at the desk. Same class of bug for opening hours and closed days.

### Options

| Approach | Freshness | Cost |
| --- | --- | --- |
| **Render the price table at build time from the preset** | Stale until redeploy | Smallest — a script |
| **Tiny fetch on page load** to a public `GET /services` | Always fresh | Needs CORS + a fallback for the no-JS case |
| **Engine is canonical; push changes to the CMS** via webhook | Fresh, but two writes | Largest |

### Recommendation

**Build-time render from the preset**, plus a public read endpoint later if a
client edits prices often enough to care. The rule to write down: *marketing copy
lives in the CMS; anything the bot will say lives in the engine.*

### Open questions

- Is the salon page allowed to say prices at all, or only "from KES 800"? (Changes
  the drift surface.)
- Do we generate the page's service section, or just validate it in review?

---

## Not in this document

Tracked elsewhere in PLAN.md, deliberately out of scope here: dashboard auth,
per-tenant Telegram bots, B&B/restaurant slot strategies, cancel/reschedule tools,
and the first real deploy.

## Suggested order

1. **Gap 1 (B + A)** — blocks the next real client conversation, and it is the
   difference between "a chat bubble" and "a booking system on your site".
2. **Gap 3 (build-time render)** — an afternoon, and it prevents the most
   embarrassing support call.
3. **Gap 2** — biggest, needs a client's CMS to design against. Wait until one
   asks.
