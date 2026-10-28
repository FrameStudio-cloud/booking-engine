import { createDb, type Database } from "@booking/db";
import { config } from "./env";

export let db: Database = createDb(config.databaseUrl);

/**
 * Test harness only.
 *
 * Integration tests cannot rewrite module imports, so they swap the connection
 * for one scoped to a throwaway schema before importing the app. Production
 * never calls this; `index.ts` builds `db` from the environment once.
 */
export function useDatabase(next: Database): void {
  db = next;
}
