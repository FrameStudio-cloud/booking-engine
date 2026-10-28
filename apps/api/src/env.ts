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

const telegramMode = process.env.TELEGRAM_MODE === "webhook" ? "webhook" : "polling";
const telegramToken = process.env.TELEGRAM_BOT_TOKEN || undefined;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || undefined;

// Fail loudly. A webhook with a guessed secret can write bookings and messages;
// a default value here would be the whole vulnerability.
if (telegramMode === "webhook" && telegramToken && !webhookSecret) {
  throw new Error(
    "TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_MODE=webhook — generate one and set it",
  );
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  databaseUrl: required("DATABASE_URL"),
  dashboardOrigin: process.env.DASHBOARD_ORIGIN ?? "http://localhost:5173",
  /** Machine credential for every /api/tenants/* route except the widget. */
  engineApiKey: required("ENGINE_API_KEY"),
  // Optional: the rest of the API works without it, /chat does not.
  groqApiKey: process.env.GROQ_API_KEY || undefined,
  llmModel: process.env.LLM_MODEL || "openai/gpt-oss-120b",
  telegram: {
    token: telegramToken,
    /** "polling" for local dev, "webhook" in production. */
    mode: telegramMode,
    tenantSlug: process.env.TELEGRAM_TENANT_SLUG || "glow-salon",
    webhookSecret: webhookSecret ?? "",
  },
  /**
   * Seals channel credentials at rest and derives per-tenant webhook secrets.
   * Optional here: the API boots without it, and refuses to start only when a
   * tenant actually has a stored channel credential.
   */
  channelSecretKey: process.env.CHANNEL_SECRET_KEY || undefined,
};
