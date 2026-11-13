import { leagueRates } from "./environment.js";
import type { Knobs } from "./knobs.js";
import { RATED, type RawBatter, type RawPitcher, type RawSeason, type Rates, type RatedEv, type Ratios } from "./types.js";

/** Sample size (PA or batters faced) at which half the weight is on the player and half on average. */
const BAT_K: Record<RatedEv, number> = { SO: 60, BB: 120, HBP: 240, HR: 170, "3B": 400, "2B": 500, "1B": 500 };
const PIT_K: Record<RatedEv, number> = { SO: 70, BB: 170, HBP: 640, HR: 1000, "3B": 400, "2B": 400, "1B": 400 };

/** What a typical pitcher looks like at the plate, relative to the league. */
const PITCHER_AS_HITTER: Ratios = { SO: 2.4, BB: 0.45, HBP: 0.5, HR: 0.2, "3B": 0.4, "2B": 0.45, "1B": 0.65 };

const n = (v: number | null | undefined) => (v == null ? 0 : v);

/** Ballpark effect on each event for a park with run factor pf (1.00 = neutral). */
export function parkMultipliers(pf: number): Ratios {
  return {
    SO: Math.pow(pf, -0.15),
    BB: Math.pow(pf, 0.15),
    HBP: 1,
    HR: Math.pow(pf, 1.2),
    "3B": Math.pow(pf, 0.8),
    "2B": Math.pow(pf, 0.6),
    "1B": Math.pow(pf, 0.4),
  };
}

/** Extra-base-hit power (2B + 3B + HR) relative to league: a steadier measure of power than HR alone. */
export function xbhRatio(r: Ratios, lg: Rates): number {
  const lgX = lg.HR + lg["3B"] + lg["2B"];
  return (r.HR * lg.HR + r["3B"] * lg["3B"] + r["2B"] * lg["2B"]) / lgX;
}

export interface BatterRating {
  id: string;
  name: string;
  bats: string;
  pa: number;
  ratios: Ratios;
  /** extra-base-hit power vs league; see matchup() for how it's used when moving eras */
  xbh: number;
  /** stolen-base attempts per time on first, and success rate */
  sbAttempt: number;
  sbSuccess: number;
  /** 0.7 (slow) .. 1.3 (fast); scales extra-base running */
  speed: number;
  pos: Record<string, number>;
  isPitcher: boolean;
  raw: RawBatter;
}

export interface PitcherRating {
  id: string;
  name: string;
  throws: string;
  bf: number;
  ratios: Ratios;
  G: number;
  GS: number;
  SV: number;
  /** expected batters faced per start / per relief outing */
  bfPerStart: number;
  bfPerRelief: number;
  cgRate: number;
  era: number;
  /**
   * Hits allowed on balls in play vs league, before separating pitcher from fielders.
   * buildTeam() splits this into a team defense part and a (small) pitcher part.
   */
  bipRaw: number;
  /** how much he was actually used in relief (batters faced), for picking relievers */
  reliefWeight: number;
  raw: RawPitcher;
}

export function batterPA(b: RawBatter): number {
  return n(b.AB) + n(b.BB) + n(b.HBP) + n(b.SH) + n(b.SF);
}

export function rateBatter(b: RawBatter, lg: Rates, bpf: number, knobs: Knobs): BatterRating {
  const pa = batterPA(b);
  const games = Object.values(b.pos).reduce((a, x) => a + x, 0);
  const isPitcher = games > 0 && n(b.pos.p) / games > 0.5;
  const counts: Record<RatedEv, number | null> = {
    SO: b.SO,
    BB: b.BB,
    HBP: b.HBP,
    HR: b.HR,
    "3B": b["3B"],
    "2B": b["2B"],
    "1B": n(b.H) - n(b["2B"]) - n(b["3B"]) - n(b.HR),
  };
  const park = parkMultipliers(bpf);
  const ratios = {} as Ratios;
  for (const e of RATED) {
    const prior = isPitcher ? lg[e] * PITCHER_AS_HITTER[e] : lg[e];
    const c = counts[e];
    // Missing old-era stat (e.g. strikeouts before 1910): assume the prior.
    if (c == null || pa === 0) {
      ratios[e] = prior / lg[e];
      continue;
    }
    const k = BAT_K[e] * knobs.regression;
    const rate = (c + k * prior) / (pa + k);
    // Strip out the player's home park (he played half his games there).
    const homeHalf = 0.5 + 0.5 * park[e];
    ratios[e] = rate / lg[e] / homeHalf;
  }
  const onFirst = Math.max(1, counts["1B"]! + n(b.BB) + n(b.HBP));
  const att = n(b.SB) + n(b.CS);
  const sbAttempt = att / (onFirst + 20); // regress toward zero attempts
  const sbSuccess = b.CS != null ? (n(b.SB) + 7) / (att + 10) : 0.7;
  // speed from triples rate + steal attempts, centered on 1.0
  const speed = Math.max(0.7, Math.min(1.3, 0.85 + 0.15 * ratios["3B"] + 1.2 * Math.min(0.15, sbAttempt)));
  return {
    id: b.id,
    name: b.name,
    bats: b.bats ?? "R",
    pa,
    ratios,
    xbh: xbhRatio(ratios, lg),
    sbAttempt,
    sbSuccess,
    speed,
    pos: b.pos,
    isPitcher,
    raw: b,
  };
}

