// Command line: npm run sim -- "1927 Yankees" "2016 Cubs" [--knob value ...] [--games N]
import { renderBoxScore } from "./boxscore.js";
import { FileDataSource, findTeam } from "./data.js";
import { simulateGame } from "./game.js";
import { DEFAULT_KNOBS, type Knobs } from "./knobs.js";

const args = process.argv.slice(2);
const teams: string[] = [];
const knobs: Record<string, unknown> = {};
let games = 1;
let awayStarter: string | undefined;
let homeStarter: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const val = args[++i];
    if (key === "games") games = Number(val);
    else if (key === "awayStarter") awayStarter = val;
    else if (key === "homeStarter") homeStarter = val;
    else if (key === "preset") knobs.preset = val;
    else if (key in DEFAULT_KNOBS || key === "envYear" || key === "envLeague") {
      const def = (DEFAULT_KNOBS as unknown as Record<string, unknown>)[key];
      knobs[key] = typeof def === "number" || key === "envYear" || (key === "park" && !isNaN(Number(val))) ? Number(val) : val;
    } else {
      console.error(`Unknown option --${key}. Knobs: ${Object.keys(DEFAULT_KNOBS).join(", ")}`);
      process.exit(1);
    }
  } else teams.push(a);
}
if (teams.length !== 2) {
  console.error('Usage: npm run sim -- "<year> <team>" "<year> <team>" [--games N] [--<knob> value]');
  console.error('Example: npm run sim -- "1927 Yankees" "2016 Cubs" --environment home');
  process.exit(1);
}

const ds = new FileDataSource();
const away = findTeam(ds, teams[0]);
const home = findTeam(ds, teams[1]);

if (games === 1) {
  const g = simulateGame(ds, away, home, { knobs: knobs as Partial<Knobs>, awayStarter, homeStarter });
  console.log(renderBoxScore(g));
} else {
  let aw = 0, ar = 0, hr = 0;
  const seed0 = (knobs.seed as number) ?? 1;
  for (let i = 0; i < games; i++) {
    const g = simulateGame(ds, away, home, { knobs: { ...(knobs as Partial<Knobs>), seed: seed0 * 100003 + i }, awayStarter: awayStarter ?? "random", homeStarter: homeStarter ?? "random" });
    if (g.winner === "away") aw++;
    ar += g.away.R;
    hr += g.home.R;
  }
  console.log(`${games} games: ${away.year} ${away.name} won ${aw} (${((100 * aw) / games).toFixed(1)}%), ${home.year} ${home.name} won ${games - aw}`);
  console.log(`Average score: ${away.name} ${(ar / games).toFixed(2)}, ${home.name} ${(hr / games).toFixed(2)}`);
}
