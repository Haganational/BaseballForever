// Raw data shapes, as written by scripts/build_data.py from the Lahman database.

export type Num = number | null;

export interface RawBatter {
  id: string;
  name: string;
  bats: string | null;
  throws: string | null;
  G: Num; AB: Num; R: Num; H: Num; "2B": Num; "3B": Num; HR: Num; RBI: Num;
  SB: Num; CS: Num; BB: Num; SO: Num; IBB: Num; HBP: Num; SH: Num; SF: Num; GIDP: Num;
  pos: Record<string, number>;
  GS: Num;
}

export interface RawPitcher {
  id: string;
  name: string;
  throws: string | null;
  W: Num; L: Num; G: Num; GS: Num; CG: Num; SHO: Num; SV: Num; IPOuts: Num;
  H: Num; ER: Num; HR: Num; BB: Num; SO: Num; IBB: Num; WP: Num; HBP: Num; BK: Num;
  BFP: Num; GF: Num; R: Num;
}

export interface RawTeam {
  id: string; // e.g. "1927NYA"
  teamID: string;
  year: number;
  lg: string | null;
  franch: string | null;
  name: string;
  park: string | null;
  W: Num; L: Num; G: Num; R: Num; RA: Num; E: Num; DP: Num;
  BPF: Num; PPF: Num;
  WSWin: boolean; LgWin: boolean;
  batters: RawBatter[];
  pitchers: RawPitcher[];
}

export interface RawLeague {
  PA: number; AB: number; H: number; "2B": number; "3B": number; HR: number; BB: number;
  HBP: Num; SO: Num; SF: Num; SH: Num; SB: Num; CS: Num; GIDP: Num;
  R: number; G: number; E: Num; DP: Num; IPOuts: Num; CG: Num; GS: Num; SV: Num;
  teams: number;
}

export interface RawSeason {
  year: number;
  leagues: Record<string, RawLeague>;
  teams: RawTeam[];
}

/** The plate-appearance outcomes the engine models. OUT = ball in play turned into an out. */
export const EVENTS = ["SO", "BB", "HBP", "HR", "3B", "2B", "1B", "ROE", "OUT"] as const;
export type Ev = (typeof EVENTS)[number];
/** Events that carry a per-player rating (OUT is the remainder, ROE is a fielding event). */
export const RATED = ["SO", "BB", "HBP", "HR", "3B", "2B", "1B"] as const;
export type RatedEv = (typeof RATED)[number];

export type Rates = Record<Ev, number>;
export type Ratios = Record<RatedEv, number>;
