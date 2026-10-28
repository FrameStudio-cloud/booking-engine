// Applies a config file to an existing business without destroying data.
//
//   pnpm tenant:apply presets/glow-salon.json           # dry run, prints the diff
//   pnpm tenant:apply presets/glow-salon.json --write   # applies it
//
// Unlike `tenant:new`, nothing is deleted. Missing services and staff become
// `active = false`, so old bookings still read their snapshots.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { tenantConfigSchema } from "@booking/shared";

import { createDb } from "../client";
import { applyTenant, planTenant, type RowChange } from "../apply";
import { databaseUrl } from "./env";

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
const write = args.includes("--write");
const force = args.includes("--force");

if (!file) {
  console.error("usage: pnpm tenant:apply <preset.json> [--write] [--force]");
  process.exit(1);
}

const candidates = [resolve(process.cwd(), file), resolve(process.cwd(), "../..", file)];
const path = candidates.find((candidate) => existsSync(candidate));

if (!path) {
  console.error(`cannot find ${file} (looked in ${candidates.join(", ")})`);
  process.exit(1);
}

const raw = await readFile(path, "utf8").catch(() => {
  console.error(`cannot read ${path}`);
  process.exit(1);
});

const parsed = tenantConfigSchema.safeParse(JSON.parse(raw));

if (!parsed.success) {
  console.error(`${basename(path)} is not a valid tenant config:\n`);
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  process.exit(1);
}

const config = parsed.data;
const db = createDb(databaseUrl());

function describe(change: RowChange): string[] {
  return [
    ...change.create.map((name) => `+ ${name} (new)`),
    ...change.restore.map((name) => `+ ${name} (back on)`),
    ...change.update.map((name) => `~ ${name} (changed)`),
    ...change.retire.map((name) => `- ${name} (deactivated)`),
  ];
}

function report(plan: Awaited<ReturnType<typeof planTenant>>): void {
  const lines: string[] = [`${config.name} (${config.slug})`];

  if (plan.isNew) {
    lines.push("", "  new business — everything below will be created");
  }

  if (plan.tenantFields.length > 0) {
    lines.push("", `  tenant     ${plan.tenantFields.join(", ")}`);
  }

  for (const [label, change] of [
    ["services", plan.services],
    ["staff", plan.resources],
  ] as const) {
    const rows = describe(change);
    if (rows.length > 0) {
      lines.push("", `  ${label}`);
      for (const row of rows) lines.push(`    ${row}`);
    }
  }

  if (plan.hours.changed) {
    lines.push("", `  hours      ${plan.hours.before} → ${plan.hours.after} rule(s)`);
  }

  console.log(lines.join("\n"));
}

if (!write) {
  const plan = await planTenant(db, config);

  if (!plan.changed) {
    console.log(`${config.slug} is already up to date — nothing to do.`);
    process.exit(0);
  }

  report(plan);

  if (plan.bookings > 0) {
    console.log(
      [
        "",
        `  ${plan.bookings} booking(s) exist. Applying is safe — snapshots keep their prices —`,
        "  but renames create a new service row. Add --force when you mean it.",
      ].join("\n"),
    );
  }

  console.log("\nnothing written. re-run with --write to apply.");
  process.exit(0);
}

const plan = await planTenant(db, config);

if (!plan.changed) {
  console.log(`${config.slug} is already up to date — nothing written.`);
  process.exit(0);
}

if (plan.bookings > 0 && !force) {
  report(plan);
  console.error(
    `\nrefusing to write: ${plan.bookings} booking(s) exist. Re-run with --write --force.`,
  );
  process.exit(2);
}

const { written } = await applyTenant(db, config);

report(plan);
console.log(`\n${written ? "applied" : "nothing written"}.`);

process.exit(0);
