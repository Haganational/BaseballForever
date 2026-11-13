import { allTimeEnvironment, type DataSource } from "./source.js";
import { blendEnvironments, type Environment } from "./environment.js";
import { withDefaults, type Knobs } from "./knobs.js";
import { equipmentMultipliers, matchup, type MatchupContext } from "./matchup.js";
import { parkMultipliers, type BatterRating, type PitcherRating } from "./ratings.js";
import { Rng } from "./rng.js";
import { buildLineup, buildTeam, pitcherAsBatter, type LineupSlot, type Pos, type SimTeam } from "./roster.js";
import { RATED, type Ev, type RawTeam, type Ratios } from "./types.js";

// ---------------------------------------------------------------------------------------------
// Public result types. The event log is deliberately detailed: the radio commentary (step 3)
// and the key-play animations (step 4) are both built from it.
// ---------------------------------------------------------------------------------------------

export type Half = "top" | "bottom";
export type BattedBall = "GB" | "FB" | "LD";

export interface PlayEvent {
  kind: "pa";
  inning: number;
  half: Half;
  outsBefore: number;
  basesBefore: (string | null)[];
  batter: string;
  pitcher: string;
  result: Ev;
  battedBall?: BattedBall;
  /** fielder who made the play (scorer's numbers 1-9) or the outfield direction of a hit */
  fielder?: number;
  doublePlay?: boolean;
  fieldersChoice?: boolean;
  sacFly?: boolean;
  /** a fielding error on the play let every runner take an extra base */
  error?: boolean;
  /** runners (and batter) who scored on the play, plus any runner thrown out */
  scored: string[];
  outOnBases: string[];
  rbi: number;
  outsAfter: number;
  basesAfter: (string | null)[];
  score: { away: number; home: number };
  /** win probability for the home team after the play, for "key play" detection */
  homeWinProb: number;
}

export interface OtherEvent {
  kind: "steal" | "caught" | "wildpitch" | "pitching_change" | "ghost_runner" | "inning_start" | "game_end";
  inning: number;
  half: Half;
  text: string;
  player?: string;
  score: { away: number; home: number };
}

export type GameEvent = PlayEvent | OtherEvent;

export interface BatLine {
  id: string; name: string; pos: string;
  AB: number; R: number; H: number; "2B": number; "3B": number; HR: number; RBI: number; BB: number; SO: number; HBP: number; SB: number;
}
export interface PitchLine {
  id: string; name: string;
  outs: number; BF: number; H: number; R: number; ER: number; BB: number; SO: number; HR: number; HBP: number;
  decision?: "W" | "L" | "S";
}

export interface TeamBox {
  team: RawTeam;
  batting: BatLine[];
  pitching: PitchLine[];
  lineScore: number[];
  R: number; H: number; E: number; LOB: number;
}

export interface GameResult {
  away: TeamBox;
  home: TeamBox;
  innings: number;
  events: GameEvent[];
  environment: Environment;
  knobs: Knobs;
  winner: "away" | "home";
}

export interface GameOptions {
  knobs?: Partial<Knobs> & { preset?: string };
  /** pitcher id, or "ace" (most starts, default) or "random" (weighted by starts) */
  awayStarter?: string;
  homeStarter?: string;
}

// ---------------------------------------------------------------------------------------------

/** Pick the world the game is played in, per knobs.environment. */
export function targetEnvironment(ds: DataSource, away: SimTeam, home: SimTeam, k: Knobs): Environment {
  switch (k.environment) {
    case "home":
      return home.env;
    case "away":
      return away.env;
    case "alltime":
      return allTimeEnvironment(ds);
    case "year": {
      const y = k.envYear ?? 1960;
      if (k.envLeague) return ds.environment(y, k.envLeague);
      const both = ["AL", "NL"].flatMap((lg) => {
        try { return [ds.environment(y, lg)]; } catch { return []; }
      });
      if (!both.length) throw new Error(`No AL/NL environment for ${y}; set envLeague`);
      return blendEnvironments(both, `${y} MLB`);
    }
    case "blend":
    default:
      if (away.env.year === home.env.year && away.env.lg === home.env.lg) return home.env;
      return blendEnvironments([away.env, home.env], `Blend of ${away.env.label} and ${home.env.label}`);
  }
}

