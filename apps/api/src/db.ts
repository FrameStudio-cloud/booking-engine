import { createDb, type Database } from "@booking/db";
import { config } from "./env";

export const db: Database = createDb(config.databaseUrl);
