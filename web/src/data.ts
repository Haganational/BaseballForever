import type { Environment } from "../../src/environment";
import { MemoryDataSource } from "../../src/source";
import type { RawTeam } from "../../src/types";

export interface TeamIndexRow {
  id: string;
  year: number;
  lg: string;
  name: string;
  W: number | null;
  L: number | null;
  WS: boolean;
}

/**
 * Where the page gets its data. With VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set, it reads
 * from Supabase (tables from supabase/schema.sql). Otherwise it reads the static files that
 * `npm run prepare-data` copies into public/data.
 */
const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const useSupabase = Boolean(SB_URL && SB_KEY);

async function sb<T>(path: string): Promise<T> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

async function file<T>(path: string): Promise<T> {
  const r = await fetch(`${import.meta.env.BASE_URL}data/${path}`);
  if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`);
  return r.json();
}

export const dataSourceLabel = useSupabase ? "Supabase" : "built-in files";

export async function loadIndex(): Promise<TeamIndexRow[]> {
  if (useSupabase) {
    const rows: TeamIndexRow[] = [];
    // PostgREST pages at 1000 rows by default
    for (let from = 0; ; from += 1000) {
      const page = await sb<TeamIndexRow[]>(`team_seasons?select=id,year,lg,name,W:w,L:l,WS:ws&order=year,name&offset=${from}&limit=1000`);
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
  }
  return file<TeamIndexRow[]>("teams-index.json");
}

export async function loadEnvironments(): Promise<MemoryDataSource> {
  const envs = useSupabase
    ? Object.fromEntries((await sb<{ key: string; data: Environment }[]>("environments?select=key,data")).map((r) => [r.key, r.data]))
    : await file<Record<string, Environment>>("environments.json");
  return new MemoryDataSource(envs);
}

const teamCache = new Map<string, Promise<RawTeam>>();
export function loadTeam(id: string): Promise<RawTeam> {
  let p = teamCache.get(id);
  if (!p) {
    p = useSupabase
      ? sb<{ roster: RawTeam }[]>(`team_seasons?id=eq.${encodeURIComponent(id)}&select=roster`).then((r) => {
          if (!r[0]) throw new Error(`No team ${id}`);
          return r[0].roster;
        })
      : file<RawTeam>(`teams/${id}.json`);
    teamCache.set(id, p);
  }
  return p;
}