export function ratePitcher(p: RawPitcher, lg: Rates, ppf: number, knobs: Knobs): PitcherRating {
  const bf = p.BFP ?? n(p.IPOuts) + n(p.H) + n(p.BB) + n(p.HBP);
  const park = parkMultipliers(ppf);
  const ratios = {} as Ratios;
  const nonHrHits = n(p.H) - n(p.HR);
  const lgHitsOnBip = lg["1B"] + lg["2B"] + lg["3B"];
  const counts: Record<RatedEv, number | null> = {
    SO: p.SO,
    BB: p.BB,
    HBP: p.HBP,
    HR: p.HR,
    // Pitching lines don't split singles/doubles/triples, so spread hits in league proportions.
    "3B": nonHrHits * (lg["3B"] / lgHitsOnBip),
    "2B": nonHrHits * (lg["2B"] / lgHitsOnBip),
    "1B": nonHrHits * (lg["1B"] / lgHitsOnBip),
  };
  for (const e of RATED) {
    const c = counts[e];
    if (c == null || bf === 0) {
      ratios[e] = 1;
      continue;
    }
    const k = PIT_K[e] * knobs.regression;
    const rate = (c + k * lg[e]) / (bf + k);
    const homeHalf = 0.5 + 0.5 * park[e];
    let r = rate / lg[e] / homeHalf;
    ratios[e] = r;
  }
  const G = n(p.G);
  const GS = n(p.GS);
  const relief = G - GS;
  const bfPerRelief = 4.5;
  const bfPerStart = GS > 0 ? Math.min(40, Math.max(12, (bf - relief * bfPerRelief) / GS)) : 0;
  const ip = n(p.IPOuts) / 3;
  return {
    id: p.id,
    name: p.name,
    throws: p.throws ?? "R",
    bf,
    ratios,
    G,
    GS,
    SV: n(p.SV),
    bfPerStart,
    bfPerRelief: GS === 0 && G > 0 ? Math.max(3, Math.min(12, bf / G)) : bfPerRelief,
    cgRate: GS > 0 ? n(p.CG) / GS : 0,
    era: ip > 0 ? (9 * n(p.ER)) / ip : 99,
    bipRaw: ratios["1B"],
    reliefWeight: 1,
    raw: p,
  };
}

/**
 * How spread out true talent is in a league, per event: the standard deviation of
 * (player rate / league rate) among regulars, after removing coin-flip noise.
 */
export function talentSpread(season: RawSeason, lg: string): Record<RatedEv, number> {
  const L = season.leagues[lg];
  const rates = leagueRates(L);
  const teams = season.teams.filter((t) => t.lg === lg);
  const gamesPerTeam = teams.reduce((a, t) => a + n(t.G), 0) / Math.max(1, teams.length);
  const minPA = Math.max(100, 2.0 * gamesPerTeam);
  const out = {} as Record<RatedEv, number>;
  const regs = teams.flatMap((t) => t.batters).filter((b) => batterPA(b) >= minPA);
  for (const e of RATED) {
    // Work on a log scale: talent multiplies (a 2x home run hitter is as far above average
    // as a 0.5x one is below), and the log keeps a single Babe Ruth from dominating the SD.
    const xs: number[] = [];
    let noise = 0;
    for (const b of regs) {
      const pa = batterPA(b);
      const c =
        e === "1B" ? n(b.H) - n(b["2B"]) - n(b["3B"]) - n(b.HR) : (b[e as keyof typeof b] as number | null);
      if (c == null) continue;
      xs.push(Math.log((c + 0.5) / (pa + 1) / rates[e]));
      // variance of log(count) from pure chance is about 1 / expected count
      noise += 1 / (pa * rates[e] + 0.5);
    }
    if (xs.length < 10) {
      out[e] = NaN;
      continue;
    }
    const mean = xs.reduce((a, x) => a + x, 0) / xs.length;
    const v = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length - noise / xs.length;
    out[e] = Math.sqrt(Math.max(0.0025, v));
  }
  return out;
}
