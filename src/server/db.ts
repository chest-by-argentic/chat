import postgres from "postgres";
import { databaseUrl } from "@argentic/chest-sdk/database";

// The tool's database, opened at the first query: a tool that sleeps and
// wakes for one page opens one connection, not a pool's worth. A few
// connections serve a team; queries are short.
let pool: postgres.Sql | undefined;

// Identifiers and counts are bigint in the database and numbers here: they
// stay far below 2^53.
const bigint = { to: 20, from: [20], parse: (value: string) => Number(value), serialize: (value: number) => String(value) };

export const db = (): postgres.Sql => (pool ??= postgres(databaseUrl(), { max: 4, idle_timeout: 60, connect_timeout: 10, onnotice: () => {}, types: { bigint } }));

export type Sql = postgres.Sql | postgres.TransactionSql;

// closeDb ends the pool (tests, a stopping server).
export async function closeDb(): Promise<void> {
  const p = pool;
  pool = undefined;
  await p?.end({ timeout: 5 });
}
