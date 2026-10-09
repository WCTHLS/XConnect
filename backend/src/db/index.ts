import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * `undefined` when DATABASE_URL isn't set — this is the mode switch the rest of the app checks.
 * No DATABASE_URL means pure in-memory mode, not a startup crash: this is still a POC.
 */
const DB_POOL_MAX = Number(process.env.DB_POOL_MAX) || 20;

export const db: Db | undefined = process.env.DATABASE_URL
  ? drizzle(postgres(process.env.DATABASE_URL, { max: DB_POOL_MAX }), { schema })
  : undefined;

export { schema };
