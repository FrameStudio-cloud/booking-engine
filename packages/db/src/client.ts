import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const sql = postgres(url, {
    max: 10,
    // Neon pooled connections + prepared statements don't always mix.
    prepare: false,
  });
  const db = drizzle(sql, { schema });
  return Object.assign(db, { $client: sql });
}
