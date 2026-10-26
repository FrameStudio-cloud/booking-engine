// Shared env bootstrap for the CLI scripts in this folder.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function databaseUrl(): string {
  for (const candidate of [
    resolve(process.cwd(), "../../.env"),
    resolve(process.cwd(), ".env"),
  ]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      break;
    }
  }

  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}
