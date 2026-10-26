// Creates (or resets) one business from a config file.
//
//   pnpm tenant:new presets/glow-salon.json
//
// This is the whole onboarding step: edit JSON, run one command, paste the
// widget snippet into the customer's site. No code, no migrations.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { tenantConfigSchema } from "@booking/shared";

import { createDb } from "../client";
import { provisionTenant } from "../provision";
import { databaseUrl } from "./env";

const file = process.argv[2];

if (!file) {
  console.error("usage: pnpm tenant:new <preset.json>");
  process.exit(1);
}

// Accept a path from the repo root ("presets/x.json") as well as one relative
// to this package, because `pnpm --filter` runs with cwd = packages/db.
const candidates = [
  resolve(process.cwd(), file),
  resolve(process.cwd(), "../..", file),
];
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

const result = await provisionTenant(db, config);

console.log(
  [
    `provisioned ${result.name} (${result.slug})`,
    `  resources: ${result.resources.join(", ")}`,
    `  services:  ${result.services.join(" | ")}`,
    `  hours:     ${config.hours.map((h) => `${h.weekday} ${h.opensAt}-${h.closesAt}`).join(", ")}`,
    result.demoBooking ? `  demo row:  ${result.demoBooking}` : null,
    "",
    "Widget snippet for the customer's site:",
    "",
    `  <script src="https://YOUR-WIDGET-HOST/widget.js"`,
    `          data-tenant="${result.slug}"`,
    `          data-api="https://YOUR-API-HOST"></script>`,
  ]
    .filter(Boolean)
    .join("\n"),
);

process.exit(0);
