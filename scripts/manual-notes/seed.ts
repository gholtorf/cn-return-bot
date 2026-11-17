import { SQL } from "bun";
import { resolve } from "node:path";

const status = await Bun.file(resolve(import.meta.dir, "../../.local-test/status.json")).json();
if (status.env.DB_URL !== "postgresql://postgres:postgres@127.0.0.1:54322/postgres") throw new Error("Only the isolated local database may be seeded.");
const sql = new SQL(status.env.DB_URL);
try {
  for (const state of ["queued", "processing"]) {
    await sql`insert into everything_items (project_id, source, url, title, status)
      select id, 'web', ${`http://127.0.0.1:8010/${state}`}, ${`Manual note test: bot ${state}`}, ${state}
      from everything_projects where slug = 'web' on conflict (url) do nothing`;
  }
  console.log("Local queued and processing test pages are ready; no bot is running.");
} finally { await sql.close(); }
