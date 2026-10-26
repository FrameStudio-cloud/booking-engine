import { existsSync } from "node:fs";
import { resolve } from "node:path";

// `pnpm --filter` runs with cwd = apps/api, so the repo-root .env is two up.
for (const candidate of [
  resolve(process.cwd(), "../../.env"),
  resolve(process.cwd(), ".env"),
]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing — copy .env.example to .env and fill it in`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  databaseUrl: required("DATABASE_URL"),
  dashboardOrigin: process.env.DASHBOARD_ORIGIN ?? "http://localhost:5173",
  // Optional: the rest of the API works without it, /chat does not.
  groqApiKey: process.env.GROQ_API_KEY || undefined,
  llmModel: process.env.LLM_MODEL || "openai/gpt-oss-120b",
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || undefined,
    /** "polling" for local dev, "webhook" in production. */
    mode: (process.env.TELEGRAM_MODE === "webhook" ? "webhook" : "polling") as
      | "polling"
      | "webhook",
    tenantSlug: process.env.TELEGRAM_TENANT_SLUG || "glow-salon",
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "dev-secret",
  },
};
