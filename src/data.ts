import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { blendEnvironments, type Environment } from "./environment.js";
import type { RawSeason, RawTeam } from "./types.js";

/**
 * Data access. Kept behind this small interface so the web app can later swap the
 * local JSON files for Supabase without touching the engine.
 */
export interface DataSource {
  season(year: number): RawSeason;
  environment(year: number, lg: string): Environment;
  allEnvironments(): Environment[];
}

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(here, "..", "data");

export class FileDataSource implements DataSource {
  private seasons = new Map<number, RawSeason>();
  private envs: Record<string, Environment> | null = null;
  constructor(private dir = DATA_DIR) {}

  season(year: number): RawSeason {
    let s = this.seasons.get(year);
    if (!s) {
      const p = join(this.dir, "seasons", `${year}.json`);
      if (!existsSync(p)) throw new Error(`No data for season ${year}`);
      s = JSON.parse(readFileSync(p, "utf8")) as RawSeason;
      this.seasons.set(year, s);
    }
    return s;
  }

  private loadEnvs(): Record<string, Environment> {
    if (!this.envs) {
      const p = join(this.dir, "environments.json");
      if (!existsSync(p)) throw new Error("data/environments.json missing: run `npm run build:envs`");
      this.envs = JSON.parse(readFileSync(p, "utf8"));
    }
    return this.envs!;
  }

  environment(year: number, lg: string): Environment {
    const e = this.loadEnvs()[`${year}${lg}`];
    if (!e) throw new Error(`No environment for ${year} ${lg}`);
    return e;
  }

  allEnvironments(): Environment[] {
    return Object.values(this.loadEnvs());
  }
}

/** Find a team by id like "1927NYA", or by a looser "1927 Yankees" style query. */
export function findTeam(ds: DataSource, query: string): RawTeam {
  const m = query.trim().match(/^(\d{4})\s*(.*)$/);
  if (!m) throw new Error(`Team query should start with a year, e.g. "1927 Yankees" or "1927NYA": ${query}`);
  const year = Number(m[1]);
  const rest = m[2].trim().toLowerCase();
  const teams = ds.season(year).teams;
  const exact = teams.find((t) => t.teamID.toLowerCase() === rest || t.id.toLowerCase() === query.toLowerCase());
  if (exact) return exact;
  const hits = teams.filter((t) => t.name.toLowerCase().includes(rest) || (t.franch ?? "").toLowerCase() === rest);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(`"${query}" matches several teams: ${hits.map((t) => `${t.id} ${t.name}`).join(", ")}`);
  throw new Error(`No ${year} team matching "${m[2]}". Teams that year: ${teams.map((t) => `${t.teamID} (${t.name})`).join(", ")}`);
}

/** All-time MLB average world (AL + NL, 1901 onward). */
export function allTimeEnvironment(ds: DataSource): Environment {
  const envs = ds.allEnvironments().filter((e) => (e.lg === "AL" || e.lg === "NL") && e.year >= 1901);
  return { ...blendEnvironments(envs, "All-time MLB average"), dh: false };
}
