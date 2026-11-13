// Precompute every league-year environment (rates + talent spread) into data/environments.json.
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, FileDataSource } from "../src/data.js";
import { buildEnvironment, type Environment } from "../src/environment.js";
import { talentSpread } from "../src/ratings.js";

const ds = new FileDataSource();
const out: Record<string, Environment> = {};
const years = readdirSync(join(DATA_DIR, "seasons"))
  .map((f) => Number(f.replace(".json", "")))
  .sort((a, b) => a - b);

for (const y of years) {
  const s = ds.season(y);
  for (const lg of Object.keys(s.leagues)) {
    if (!s.leagues[lg].PA) continue;
    out[`${y}${lg}`] = buildEnvironment(s, lg, talentSpread(s, lg));
  }
}
// Fill missing spreads (tiny leagues) with the nearest MLB-ish value.
const fallback = out["1950AL"].spread;
for (const e of Object.values(out)) for (const k of Object.keys(e.spread) as (keyof typeof e.spread)[]) if (!isFinite(e.spread[k])) e.spread[k] = fallback[k];

writeFileSync(join(DATA_DIR, "environments.json"), JSON.stringify(out));
console.log(`wrote ${Object.keys(out).length} environments`);