type Style = "modern" | "mid" | "classic";
function bullpenStyle(t: SimTeam, k: Knobs): Style {
  if (k.bullpen === "modern") return "modern";
  if (k.bullpen === "classic") return "classic";
  if (t.env.cgRate > 0.35) return "classic";
  if (t.env.year >= 1990) return "modern";
  return "mid";
}

interface Runner {
  b: BatterRating;
  /** pitcher charged if this runner scores */
  resp: PitchLine;
  earned: boolean;
}

interface Side {
  team: SimTeam;
  lineup: LineupSlot[];
  next: number;
  pitcher: PitcherRating;
  pitcherLine: PitchLine;
  pitcherLimit: number;
  /** times each batter has faced the current pitcher */
  faced: Map<string, number>;
  available: PitcherRating[];
  usedCloser: boolean;
  style: Style;
  bat: Map<string, BatLine>;
  pitch: PitchLine[];
  lineScore: number[];
  runs: number;
  hits: number;
  errors: number;
  lob: number;
}

const FIELDERS: Record<BattedBall, number[]> = {
  GB: [6, 6, 6, 4, 4, 4, 5, 5, 5, 3, 3, 1],
  FB: [7, 7, 8, 8, 8, 9, 9, 2, 3, 4, 5, 6],
  LD: [7, 8, 9, 6, 4, 5, 3, 1],
};
const POS_NUM: Record<string, number> = { p: 1, c: 2, "1b": 3, "2b": 4, "3b": 5, ss: 6, lf: 7, cf: 8, rf: 9, dh: 0 };

/** Very small win-expectancy model, good enough to flag the big moments of a game. */
export function homeWinProb(inning: number, half: Half, outs: number, bases: (unknown | null)[], diff: number, rpg: number): number {
  const onBase = (bases[0] ? 0.4 : 0) + (bases[1] ? 0.65 : 0) + (bases[2] ? 0.9 : 0);
  const outsLeftInHalf = (3 - outs) / 3;
  const halvesLeftAway = Math.max(0, 9 - inning) + (half === "top" ? outsLeftInHalf : 0);
  const halvesLeftHome = Math.max(0, 9 - inning) + (half === "bottom" ? outsLeftInHalf : 1);
  const perHalf = rpg / 9;
  let d = diff;
  if (half === "top") d -= onBase * outsLeftInHalf * 0.5;
  else d += onBase * outsLeftInHalf * 0.5;
  const varRuns = (halvesLeftAway + halvesLeftHome) * perHalf * 2.0 + 0.25;
  const z = (d + 0.15) / Math.sqrt(varRuns);
  if (inning >= 9 && half === "bottom" && diff > 0) return 1;
  return 1 / (1 + Math.exp(-1.7 * z));
}

