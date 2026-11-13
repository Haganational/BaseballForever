// Print a game as a radio broadcast: npm run radio -- "1927 Yankees" "2016 Cubs" [--pbp red-holloway] [--color doc-pemberton] [--seed N]
import { BUILT_IN_ANNOUNCERS } from "./commentary/announcers.js";
import { generateBroadcast } from "./commentary/broadcast.js";
import { FileDataSource, findTeam } from "./data.js";
import { simulateGame } from "./game.js";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const teams = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const ds = new FileDataSource();
const seed = Number(opt("seed", "1"));
const g = simulateGame(ds, findTeam(ds, teams[0] ?? "1927 Yankees"), findTeam(ds, teams[1] ?? "2016 Cubs"), { knobs: { seed } });
const byId = (id: string) => BUILT_IN_ANNOUNCERS.find((a) => a.id === id) ?? null;
const pbp = byId(opt("pbp", "red-holloway"))!;
const color = opt("color", "doc-pemberton") === "none" ? null : byId(opt("color", "doc-pemberton"));
for (const l of generateBroadcast(g, { pbp, color }, seed)) console.log(`${l.speaker.name.toUpperCase()}: ${l.text}`);
