// Rebuilds the demo business from its preset.
//
//   pnpm db:seed
//
// Equivalent to `pnpm tenant:new presets/glow-salon.json`; kept as a separate
// name so "seed the demo" stays a thing you can do without thinking.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tenantConfigSchema } from "@booking/shared";

import { createDb } from "./client";
import { provisionTenant } from "./provision";
import { databaseUrl } from "./cli/env";

const path = resolve(process.cwd(), "../../presets/glow-salon.json");
const parsed = tenantConfigSchema.safeParse(JSON.parse(await readFile(path, "utf8")));

if (!parsed.success) {
  console.error(`presets/glow-salon.json is invalid:`);
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  process.exit(1);
}

const db = createDb(databaseUrl());
const result = await provisionTenant(db, parsed.data);

console.log(
  [
    `seeded ${result.name} (${result.slug})`,
    `  resources: ${result.resources.join(", ")}`,
    `  services:  ${result.services.join(" | ")}`,
    result.demoBooking ? `  existing:  ${result.demoBooking}` : null,
  ]
    .filter(Boolean)
    .join("\n"),
);

process.exit(0);
