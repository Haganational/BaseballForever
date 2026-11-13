import type { Environment } from "./environment.js";
import type { Knobs } from "./knobs.js";
import { RATED, type Rates, type RatedEv, type Ratios } from "./types.js";

const odds = (p: number) => p / (1 - p);
const prob = (o: number) => o / (1 + o);
const clampP = (p: number) => Math.min(0.95, Math.max(1e-5, p));

/** Turn a "rate ratio vs own league" into an odds ratio vs a reference rate. */
function oddsRatio(ratio: number, ownRate: number, refRate: number): number {
  const x = clampP(ratio * ownRate);
  return odds(x) / odds(clampP(refRate));
}

export interface Side {
  ratios: Ratios;
  /** the player's own league environment */
  env: Environment;
  /** batters only: extra-base-hit power vs own league */
  xbh?: number;
}

/**
 * Home run rating to carry into the target world. In low-homer eras a handful of homers makes a
 * huge ratio (Honus Wagner's 10 HR in 1908 were 4.6x the league rate, many inside-the-park) that
 * says little about power in a 40-homer world. So when moving a player to a world with many
 * more homers than his own, lean partly on his overall extra-base power instead.
 * Same or lower homer world: his real HR rate is used unchanged.
 */
export function translatedHrRatio(s: Side, target: Environment): number {
  const own = s.env.rates.HR, tgt = target.rates.HR;
  if (s.xbh == null || tgt <= own * 1.25) return s.ratios.HR;
  const w = Math.sqrt(own / tgt);
  return Math.exp(w * Math.log(s.ratios.HR) + (1 - w) * Math.log(s.xbh));
}

/** Resize a player's edge to fit the target world's talent spread (see knobs.spreadAdjust). */
function spreadExponent(e: RatedEv, own: Environment, target: Environment, amount: number): number {
  const a = own.spread[e];
  const b = target.spread[e];
  if (!amount || !isFinite(a) || !isFinite(b) || a <= 0 || b <= 0) return 1;
  return Math.min(1.6, Math.max(0.4, Math.pow(b / a, amount)));
}

/** Ball and mound changes, relative to what the target world already had. */
export function equipmentMultipliers(target: Environment, knobs: Knobs): Ratios {
  const m: Ratios = { SO: 1, BB: 1, HBP: 1, HR: 1, "3B": 1, "2B": 1, "1B": 1 };
  const deadEra = target.year < 1920;
  if (knobs.ball === "dead" && !deadEra) {
    m.HR *= 0.35; m["3B"] *= 1.3; m["2B"] *= 0.85; m.SO *= 0.85;
  } else if ((knobs.ball === "lively" || knobs.ball === "juiced") && deadEra) {
    m.HR *= 2.8; m["3B"] *= 0.77; m["2B"] *= 1.18; m.SO *= 1.15;
  }
  if (knobs.ball === "juiced") {
    m.HR *= 1.25; m["2B"] *= 1.03;
  }
  const highEra = target.year < 1969;
  const mound = { SO: 1.08, BB: 0.95, HR: 0.92, hit: 0.97 };
  let f = 0;
  if (knobs.mound === "high" && !highEra) f = 1;
  if (knobs.mound === "low" && highEra) f = -1;
  if (f) {
    m.SO *= Math.pow(mound.SO, f);
    m.BB *= Math.pow(mound.BB, f);
    m.HR *= Math.pow(mound.HR, f);
    m["1B"] *= Math.pow(mound.hit, f);
    m["2B"] *= Math.pow(mound.hit, f);
    m["3B"] *= Math.pow(mound.hit, f);
  }
  return m;
}

export interface MatchupContext {
  target: Environment;
  knobs: Knobs;
  /** park, equipment, home field, fatigue, knob multipliers, all multiplied together */
  mods: Ratios;
  /** fielding team's error tendency (1 = league average) */
  errorMult: number;
}

/** Probability of each plate-appearance outcome for this batter against this pitcher. */
export function matchup(bat: Side, pit: Side, ctx: MatchupContext): Rates {
  const { target, knobs } = ctx;
  const out = {} as Rates;
  let sum = 0;
  for (const e of RATED) {
    const T = target.rates[e];
    let orB: number, orP: number;
    if (knobs.eraMode === "raw") {
      orB = oddsRatio(bat.ratios[e], bat.env.rates[e], T);
      orP = oddsRatio(pit.ratios[e], pit.env.rates[e], T);
    } else {
      const br = e === "HR" ? translatedHrRatio(bat, target) : bat.ratios[e];
      orB = Math.pow(oddsRatio(br, bat.env.rates[e], bat.env.rates[e]), spreadExponent(e, bat.env, target, knobs.spreadAdjust));
      orP = Math.pow(oddsRatio(pit.ratios[e], pit.env.rates[e], pit.env.rates[e]), spreadExponent(e, pit.env, target, knobs.spreadAdjust));
    }
    const p = prob(odds(T) * orB * orP * ctx.mods[e]);
    out[e] = p;
    sum += p;
  }
  out.ROE = target.rates.ROE * knobs.errorFactor * ctx.errorMult;
  sum += out.ROE;
  if (sum > 0.8) {
    const s = 0.8 / sum;
    for (const e of RATED) out[e] *= s;
    out.ROE *= s;
    sum = 0.8;
  }
  out.OUT = 1 - sum;
  return out;
}
