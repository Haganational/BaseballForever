// Copy the data the page needs into public/data: league environments, the team list, and one
// small file per team (split out of ../data/seasons). Plain Node, no other installs needed,
// so it also runs on hosts like Vercel or Netlify with web/ as the project root.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const src = new URL("../../data/", import.meta.url);
const dst = new URL("../public/data/", import.meta.url);
mkdirSync(new URL("teams/", dst), { recursive: true });
const envs = JSON.parse(readFileSync(new URL("environments.json", src), "utf8"));
const index = [];
for (const f of readdirSync(new URL("seasons/", src)).sort()) {
  const season = JSON.parse(readFileSync(new URL(`seasons/${f}`, src), "utf8"));
  for (const t of season.teams) {
    if (!envs[`${t.year}${t.lg}`]) continue; // the engine needs the team's league environment
    writeFileSync(new URL(`teams/${t.id}.json`, dst), JSON.stringify(t));
    index.push({ id: t.id, year: t.year, lg: t.lg, name: t.name, W: t.W, L: t.L, WS: t.WSWin });
  }
}
writeFileSync(new URL("environments.json", dst), JSON.stringify(envs));
writeFileSync(new URL("teams-index.json", dst), JSON.stringify(index));
console.log(`prepared ${index.length} teams`);
