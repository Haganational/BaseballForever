// Split season files into one small JSON file per team (what the web page and Supabase load).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../src/data.js";
import type { RawSeason } from "../src/types.js";

const out = join(DATA_DIR, "teams");
mkdirSync(out, { recursive: true });
let n = 0;
for (const f of readdirSync(join(DATA_DIR, "seasons"))) {
  const s = JSON.parse(readFileSync(join(DATA_DIR, "seasons", f), "utf8")) as RawSeason;
  for (const t of s.teams) {
    writeFileSync(join(out, `${t.id}.json`), JSON.stringify(t));
    n++;
  }
}
console.log(`wrote ${n} team files`);
