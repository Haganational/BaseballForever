import { blendEnvironments, type Environment } from "./environment.js";

/**
 * Data access, kept behind this small interface so the engine runs the same way from
 * local JSON files (command line), static files (web page) or Supabase.
 * Browser-safe: no Node imports in this file.
 */
export interface DataSource {
  /** league-wide errors per team per game, for scaling a team's fielding */
  leagueErrorsPerGame(year: number, lg: string): number;
  environment(year: number, lg: string): Environment;
  allEnvironments(): Environment[];
}


/** All-time MLB average world (AL + NL, 1901 onward). */
export function allTimeEnvironment(ds: DataSource): Environment {
  const envs = ds.allEnvironments().filter((e) => (e.lg === "AL" || e.lg === "NL") && e.year >= 1901);
  return { ...blendEnvironments(envs, "All-time MLB average"), dh: false };
}

/** A DataSource over data that is already in memory (what the web page uses). */
export class MemoryDataSource implements DataSource {
  constructor(private envs: Record<string, Environment>, private errorsPerGame: Record<string, number> = {}) {}
  environment(year: number, lg: string): Environment {
    const e = this.envs[`${year}${lg}`];
    if (!e) throw new Error(`No environment for ${year} ${lg}`);
    return e;
  }
  allEnvironments(): Environment[] {
    return Object.values(this.envs);
  }
  leagueErrorsPerGame(year: number, lg: string): number {
    return this.errorsPerGame[`${year}${lg}`] ?? this.envs[`${year}${lg}`]?.errorsPerGame ?? 0;
  }
}
