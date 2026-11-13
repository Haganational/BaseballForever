-- Baseball Forever: tables the web page reads. Run once in the Supabase SQL editor.
-- Data is public, read-only for visitors (anon key); only the upload script (service key) writes.

create table if not exists environments (
  key  text primary key,          -- e.g. '1927AL'
  year int  not null,
  lg   text not null,
  data jsonb not null             -- league rates, talent spread, era habits (see src/environment.ts)
);

create table if not exists team_seasons (
  id     text primary key,        -- e.g. '1927NYA'
  year   int  not null,
  lg     text not null,
  name   text not null,
  franch text,
  w      int,
  l      int,
  ws     boolean not null default false,
  roster jsonb not null           -- batters and pitchers with season stats (see src/types.ts RawTeam)
);
create index if not exists team_seasons_year_idx on team_seasons (year);
create index if not exists team_seasons_name_idx on team_seasons (lower(name));

alter table environments enable row level security;
alter table team_seasons enable row level security;
drop policy if exists "public read" on environments;
drop policy if exists "public read" on team_seasons;
create policy "public read" on environments for select using (true);
create policy "public read" on team_seasons for select using (true);