export function simulateGame(ds: DataSource, awayRaw: RawTeam, homeRaw: RawTeam, opts: GameOptions = {}): GameResult {
  const knobs = withDefaults(opts.knobs);
  const rng = new Rng(knobs.seed);

  const mkTeam = (raw: RawTeam) => {
    const env = ds.environment(raw.year, raw.lg ?? "NL");
    const lgErrPerGame = ds.leagueErrorsPerGame(raw.year, raw.lg ?? "NL");
    return buildTeam(raw, env, knobs, lgErrPerGame);
  };
  const awayT = mkTeam(awayRaw);
  const homeT = mkTeam(homeRaw);
  const target = targetEnvironment(ds, awayT, homeT, knobs);
  const useDH = knobs.dh === "on" ? true : knobs.dh === "off" ? false : homeT.env.dh;
  const ghost = knobs.ghostRunner === "on" ? true : knobs.ghostRunner === "off" ? false : target.year >= 2020;

  const pf = knobs.park === "neutral" ? 1 : knobs.park === "home" ? homeT.parkFactor : knobs.park;
  const park = parkMultipliers(pf);
  const equip = equipmentMultipliers(target, knobs);
  const knobMult: Ratios = {
    SO: knobs.soFactor, BB: knobs.bbFactor, HBP: 1, HR: knobs.hrFactor,
    "3B": knobs.babipFactor, "2B": knobs.babipFactor, "1B": knobs.babipFactor,
  };

  const chooseStarter = (t: SimTeam, pick?: string): PitcherRating => {
    if (pick && pick !== "ace" && pick !== "random") {
      const p = t.pitchers.find((x) => x.id === pick || x.name.toLowerCase().includes(pick.toLowerCase()));
      if (!p) throw new Error(`${t.raw.name}: no pitcher "${pick}"`);
      return p;
    }
    const rot = t.rotation.length ? t.rotation : t.pitchers;
    if (pick === "random") {
      const total = rot.reduce((a, p) => a + Math.max(1, p.GS), 0);
      let r = rng.next() * total;
      for (const p of rot) if ((r -= Math.max(1, p.GS)) < 0) return p;
    }
    return rot[0];
  };

  const mkSide = (t: SimTeam, starterPick?: string): Side => {
    const starter = chooseStarter(t, starterPick);
    const line = newPitchLine(starter);
    const style = bullpenStyle(t, knobs);
    return {
      team: t,
      lineup: buildLineup(t, useDH, starter, knobs),
      next: 0,
      pitcher: starter,
      pitcherLine: line,
      pitcherLimit: starterLimit(starter, style, rng),
      faced: new Map(),
      available: t.bullpen.filter((p) => p.id !== starter.id),
      usedCloser: false,
      style,
      bat: new Map(),
      pitch: [line],
      lineScore: [],
      runs: 0, hits: 0, errors: 0, lob: 0,
    };
  };

  const away = mkSide(awayT, opts.awayStarter);
  const home = mkSide(homeT, opts.homeStarter);
  for (const s of [away, home]) for (const slot of s.lineup) s.bat.set(slot.batter.id, newBatLine(slot.batter, slot.pos));

  const events: GameEvent[] = [];
  const score = () => ({ away: away.runs, home: home.runs });
  const decisions = { lead: null as null | "away" | "home", winP: null as PitchLine | null, loseP: null as PitchLine | null, saveCand: null as PitchLine | null };

  let inning = 1;
  let half: Half = "top";
  for (;;) {
    const bat = half === "top" ? away : home;
    const fld = half === "top" ? home : away;
    if (half === "bottom" && inning >= 9 && home.runs > away.runs) break; // home already ahead: no bottom half
    events.push({ kind: "inning_start", inning, half, text: `${half === "top" ? "Top" : "Bottom"} of the ${ordinal(inning)}`, score: score() });

    managePitcherBetweenInnings(fld, bat, inning, half);

    let outs = 0;
    const bases: (Runner | null)[] = [null, null, null];
    let runsThisHalf = 0;
    if (ghost && inning >= 10) {
      const prev = bat.lineup[(bat.next + bat.lineup.length - 1) % bat.lineup.length].batter;
      bases[1] = { b: prev, resp: fld.pitcherLine, earned: false };
      events.push({ kind: "ghost_runner", inning, half, text: `${prev.name} starts the inning on second base`, player: prev.id, score: score() });
    }

    const scoreRunner = (r: Runner, list: string[]) => {
      list.push(r.b.id);
      bat.runs++;
      runsThisHalf++;
      const bl = bat.bat.get(r.b.id);
      if (bl) bl.R++;
      r.resp.R++;
      if (r.earned) r.resp.ER++;
    };

    while (outs < 3) {
      // walk-off check happens after each play below
      // --- before the pitch: steals and wild pitches ---
      if (bases[0] && !bases[1] && outs < 3) {
        const r = bases[0];
        const ownAtt = Math.max(0.02, bat.team.env.sbAttempt);
        const attempt = (r.b.sbAttempt * Math.sqrt(target.sbAttempt / ownAtt) * knobs.stealFactor) / 1.4;
        if (rng.chance(attempt)) {
          if (rng.chance(r.b.sbSuccess)) {
            bases[1] = r; bases[0] = null;
            const bl = bat.bat.get(r.b.id); if (bl) bl.SB++;
            events.push({ kind: "steal", inning, half, text: `${r.b.name} steals second`, player: r.b.id, score: score() });
          } else {
            bases[0] = null; outs++;
            fld.pitcherLine.outs++;
            events.push({ kind: "caught", inning, half, text: `${r.b.name} caught stealing second`, player: r.b.id, score: score() });
            if (outs >= 3) break;
          }
        }
      }
      if ((bases[0] || bases[1] || bases[2]) && rng.chance(target.wp)) {
        const scored: string[] = [];
        if (bases[2]) scoreRunner(bases[2], scored);
        bases[2] = bases[1]; bases[1] = bases[0]; bases[0] = null;
        events.push({ kind: "wildpitch", inning, half, text: `Wild pitch${scored.length ? ", a run scores" : ", runners move up"}`, score: score() });
        if (walkoff()) break;
      }

      managePitcherInInning(fld, bat, inning, half, outs, bases);

      const slot = bat.lineup[bat.next];
      bat.next = (bat.next + 1) % bat.lineup.length;
      const batter = slot.batter;
      const pitcher = fld.pitcher;
      const pl = fld.pitcherLine;
      const timesFaced = (fld.faced.get(batter.id) ?? 0) + 1;
      fld.faced.set(batter.id, timesFaced);

      const mods = paMods(half, timesFaced, pl.BF, fld.pitcherLimit, fld.pitcherLine === fld.pitch[0] ? fld.pitch[0] : null);
      mods["1B"] *= fld.team.defense; mods["2B"] *= fld.team.defense; mods["3B"] *= fld.team.defense;
      const ctx: MatchupContext = { target, knobs, mods, errorMult: fld.team.errorMult };
      const probs = matchup({ ratios: batter.ratios, env: bat.team.env, xbh: batter.xbh }, { ratios: pitcher.ratios, env: fld.team.env }, ctx);
      const result = rng.weighted(probs);

      const basesBefore = bases.map((r) => r?.b.id ?? null);
      const outsBefore = outs;
      const scored: string[] = [];
      const outOnBases: string[] = [];
      let battedBall: BattedBall | undefined;
      let fielder: number | undefined;
      let doublePlay = false, fieldersChoice = false, sacFly = false;
      const bl = bat.bat.get(batter.id)!;
      pl.BF++;
      const br: Runner = { b: batter, resp: pl, earned: true };
      const twoOut = outs === 2;

      switch (result) {
        case "SO":
          outs++; pl.outs++; pl.SO++; bl.AB++; bl.SO++;
          break;
        case "BB":
        case "HBP": {
          if (result === "BB") { bl.BB++; pl.BB++; } else { bl.HBP++; pl.HBP++; }
          if (bases[0]) {
            if (bases[1]) {
              if (bases[2]) scoreRunner(bases[2], scored);
              bases[2] = bases[1];
            }
            bases[1] = bases[0];
          }
          bases[0] = br;
          break;
        }
        case "HR":
          bl.AB++; bl.H++; bl.HR++; pl.H++; pl.HR++; bat.hits++;
          fielder = rng.pick([7, 8, 9]);
          for (let i = 2; i >= 0; i--) if (bases[i]) { scoreRunner(bases[i]!, scored); bases[i] = null; }
          scoreRunner(br, scored);
          break;
        case "3B":
          bl.AB++; bl.H++; bl["3B"]++; pl.H++; bat.hits++;
          fielder = rng.pick([7, 8, 8, 9, 9]);
          for (let i = 2; i >= 0; i--) if (bases[i]) { scoreRunner(bases[i]!, scored); bases[i] = null; }
          bases[2] = br;
          break;
        case "2B": {
          bl.AB++; bl.H++; bl["2B"]++; pl.H++; bat.hits++;
          fielder = rng.pick([7, 7, 8, 9, 9]);
          if (bases[2]) { scoreRunner(bases[2], scored); bases[2] = null; }
          if (bases[1]) { scoreRunner(bases[1], scored); bases[1] = null; }
          if (bases[0]) {
            const r = bases[0]; bases[0] = null;
            if (rng.chance((twoOut ? 0.6 : 0.4) * r.b.speed)) scoreRunner(r, scored);
            else bases[2] = r;
          }
          bases[1] = br;
          break;
        }
        case "1B":
        case "ROE": {
          bl.AB++;
          if (result === "1B") { bl.H++; pl.H++; bat.hits++; fielder = rng.pick([7, 8, 9]); }
          else { fld.errors++; br.earned = false; battedBall = "GB"; fielder = rng.pick([6, 6, 5, 4, 3]); }
          const extra = result === "ROE" ? 1.25 : 1;
          if (bases[2]) { scoreRunner(bases[2], scored); bases[2] = null; }
          if (bases[1]) {
            const r = bases[1]; bases[1] = null;
            if (rng.chance(Math.min(0.97, (twoOut ? 0.85 : 0.6) * r.b.speed * extra))) {
              if (rng.chance(0.04)) { outs++; pl.outs++; outOnBases.push(r.b.id); }
              else scoreRunner(r, scored);
            } else bases[2] = r;
          }
          if (bases[0]) {
            const r = bases[0]; bases[0] = null;
            if (!bases[2] && rng.chance(Math.min(0.9, (twoOut ? 0.35 : 0.27) * r.b.speed * extra))) bases[2] = r;
            else bases[1] = r;
          }
          if (outs < 3) bases[0] = br;
          break;
        }
        case "OUT": {
          bl.AB++;
          battedBall = rng.weighted({ GB: 0.46, FB: 0.38, LD: 0.16 } as Record<BattedBall, number>);
          fielder = rng.pick(FIELDERS[battedBall]);
          if (battedBall === "GB") {
            if (bases[0] && outs < 2 && rng.chance(0.5 / batter.speed)) {
              // double play: batter and the runner from first
              doublePlay = true;
              outOnBases.push(bases[0].b.id);
              bases[0] = null;
              outs += 2; pl.outs += 2;
              if (outs < 3) {
                if (bases[2]) { scoreRunner(bases[2], scored); bases[2] = null; }
                if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
              }
            } else if (bases[0] && outs < 2 && rng.chance(0.3)) {
              // fielder's choice: lead runner forced, batter safe at first
              fieldersChoice = true;
              outs++; pl.outs++;
              const forced = bases[0];
              outOnBases.push(forced.b.id);
              const r2 = bases[1], r3 = bases[2];
              bases[0] = br; bases[1] = null; bases[2] = null;
              if (r3 && (r2 || rng.chance(0.5))) scoreRunner(r3, scored); else if (r3) bases[2] = r3;
              if (r2) bases[2] ? (bases[1] = r2) : (bases[2] = r2);
            } else {
              outs++; pl.outs++;
              if (outs < 3) {
                if (bases[2] && (bases[1] && bases[0] ? true : rng.chance(0.5))) { scoreRunner(bases[2], scored); bases[2] = null; }
                if (bases[1] && !bases[2] && rng.chance(bases[0] ? 1 : 0.55)) { bases[2] = bases[1]; bases[1] = null; }
                if (bases[0] && !bases[1]) { bases[1] = bases[0]; bases[0] = null; }
              }
            }
          } else if (battedBall === "FB") {
            outs++; pl.outs++;
            if (outs < 3 && fielder >= 7) {
              if (bases[2] && rng.chance(0.6 * bases[2].b.speed)) {
                sacFly = true; bl.AB--; scoreRunner(bases[2], scored); bases[2] = null;
              }
              if (bases[1] && !bases[2] && rng.chance(0.25)) { bases[2] = bases[1]; bases[1] = null; }
            }
          } else {
            outs++; pl.outs++;
            if (outs < 3 && (bases[0] || bases[1]) && rng.chance(0.06)) {
              // line drive double play: runner doubled off
              const i = bases[1] ? 1 : 0;
              outOnBases.push(bases[i]!.b.id);
              bases[i] = null;
              outs++; pl.outs++; doublePlay = true;
            }
          }
          break;
        }
      }
      // Fielding/throwing errors that let everyone move up a base. Rare now, constant before 1920.
      let advanceError = false;
      if ((result === "1B" || result === "2B" || (result === "OUT" && outs < 3)) && (bases[0] || bases[1] || bases[2] || result !== "OUT")) {
        const q = 1.6 * target.rates.ROE * knobs.errorFactor * fld.team.errorMult;
        if (rng.chance(q)) {
          advanceError = true;
          fld.errors++;
          if (bases[2]) { bases[2].earned = false; scoreRunner(bases[2], scored); bases[2] = null; }
          if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
          if (bases[0]) { bases[1] = bases[0]; bases[0] = null; }
        }
      }
      // RBIs: runs on the play, except on errors and double plays
      const rbi = result === "ROE" || doublePlay ? 0 : scored.length - (advanceError && scored.length ? 1 : 0);
      bl.RBI += rbi;
      trackLead();

      const wp = homeWinProb(inning, half, Math.min(outs, 3), bases, home.runs - away.runs, target.runsPerGame);
      events.push({
        kind: "pa", inning, half, outsBefore, basesBefore, batter: batter.id, pitcher: pitcher.id, result,
        battedBall, fielder, doublePlay: doublePlay || undefined, fieldersChoice: fieldersChoice || undefined,
        sacFly: sacFly || undefined, error: advanceError || undefined, scored, outOnBases, rbi, outsAfter: Math.min(outs, 3),
        basesAfter: bases.map((r) => r?.b.id ?? null), score: score(), homeWinProb: wp,
      });
      if (walkoff()) break;
    }
    bat.lob += bases.filter(Boolean).length;
    bat.lineScore.push(runsThisHalf);

    if (half === "top") {
      half = "bottom";
      if (inning >= 9 && home.runs > away.runs) { home.lineScore.push(NaN); break; }
    } else {
      if (inning >= 9 && home.runs !== away.runs) break;
      if (inning >= 30) break;
      half = "top";
      inning++;
    }
  }

  // decisions
  const winner: "away" | "home" = home.runs > away.runs ? "home" : "away";
  if (decisions.winP) decisions.winP.decision = "W";
  if (decisions.loseP) decisions.loseP.decision = "L";
  const winSide = winner === "home" ? home : away;
  const lastP = winSide.pitch[winSide.pitch.length - 1];
  const margin = Math.abs(home.runs - away.runs);
  if (lastP !== decisions.winP && lastP.outs >= 1 && (margin <= 3 || lastP.outs >= 9) && !lastP.decision) lastP.decision = "S";
  events.push({ kind: "game_end", inning, half, text: `Final: ${awayRaw.name} ${away.runs}, ${homeRaw.name} ${home.runs}`, score: score() });

  const box = (s: Side): TeamBox => ({
    team: s.team.raw,
    batting: [...s.bat.values()],
    pitching: s.pitch,
    lineScore: s.lineScore,
    R: s.runs, H: s.hits, E: s.errors, LOB: s.lob,
  });
  return { away: box(away), home: box(home), innings: inning, events, environment: target, knobs, winner };

  // ----------------------------------------------------------------- helpers (closures)

  function walkoff(): boolean {
    return half === "bottom" && inning >= 9 && home.runs > away.runs;
  }

  function trackLead() {
    const lead = home.runs > away.runs ? "home" : away.runs > home.runs ? "away" : null;
    if (lead && lead !== decisions.lead) {
      // new lead: current pitchers are the pitcher of record
      const winS = lead === "home" ? home : away;
      const loseS = lead === "home" ? away : home;
      decisions.winP = winS.pitcherLine;
      decisions.loseP = loseS.pitcherLine;
    }
    decisions.lead = lead;
  }

  function paMods(h: Half, timesFaced: number, bf: number, limit: number, starterLine: PitchLine | null): Ratios {
    const m = {} as Ratios;
    const homeBat = h === "bottom";
    const hfa = 1 + 0.015 * knobs.homeField * (homeBat ? 1 : -1);
    let tto = 1;
    if (starterLine) {
      if (timesFaced === 3) tto = 1 + 0.03 * knobs.timesThroughOrder;
      if (timesFaced >= 4) tto = 1 + 0.05 * knobs.timesThroughOrder;
    }
    const tired = bf > limit ? 1 + 0.015 * (bf - limit) : 1;
    for (const e of RATED) {
      let x = park[e] * equip[e] * knobMult[e];
      if (e === "SO") x /= hfa * tto * tired;
      else if (e !== "HBP") x *= hfa * tto * tired;
      m[e] = x;
    }
    return m;
  }

  function bringIn(fld: Side, p: PitcherRating, inningNo: number, h: Half, bat: Side) {
    fld.available = fld.available.filter((x) => x !== p);
    if (p === fld.team.closer) fld.usedCloser = true;
    const line = newPitchLine(p);
    fld.pitch.push(line);
    fld.pitcher = p;
    fld.pitcherLine = line;
    fld.faced = new Map();
    fld.pitcherLimit = relieverLimit(p, fld.style, rng);
    // no DH: the new pitcher takes the pitcher's spot in the order
    const pslot = fld.lineup.findIndex((s) => s.pos === "p");
    if (pslot >= 0) {
      const b = pitcherAsBatter(fld.team, p);
      fld.lineup[pslot] = { batter: b, pos: "p" };
      if (!fld.bat.has(b.id)) fld.bat.set(b.id, newBatLine(b, "p"));
    }
    events.push({ kind: "pitching_change", inning: inningNo, half: h, text: `${p.name} comes in to pitch for the ${fld.team.raw.name}`, player: p.id, score: score() });
    void bat;
  }

  function pickReliever(fld: Side, lead: number, inningNo: number): PitcherRating | null {
    const pool = fld.available.filter((p) => p !== fld.team.closer || !fld.usedCloser);
    if (!pool.length) return null;
    const nonCloser = pool.filter((p) => p !== fld.team.closer);
    const close = Math.abs(lead) <= 3 && inningNo >= 7;
    if (!nonCloser.length) return pool[0];
    // Pick in proportion to how much each pitcher really worked in relief, so mop-up men
    // pitch about as often as they did. In close late games, lean hard on the best arms.
    const w = nonCloser.map((p, i) => p.reliefWeight * (close && i < 3 ? 4 : 1));
    let r = rng.next() * w.reduce((a, x) => a + x, 0);
    for (let i = 0; i < nonCloser.length; i++) if ((r -= w[i]) < 0) return nonCloser[i];
    return nonCloser[0];
  }

  function managePitcherBetweenInnings(fld: Side, bat: Side, inningNo: number, h: Half) {
    const lead = fld === home ? home.runs - away.runs : away.runs - home.runs;
    const isStarter = fld.pitcherLine === fld.pitch[0];
    // Save situation: bring the closer in for the 9th (or later) with a 1-3 run lead.
    const closer = fld.team.closer;
    if (closer && !fld.usedCloser && fld.style !== "classic" && fld.pitcher !== closer && inningNo >= 9 && lead >= 1 && lead <= 3 && fld.team.env.year >= 1960) {
      if (!(isStarter && fld.pitcherLine.BF < fld.pitcherLimit * 0.9 && fld.style === "mid")) {
        bringIn(fld, closer, inningNo, h, bat);
        return;
      }
    }
    let pull = fld.pitcherLine.BF >= fld.pitcherLimit;
    // classic-era aces finish games they lead unless clearly gassed
    if (pull && isStarter && fld.style === "classic" && lead > 0 && fld.pitcherLine.BF < fld.pitcherLimit * 1.3) pull = false;
    if (pull) {
      const r = pickReliever(fld, lead, inningNo);
      if (r) bringIn(fld, r, inningNo, h, bat);
    }
  }

  function managePitcherInInning(fld: Side, bat: Side, inningNo: number, h: Half, outs: number, bases: (Runner | null)[]) {
    const pl = fld.pitcherLine;
    const lead = fld === home ? home.runs - away.runs : away.runs - home.runs;
    const hook = fld.style === "modern" ? 4 : fld.style === "mid" ? 5 : 6;
    const traffic = bases.filter(Boolean).length;
    const shelled = pl.R >= hook && pl.BF >= 9;
    const gassed = pl.BF >= fld.pitcherLimit + 4 + (fld.style === "classic" ? 4 : 0);
    const tough = pl.BF >= fld.pitcherLimit && traffic >= 2 && Math.abs(lead) <= 2;
    if ((shelled && traffic > 0) || gassed || tough) {
      const r = pickReliever(fld, lead, inningNo);
      if (r) bringIn(fld, r, inningNo, h, bat);
    }
    void outs;
  }
}

function starterLimit(p: PitcherRating, style: Style, rng: Rng): number {
  const base = p.bfPerStart || 22;
  const cap = style === "modern" ? 27 : style === "mid" ? 34 : 40;
  return Math.min(cap, base) * rng.range(0.85, 1.15);
}

function relieverLimit(p: PitcherRating, style: Style, rng: Rng): number {
  const base = style === "modern" ? Math.min(5, p.bfPerRelief) : p.bfPerRelief;
  return Math.max(3, base * rng.range(0.8, 1.25));
}

function newPitchLine(p: PitcherRating): PitchLine {
  return { id: p.id, name: p.name, outs: 0, BF: 0, H: 0, R: 0, ER: 0, BB: 0, SO: 0, HR: 0, HBP: 0 };
}

function newBatLine(b: BatterRating, pos: Pos | string): BatLine {
  return { id: b.id, name: b.name, pos, AB: 0, R: 0, H: 0, "2B": 0, "3B": 0, HR: 0, RBI: 0, BB: 0, SO: 0, HBP: 0, SB: 0 };
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export { POS_NUM };
