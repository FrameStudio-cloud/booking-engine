import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

export interface DbOptions {
  /** Run every query against this schema. Used by the integration harness. */
  searchPath?: string;
  max?: number;
}

export function createDb(url: string, options: DbOptions = {}) {
  const client = postgres(url, {
    max: options.max ?? 10,
    // Neon's pooled connections don't always play nice with prepared statements.
    prepare: false,
    // Keep the pool warm: Neon closes idle sockets and a reconnect mid-test
    // looks like a failed write. The server still drops what it wants.
    idle_timeout: 0,
    ...(options.searchPath
      ? { connection: { options: `-c search_path=${options.searchPath}` } }
      : {}),
  });

  return drizzle(client, { schema });
}
