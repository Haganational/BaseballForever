// Accuracy check: replay real seasons and compare simulated scoring with what actually happened.
// npm run validate -- [games-per-team] [season-league ...]   e.g. npm run validate -- 200 1927AL 2019NL
import { FileDataSource } from "./data.js";
import { simulateGame } from "./game.js";
import type { Knobs } from "./knobs.js";

const ds = new FileDataSource();
const argv = process.argv.slice(2);
const perTeam = Number(argv[0] ?? 150);
const targets = argv.length > 1 ? argv.slice(1) : ["1908NL", "1927AL", "1930NL", "1948AL", "1968AL", "1987AL", "2000AL", "2016NL", "2019AL", "2024NL"];

interface Row { slopeRS: number; slopeRA: number; slopeW: number; lg: string; actualRPG: number; simRPG: number; rmseRS: number; rmseRA: number; corrRS: number; corrRA: number; corrW: number; hrSim: number; hrReal: number; soSim: number; soReal: number; }

const corr = (a: number[], b: number[]) => {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return s / Math.sqrt(sa * sb);
};
const slope = (y: number[], x: number[]) => { const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let s = 0, v = 0; for (let i = 0; i < n; i++) { s += (x[i] - mx) * (y[i] - my); v += (x[i] - mx) ** 2; } return s / v; };
const rmse = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0) / a.length);

export function validateLeague(key: string, games: number, knobs: Partial<Knobs> = {}): Row {
  const year = Number(key.slice(0, 4));
  const lg = key.slice(4);
  const season = ds.season(year);
  const teams = season.teams.filter((t) => t.lg === lg);
  const stats = new Map(teams.map((t) => [t.id, { rs: 0, ra: 0, g: 0, w: 0 }]));
  let seed = year * 1000;
  let hr = 0, so = 0, pa = 0;
  for (const home of teams) {
    for (let i = 0; i < games / 2; i++) {
      const away = teams[(teams.indexOf(home) + 1 + (i % (teams.length - 1))) % teams.length];
      const g = simulateGame(ds, away, home, { knobs: { environment: "home", ...knobs, seed: seed++ }, awayStarter: "random", homeStarter: "random" });
      const a = stats.get(away.id)!, h = stats.get(home.id)!;
      a.rs += g.away.R; a.ra += g.home.R; a.g++; h.rs += g.home.R; h.ra += g.away.R; h.g++;
      if (g.winner === "home") h.w++; else a.w++;
      for (const e of g.events) if (e.kind === "pa") { pa++; if (e.result === "HR") hr++; if (e.result === "SO") so++; }
    }
  }
  const actRS = teams.map((t) => (t.R ?? 0) / (t.G ?? 1));
  const actRA = teams.map((t) => (t.RA ?? 0) / (t.G ?? 1));
  const actW = teams.map((t) => (t.W ?? 0) / ((t.W ?? 0) + (t.L ?? 0)));
  const simRS = teams.map((t) => stats.get(t.id)!.rs / stats.get(t.id)!.g);
  const simRA = teams.map((t) => stats.get(t.id)!.ra / stats.get(t.id)!.g);
  const simW = teams.map((t) => stats.get(t.id)!.w / stats.get(t.id)!.g);
  const L = season.leagues[lg];
  return {
    lg: key,
    actualRPG: L.R / (L.G * 2),
    simRPG: simRS.reduce((a, x) => a + x, 0) / simRS.length,
    slopeRS: slope(simRS, actRS), slopeRA: slope(simRA, actRA), slopeW: slope(simW, actW),
    rmseRS: rmse(simRS, actRS), rmseRA: rmse(simRA, actRA),
    corrRS: corr(simRS, actRS), corrRA: corr(simRA, actRA), corrW: corr(simW, actW),
    hrSim: hr / pa, hrReal: L.HR / L.PA, soSim: so / pa, soReal: (L.SO ?? 0) / L.PA,
  };
}

const isMain = process.argv[1]?.endsWith("validate.ts");
if (isMain) {
  console.log(`Simulating ${perTeam} games per team in each league-season (each team at home half the time)\n`);
  console.log("League    Real R/G  Sim R/G   Diff   RS err  RA err  RS corr  RA corr  W% corr  W% slope   HR% real/sim   SO% real/sim");
  const t0 = Date.now();
  const all: Row[] = [];
  for (const key of targets) {
    const r = validateLeague(key, perTeam);
    all.push(r);
    const f = (x: number, d = 2) => x.toFixed(d).padStart(7);
    console.log(
      `${r.lg.padEnd(8)}${f(r.actualRPG)}${f(r.simRPG, 2).padStart(9)}${f(r.simRPG - r.actualRPG).padStart(8)}${f(r.rmseRS).padStart(8)}${f(r.rmseRA).padStart(8)}${f(r.corrRS).padStart(9)}${f(r.corrRA).padStart(9)}${f(r.corrW).padStart(9)}${f(r.slopeW).padStart(10)}` +
        `   ${(r.hrReal * 100).toFixed(2)} / ${(r.hrSim * 100).toFixed(2)}    ${(r.soReal * 100).toFixed(1)} / ${(r.soSim * 100).toFixed(1)}`,
    );
  }
  const avg = (f: (r: Row) => number) => all.reduce((a, r) => a + f(r), 0) / all.length;
  console.log(`\nAverage miss on league scoring: ${avg((r) => Math.abs(r.simRPG - r.actualRPG)).toFixed(2)} runs per team-game (${(100 * avg((r) => Math.abs(r.simRPG - r.actualRPG) / r.actualRPG)).toFixed(1)}%)`);
  console.log(`Average correlation with real team records: runs scored ${avg((r) => r.corrRS).toFixed(2)}, runs allowed ${avg((r) => r.corrRA).toFixed(2)}, win % ${avg((r) => r.corrW).toFixed(2)}`);
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
