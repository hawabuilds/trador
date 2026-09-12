/**
 * Apply the SQL migrations.
 *
 * Supabase's own CLI is the better tool when a project is linked; this exists
 * so a fresh clone can get a working database with one command and no extra
 * install. It runs each file in order against the Postgres connection string.
 *
 * Migrations are additive and idempotent -- every statement is `if not exists`
 * or `on conflict do nothing` -- so re-running is safe and is the intended way
 * to pick up a new file.
 *
 *   DATABASE_URL=... npm run db:migrate
 */

import {readFileSync, readdirSync} from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "supabase", "migrations");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";
  if (!url) {
    throw new Error(
      "Set DATABASE_URL to your Postgres connection string. In Supabase it is " +
        "Project Settings → Database → Connection string → URI.",
    );
  }

  const {default: pg} = await import("pg");
  const client = new pg.Client({
    connectionString: url,
    // Supabase terminates unencrypted connections; the pooled host presents a
    // certificate this client will not have a local root for.
    ssl: {rejectUnauthorized: false},
  });

  await client.connect();

  try {
    const files = readdirSync(DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort();

    if (files.length === 0) throw new Error(`No .sql files in ${DIR}`);

    for (const file of files) {
      process.stdout.write(`  ${file} … `);
      const sql = readFileSync(path.join(DIR, file), "utf8");
      // One transaction per file, so a failure halfway leaves nothing behind.
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("commit");
        console.log("ok");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`${file}: ${(error as Error).message}`);
      }
    }

    const {rows} = await client.query(
      "select count(*)::int as n from public.stonks",
    );
    console.log(`\nDone. stonks holds ${rows[0].n} row(s).`);
    console.log("Next: npm run index:once to fill it.");
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(`\nmigrate failed: ${(error as Error).message}\n`);
  process.exit(1);
});
