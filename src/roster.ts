import type { Environment } from "./environment.js";
import type { Knobs } from "./knobs.js";
import { rateBatter, ratePitcher, type BatterRating, type PitcherRating } from "./ratings.js";
import type { RawBatter, RawTeam } from "./types.js";

export const FIELD_POS = ["c", "1b", "2b", "3b", "ss", "lf", "cf", "rf"] as const;
export type Pos = (typeof FIELD_POS)[number] | "p" | "dh";

export interface LineupSlot {
  batter: BatterRating;
  pos: Pos;
}

export interface SimTeam {
  raw: RawTeam;
  env: Environment;
  batters: BatterRating[];
  pitchers: PitcherRating[];
  rotation: PitcherRating[];
  /** relievers in order of preference; closer first when the team had one */
  bullpen: PitcherRating[];
  closer: PitcherRating | null;
  /** fielding team's error tendency vs its league (1 = average) */
  errorMult: number;
  /** fielders' effect on hits in play (below 1 = good defense) */
  defense: number;
  parkFactor: number;
}

const n = (v: number | null | undefined) => (v == null ? 0 : v);

/** Rough runs created per PA, for choosing and ordering hitters. */
export function hitterValue(b: BatterRating, env: Environment): number {
  const r = env.rates;
  const x = b.ratios;
  return (
    0.69 * x.BB * r.BB + 0.72 * x.HBP * r.HBP + 0.89 * x["1B"] * r["1B"] + 1.27 * x["2B"] * r["2B"] +
    1.62 * x["3B"] * r["3B"] + 2.1 * x.HR * r.HR - 0.03 * x.SO * r.SO
  );
}

export function onBase(b: BatterRating, env: Environment): number {
  const r = env.rates;
  const x = b.ratios;
  return x.BB * r.BB + x.HBP * r.HBP + x["1B"] * r["1B"] + x["2B"] * r["2B"] + x["3B"] * r["3B"] + x.HR * r.HR;
}

/** Runs allowed per batter faced, lower is better (for ordering relievers). */
export function pitcherValue(p: PitcherRating, env: Environment): number {
  const r = env.rates;
  const x = p.ratios;
  return (
    0.69 * x.BB * r.BB + 0.72 * x.HBP * r.HBP + 0.89 * x["1B"] * r["1B"] + 1.27 * x["2B"] * r["2B"] +
    1.62 * x["3B"] * r["3B"] + 2.1 * x.HR * r.HR - 0.1 * x.SO * r.SO
  );
}

/** Team-wide hits allowed per ball in play vs league, from the staff's raw totals, park-neutral. */
function teamBipRatio(raw: RawTeam, env: Environment, ppf: number): number {
  let h = 0, bip = 0;
  for (const p of raw.pitchers) {
    const bf = p.BFP ?? n(p.IPOuts) + n(p.H) + n(p.BB) + n(p.HBP);
    h += n(p.H) - n(p.HR);
    bip += bf - n(p.SO) - n(p.BB) - n(p.HBP) - n(p.HR);
  }
  const r = env.rates;
  const lgRate = (r["1B"] + r["2B"] + r["3B"]) / (r["1B"] + r["2B"] + r["3B"] + r.OUT + r.ROE);
  if (bip < 500 || lgRate <= 0) return 1;
  // regress toward average by ~1000 balls in play of luck, and strip half the home park effect
  const rate = (h + 1000 * lgRate) / (bip + 1000);
  return rate / lgRate / (0.5 + 0.5 * Math.pow(ppf, 0.5));
}

export function buildTeam(raw: RawTeam, env: Environment, knobs: Knobs, lgErrorsPerGame: number): SimTeam {
  const bpf = (n(raw.BPF) || 100) / 100;
  const ppf = (n(raw.PPF) || 100) / 100;
  const batters = raw.batters.map((b) => rateBatter(b, env.rates, bpf, knobs));
  const pitchers = raw.pitchers.filter((p) => n(p.BFP) > 0 || n(p.IPOuts) > 0).map((p) => ratePitcher(p, env.rates, ppf, knobs));

  // Separate fielding from pitching on balls in play: the staff-wide hits-in-play rate is
  // mostly the defense behind them; each pitcher keeps only part of his difference from it.
  const staffBip = teamBipRatio(raw, env, ppf);
  for (const p of pitchers) {
    const own = 1 + (p.bipRaw / staffBip - 1) * knobs.pitcherBipControl;
    p.ratios["1B"] = p.ratios["2B"] = p.ratios["3B"] = own;
  }
  const defense = 1 + (staffBip - 1) * knobs.defenseWeight;

  const starters = pitchers.filter((p) => p.GS > 0).sort((a, b) => b.GS - a.GS);
  const rotationSize = env.year < 1890 ? 2 : env.year < 1975 ? 4 : 5;
  const rotation = starters.slice(0, rotationSize);
  const rest = pitchers.filter((p) => !rotation.includes(p));
  // A real closer: led the team in saves with a meaningful total, and mostly relieved.
  for (const p of rest) p.reliefWeight = Math.max(1, p.bf - p.GS * p.bfPerStart);
  const bySaves = [...rest].sort((a, b) => b.SV - a.SV);
  const closer = bySaves[0] && bySaves[0].SV >= 10 && bySaves[0].GS < bySaves[0].G / 2 ? bySaves[0] : null;
  // Order the rest by quality, weighting pitchers who actually pitched a lot in relief.
  const bullpen = rest
    .filter((p) => p !== closer && p.bf >= 30)
    .sort((a, b) => pitcherValue(a, env) - pitcherValue(b, env));
  if (closer) bullpen.unshift(closer);
  const teamErrors = n(raw.E) / Math.max(1, n(raw.G));
  const errorMult = lgErrorsPerGame > 0 && teamErrors > 0 ? Math.sqrt(teamErrors / lgErrorsPerGame) : 1;

  return { raw, env, batters, pitchers, rotation, bullpen, closer, errorMult, defense, parkFactor: bpf };
}

