// Load the Lahman-derived data into Supabase (tables from supabase/schema.sql).
// SUPABASE_URL=https://xyz.supabase.co SUPABASE_SERVICE_ROLE_KEY=... npm run upload:supabase
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../src/data.js";
import type { Environment } from "../src/environment.js";
import type { RawTeam } from "../src/types.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Project settings → API in Supabase).");
  process.exit(1);
}

async function upsert(table: string, rows: unknown[]) {
  const r = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: key!, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
}

const envs: Record<string, Environment> = JSON.parse(readFileSync(join(DATA_DIR, "environments.json"), "utf8"));
await upsert("environments", Object.entries(envs).map(([k, e]) => ({ key: k, year: e.year, lg: e.lg, data: e })));
console.log(`environments: ${Object.keys(envs).length}`);

let batch: unknown[] = [];
let n = 0;
for (const f of readdirSync(join(DATA_DIR, "seasons")).sort()) {
  const season = JSON.parse(readFileSync(join(DATA_DIR, "seasons", f), "utf8")) as { teams: RawTeam[] };
  for (const t of season.teams) {
    if (!t.lg || !envs[`${t.year}${t.lg}`]) continue; // leagues the engine can't play yet
    batch.push({ id: t.id, year: t.year, lg: t.lg, name: t.name, franch: t.franch, w: t.W, l: t.L, ws: t.WSWin, roster: t });
    if (batch.length >= 100) { await upsert("team_seasons", batch); n += batch.length; batch = []; process.stdout.write(`\rteams: ${n}`); }
  }
}
if (batch.length) { await upsert("team_seasons", batch); n += batch.length; }
console.log(`\rteams: ${n}  done`);
