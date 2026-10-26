import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const client = postgres(url, {
    max: 10,
    // Neon's pooled connections don't always play nice with prepared statements.
    prepare: false,
  });

  return drizzle(client, { schema });
}
