import { EVENTS, RATED, type Ev, type RawLeague, type RawSeason, type Rates, type RatedEv } from "./types.js";

/**
 * An "environment" is what an average plate appearance looks like in a given league and year:
 * the per-PA chance of each outcome, plus a few non-PA habits (stealing, complete games, the DH).
 * Era adjustment works by describing every player relative to their OWN environment, then
 * replaying those relative ratings inside a TARGET environment chosen by the knobs.
 */
export interface Environment {
  label: string;
  year: number;
  lg: string;
  rates: Rates;
  runsPerGame: number;
  dh: boolean;
  /** stolen-base attempts per time a runner is on first with second open (approx.) */
  sbAttempt: number;
  sbSuccess: number;
  /** wild pitch / passed ball chance per PA with runners on */
  wp: number;
  /** share of starts that were complete games (drives "era" bullpen usage) */
  cgRate: number;
  /** fielding errors per team per game */
  errorsPerGame: number;
  /** spread of player talent per event: SD of log(player rate / league rate) among regulars */
  spread: Record<RatedEv, number>;
}

export function dhInEffect(year: number, lg: string): boolean {
  if (lg === "AL") return year >= 1973;
  if (lg === "NL") return year === 2020 || year >= 2022;
  // Negro Leagues and 19th-century leagues: no DH
  return false;
}

export function leagueRates(L: RawLeague): Rates {
  const PA = L.PA;
  const so = L.SO != null && L.SO > 0 ? L.SO / PA : 0.05;
  const hbp = L.HBP != null && L.HBP > 0 ? L.HBP / PA : 0.006;
  const bb = L.BB / PA;
  const hr = L.HR / PA;
  const t = L["3B"] / PA;
  const d = L["2B"] / PA;
  const s = (L.H - L["2B"] - L["3B"] - L.HR) / PA;
  // Reached on error: roughly half of all errors put the batter on base.
  const roe = Math.min(0.06, L.E != null ? (0.5 * L.E) / PA : 0.012);
  const out = Math.max(0.2, 1 - (so + hbp + bb + hr + t + d + s + roe));
  const r: Rates = { SO: so, BB: bb, HBP: hbp, HR: hr, "3B": t, "2B": d, "1B": s, ROE: roe, OUT: out };
  return normalize(r);
}

export function normalize(r: Rates): Rates {
  let sum = 0;
  for (const e of EVENTS) sum += r[e];
  const o = {} as Rates;
  for (const e of EVENTS) o[e] = r[e] / sum;
  return o;
}

export function buildEnvironment(season: RawSeason, lg: string, spread: Record<RatedEv, number>): Environment {
  const L = season.leagues[lg];
  if (!L) throw new Error(`No league ${lg} in ${season.year}`);
  const rates = leagueRates(L);
  const onFirstOpps = L.H - L["2B"] - L["3B"] - L.HR + L.BB + (L.HBP ?? 0);
  const attempts = (L.SB ?? 0) + (L.CS ?? 0);
  return {
    label: `${season.year} ${lg}`,
    year: season.year,
    lg,
    rates,
    runsPerGame: L.R / (L.G * 2),
    dh: dhInEffect(season.year, lg),
    sbAttempt: onFirstOpps > 0 ? Math.min(0.5, attempts / onFirstOpps) : 0.08,
    sbSuccess: L.CS != null && attempts > 0 && L.CS > 0 ? (L.SB ?? 0) / attempts : 0.68,
    wp: 0.008,
    cgRate: L.CG != null && L.GS ? L.CG / L.GS : 0.3,
    errorsPerGame: L.E && L.G ? L.E / (L.G * 2) : 0,
    spread,
  };
}

/** Average several environments (e.g. "meet in the middle" between two teams' eras). */
export function blendEnvironments(envs: Environment[], label: string): Environment {
  const n = envs.length;
  const avg = (f: (e: Environment) => number) => envs.reduce((a, e) => a + f(e), 0) / n;
  const rates = {} as Rates;
  for (const e of EVENTS) rates[e] = avg((x) => x.rates[e]);
  const spread = {} as Record<RatedEv, number>;
  for (const e of RATED) spread[e] = avg((x) => x.spread[e]);
  return {
    label,
    year: Math.round(avg((e) => e.year)),
    lg: envs.map((e) => e.lg).join("/"),
    rates: normalize(rates),
    runsPerGame: avg((e) => e.runsPerGame),
    dh: envs.some((e) => e.dh),
    sbAttempt: avg((e) => e.sbAttempt),
    sbSuccess: avg((e) => e.sbSuccess),
    wp: avg((e) => e.wp),
    cgRate: avg((e) => e.cgRate),
    errorsPerGame: avg((e) => e.errorsPerGame),
    spread,
  };
}

export function ratesToString(r: Rates): string {
  return EVENTS.map((e: Ev) => `${e} ${(r[e] * 100).toFixed(1)}%`).join("  ");
}
