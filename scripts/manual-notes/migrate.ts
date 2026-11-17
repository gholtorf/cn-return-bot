import { SQL } from "bun";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const status = await Bun.file(resolve(root, ".local-test/status.json")).json();
const databaseUrl = new URL(status.env.DB_URL);
if (databaseUrl.hostname !== "127.0.0.1" || databaseUrl.port !== "54322") throw new Error("This script only migrates the isolated local test database on 127.0.0.1:54322.");
const sql = new SQL(databaseUrl.toString());
try {
  await sql.unsafe("create schema if not exists cn_local_test; create table if not exists cn_local_test.applied_migrations (filename text primary key, checksum text not null, applied_at timestamptz not null default now());");
  const applied = new Map((await sql`select filename, checksum from cn_local_test.applied_migrations`).map((row: { filename: string; checksum: string }) => [row.filename, row.checksum]));
  const files = (await readdir(resolve(root, "migrations"))).filter((name) => name.endsWith(".sql") && !/\.(fixture|verify)\.sql$/.test(name)).sort();
  for (const filename of files) {
    const source = await readFile(resolve(root, "migrations", filename), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    if (applied.has(filename)) {
      if (applied.get(filename) !== checksum) throw new Error(`Already-applied migration changed: ${filename}`);
      continue;
    }
    console.log(`Applying ${filename}`);
    // This column exists in the hosted schema but its original addition was
    // never checked in. Migration 073 is the first checked-in reference.
    if (filename === "073_review_dashboard_paginated_rpcs.sql") {
      await sql.unsafe("alter table review_dashboard_annotations add column if not exists high_value boolean not null default false");
    }
    // Each local migration is atomic. Indexes need no concurrent build on this
    // private test database; embedded transaction wrappers defer to this one.
    const localSource = source.replace(/^\s*(?:BEGIN|COMMIT);\s*$/gim, "").replace(/\bcreate\s+index\s+concurrently\b/gi, "create index");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(localSource);
      // Never dispatch production workflows from a local test stack.
      await transaction.unsafe("do $$ begin if to_regclass('cron.job') is not null then perform cron.alter_job(jobid, active := false) from cron.job; end if; end $$;");
      await transaction`insert into cn_local_test.applied_migrations (filename, checksum) values (${filename}, ${checksum})`;
    });
  }
  console.log(`Local schema ready (${files.length} migrations). Automated jobs disabled.`);
} finally {
  await sql.close();
}
