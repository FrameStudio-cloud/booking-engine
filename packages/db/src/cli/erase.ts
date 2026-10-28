// Erases one customer's data, on request.
//
//   pnpm tenant:erase glow-salon --phone=+254712345678          # dry run
//   pnpm tenant:erase glow-salon --phone=+254712345678 --write  # applies it
//   pnpm tenant:erase glow-salon --external-id=123456789 --write
//
// What survives: the booking's business facts — service, time, duration, price.
// What goes: the name, the phone number, the transcript, and the chat identity.
// The calendar and the revenue still add up; the person is no longer in the
// database.
//
// Nothing printed here contains message content.
import { createDb } from "../client";
import { getTenantBySlug } from "../repo";
import { applyErase, planErase } from "../privacy";
import { databaseUrl } from "./env";

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith("--"));

function flag(name: string): string | undefined {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  return match?.slice(name.length + 3);
}

const url = databaseUrl();
const write = args.includes("--write");
const phone = flag("phone");
const externalId = flag("external-id");

if (!slug || (!phone && !externalId)) {
  console.error("usage: pnpm tenant:erase <slug> --phone=+254712345678 [--write]");
  console.error("       pnpm tenant:erase <slug> --external-id=<chat id> [--write]");
  process.exit(1);
}

const db = createDb(url);
const tenant = await getTenantBySlug(db, slug);

if (!tenant) {
  console.error(`no business with slug "${slug}"`);
  process.exit(1);
}

const plan = await planErase(db, tenant.id, { phone, externalId });

console.log(`${tenant.name} (${tenant.slug})`);
console.log(`  matched conversations  ${plan.conversations.length}`);
console.log(`  matched bookings       ${plan.bookings.length}`);
console.log(`  messages to delete     ${plan.messages}`);

if (plan.conversations.length === 0 && plan.bookings.length === 0) {
  console.log("");
  console.log("nothing matched — try the full phone number, or --external-id.");
  process.exit(0);
}

if (!write) {
  console.log("");
  console.log("dry run — nothing written. add --write to erase.");
  process.exit(0);
}

const applied = await applyErase(db, plan);

console.log("");
console.log(
  `erased: ${applied.conversations} conversation(s), ${applied.messages} message(s), ${applied.bookings} booking(s) anonymised.`,
);
console.log("bookings keep their service, time and price; the customer is now \"Deleted customer\".");
process.exit(0);
