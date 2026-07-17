import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationsDir = new URL("../drizzle", import.meta.url);
const pool = new pg.Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
  await client.query("begin");
  await client.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamp with time zone default now() not null
    )
  `);

  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const existing = await client.query("select 1 from schema_migrations where id = $1", [file]);
    if (existing.rowCount) {
      console.log(JSON.stringify({ migration: file, status: "skipped" }));
      continue;
    }
    const sql = await readFile(join(migrationsDir.pathname, file), "utf8");
    await client.query(sql);
    await client.query("insert into schema_migrations (id) values ($1)", [file]);
    console.log(JSON.stringify({ migration: file, status: "applied" }));
  }
  await client.query("commit");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