/**
 * Pick the most-used player at each position, filling the scarcest spots first so a
 * shortstop isn't "used up" playing first base.
 */
export function buildLineup(team: SimTeam, useDH: boolean, starter: PitcherRating, knobs: Knobs): LineupSlot[] {
  const hitters = team.batters.filter((b) => !b.isPitcher && b.pa > 0);
  const used = new Set<string>();
  const slots: LineupSlot[] = [];
  const order: Pos[] = ["c", "ss", "2b", "cf", "3b", "rf", "lf", "1b"];
  for (const pos of order) {
    const cands = hitters
      .filter((b) => !used.has(b.id))
      .map((b) => ({ b, g: n(b.pos[pos]) + (pos === "lf" || pos === "rf" || pos === "cf" ? 0.3 * n(b.pos.of) : 0) }))
      .filter((x) => x.g > 0)
      .sort((a, b) => b.g - a.g || b.b.pa - a.b.pa);
    let pick = cands[0]?.b;
    if (!pick) pick = hitters.filter((b) => !used.has(b.id)).sort((a, b) => b.pa - a.pa)[0];
    if (!pick) throw new Error(`${team.raw.name}: not enough players to fill ${pos}`);
    used.add(pick.id);
    slots.push({ batter: pick, pos });
  }
  if (useDH) {
    const pool = hitters.filter((b) => !used.has(b.id));
    const dhGames = pool.filter((b) => n(b.pos.dh) >= 20).sort((a, b) => n(b.pos.dh) - n(a.pos.dh));
    const pick =
      dhGames[0] ??
      pool.filter((b) => b.pa >= 150).sort((a, b) => hitterValue(b, team.env) - hitterValue(a, team.env))[0] ??
      pool.sort((a, b) => b.pa - a.pa)[0];
    if (pick) {
      used.add(pick.id);
      slots.push({ batter: pick, pos: "dh" });
    }
  }
  const order9 = battingOrder(slots, team.env, knobs.lineup);
  if (!useDH) order9.push({ batter: pitcherAsBatter(team, starter), pos: "p" });
  return order9;
}

/** The pitcher's own batting line, or a generic weak-hitting pitcher if he never batted. */
export function pitcherAsBatter(team: SimTeam, p: PitcherRating): BatterRating {
  const found = team.batters.find((b) => b.id === p.id);
  if (found) return found;
  const ghost: RawBatter = {
    id: p.id, name: p.name, bats: p.throws, throws: p.throws,
    G: 0, AB: 0, R: 0, H: 0, "2B": 0, "3B": 0, HR: 0, RBI: 0, SB: 0, CS: 0, BB: 0, SO: 0, IBB: 0, HBP: 0,
    SH: 0, SF: 0, GIDP: 0, pos: { p: 1 }, GS: 0,
  };
  return rateBatter(ghost, team.env.rates, 1, { regression: 1 } as Knobs);
}

/**
 * Order hitters the way modern analysis suggests: best three hitters bat 1st, 2nd and 4th,
 * the next two bat 3rd and 5th, the rest go 6-9 in descending order. Highest on-base of the
 * top three leads off; the bigger slugger of the other two cleans up.
 */
export function battingOrder(slots: LineupSlot[], env: Environment, style: Knobs["lineup"] = "optimized"): LineupSlot[] {
  const s = [...slots].sort((a, b) => hitterValue(b.batter, env) - hitterValue(a.batter, env));
  if (style === "traditional") {
    // 3rd: best hitter. 4th: most power among the rest of the top five. 1st: best on-base among
    // the rest of the top six. 2nd: next best on-base. Then 5-9 by value.
    const pool = [...s];
    const take = (x: LineupSlot) => pool.splice(pool.indexOf(x), 1)[0];
    const third = take(pool[0]);
    const fourth = take(pool.slice(0, 4).sort((a, b) => b.batter.ratios.HR - a.batter.ratios.HR)[0]);
    const byObp = (xs: LineupSlot[]) => [...xs].sort((a, b) => onBase(b.batter, env) - onBase(a.batter, env));
    const leadoff = (xs: LineupSlot[]) => [...xs].sort((a, b) => onBase(b.batter, env) * b.batter.speed - onBase(a.batter, env) * a.batter.speed);
    const first = take(leadoff(pool.slice(0, 5))[0]);
    const second = take(byObp(pool.slice(0, 5))[0]);
    return [first, second, third, fourth, ...pool];
  }
  const top3 = s.slice(0, 3).sort((a, b) => onBase(b.batter, env) - onBase(a.batter, env));
  const lead = top3[0];
  const [x, y] = top3.slice(1).sort((a, b) => b.batter.ratios.HR - a.batter.ratios.HR);
  const out: LineupSlot[] = [lead, y, s[3], x, s[4], ...s.slice(5)].filter(Boolean);
  return out;
}
