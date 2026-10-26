import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs with cwd = packages/db, so walk up to the repo-root .env.
for (const candidate of [
  resolve(process.cwd(), "../../.env"),
  resolve(process.cwd(), ".env"),
]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations want the direct (non-pooled) Neon connection.
    url: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
