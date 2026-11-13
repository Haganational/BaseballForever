import { useEffect, useMemo, useRef, useState } from "react";
import { simulateGame, type GameResult, type TeamBox } from "../../src/game";
import { DEFAULT_KNOBS, PRESETS, type Knobs } from "../../src/knobs";
import type { MemoryDataSource } from "../../src/source";
import type { RawTeam } from "../../src/types";
import { dataSourceLabel, loadEnvironments, loadIndex, loadTeam, type TeamIndexRow } from "./data";
import { describe, keyPlays, nameMap } from "./describe";
import { AnnouncerEditor } from "./AnnouncerEditor";
import { useAnnouncers } from "./announcerStore";
import { Radio } from "./Radio";
import { Highlights } from "./Highlights";
import type { Announcer } from "../../src/commentary/announcers";

type Series = { games: number; awayWins: number; awayRuns: number; homeRuns: number; margins: number[] };

export default function App() {
  const [index, setIndex] = useState<TeamIndexRow[] | null>(null);
  const [ds, setDs] = useState<MemoryDataSource | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [awayId, setAwayId] = useState("1927NYA");
  const [homeId, setHomeId] = useState("2016CHN");
  const [away, setAway] = useState<RawTeam | null>(null);
  const [home, setHome] = useState<RawTeam | null>(null);
  const [awayStarter, setAwayStarter] = useState("ace");
  const [homeStarter, setHomeStarter] = useState("ace");
  const [knobs, setKnobs] = useState<Knobs>({ ...DEFAULT_KNOBS });
  const [preset, setPreset] = useState("balanced");
  const [randomSeed, setRandomSeed] = useState(true);
  const [game, setGame] = useState<GameResult | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const booth = useAnnouncers();
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (editing) editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [editing]);
  // bring fresh results into view
  useEffect(() => { if (game || series) resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [game, series]);

  useEffect(() => {
    Promise.all([loadIndex(), loadEnvironments()])
      .then(([i, d]) => { setIndex(i); setDs(d); })
      .catch((e) => setLoadError(String(e)));
  }, []);
  useEffect(() => { setAway(null); setAwayStarter("ace"); loadTeam(awayId).then(setAway).catch((e) => setError(String(e))); }, [awayId]);
  useEffect(() => { setHome(null); setHomeStarter("ace"); loadTeam(homeId).then(setHome).catch((e) => setError(String(e))); }, [homeId]);

  const setK = <K extends keyof Knobs>(k: K, v: Knobs[K]) => setKnobs((o) => ({ ...o, [k]: v }));
  const choosePreset = (p: string) => { setPreset(p); setKnobs((o) => ({ ...o, ...PRESETS[p] })); };

  const ready = Boolean(ds && away && home);

  function playOne() {
    if (!ds || !away || !home) return;
    setError(null);
    try {
      const seed = randomSeed ? Math.floor(Math.random() * 1e9) : knobs.seed;
      if (randomSeed) setK("seed", seed);
      setGame(simulateGame(ds, away, home, { knobs: { ...knobs, seed }, awayStarter, homeStarter }));
    } catch (e) { setError(String(e)); }
  }

  function playSeries(n: number) {
    if (!ds || !away || !home) return;
    setBusy(true);
    setError(null);
    // let the button repaint before the CPU-heavy loop
    setTimeout(() => {
      try {
        const s: Series = { games: n, awayWins: 0, awayRuns: 0, homeRuns: 0, margins: [] };
        const base = Math.floor(Math.random() * 1e6);
        for (let i = 0; i < n; i++) {
          const g = simulateGame(ds, away, home, {
            knobs: { ...knobs, seed: base + i },
            awayStarter: awayStarter === "ace" ? "random" : awayStarter,
            homeStarter: homeStarter === "ace" ? "random" : homeStarter,
          });
          if (g.winner === "away") s.awayWins++;
          s.awayRuns += g.away.R;
          s.homeRuns += g.home.R;
          s.margins.push(g.away.R - g.home.R);
        }
        setSeries(s);
      } catch (e) { setError(String(e)); }
      setBusy(false);
    }, 20);
  }

  if (loadError) return <main className="wrap"><p className="err">Couldn't load the baseball data: {loadError}</p></main>;

  return (
    <main className="wrap">
      <header className="top" id="top">
        <h1>Baseball Forever</h1>
        <p className="sub">Any two teams from 1871 to 2025, era-adjusted. Data: Lahman Baseball Database via {dataSourceLabel}.</p>
      </header>
      <StickyBar visible={Boolean(game || series)} title={away && home ? `${away.year} ${shortName(away.name)} at ${home.year} ${shortName(home.name)}` : ""}
        onPlay={playOne} canPlay={ready} hasGame={Boolean(game)} />

      <section className="card matchup">
        <TeamSide label="Away" index={index} id={awayId} onPick={setAwayId} team={away} starter={awayStarter} onStarter={setAwayStarter} />
        <div className="vs">at</div>
        <TeamSide label="Home" index={index} id={homeId} onPick={setHomeId} team={home} starter={homeStarter} onStarter={setHomeStarter} />
      </section>

      <KnobsPanel knobs={knobs} setK={setK} preset={preset} choosePreset={choosePreset} randomSeed={randomSeed} setRandomSeed={setRandomSeed} />

      <section className="actions">
        <button className="primary" disabled={!ready} onClick={playOne}>Play ball</button>
        <button disabled={!ready || busy} onClick={() => playSeries(1000)}>{busy ? "Simulating…" : "Play 1,000 games"}</button>
        {!ready && <span className="muted">Loading teams…</span>}
      </section>
      {error && <p className="err">{error}</p>}

      <div ref={resultsRef} className="results-anchor">
        {series && away && home && <SeriesCard s={series} away={away} home={home} />}
        {game && <GameView g={game} announcers={booth.all} onEditAnnouncers={() => setEditing(true)} />}
      </div>
      <div ref={editorRef} className="results-anchor">
        {editing && <AnnouncerEditor all={booth.all} custom={booth.custom} save={booth.save} remove={booth.remove} onClose={() => setEditing(false)} />}
      </div>
      {!editing && <p className="muted small center"><button className="link" onClick={() => setEditing(true)}>🎙️ Create your own announcers</button></p>}
    </main>
  );
}

const shortName = (n: string) => n.split(" ").slice(-1)[0];
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

/** Pinned bar once a game has been played: jump around the page and play again without scrolling back up. */
function StickyBar({ visible, title, onPlay, canPlay, hasGame }: { visible: boolean; title: string; onPlay: () => void; canPlay: boolean; hasGame: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 400);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  if (!visible || !scrolled) return null;
  return (
    <nav className="sticky-bar" aria-label="Game navigation">
      <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top">▲ Top</button>
      <span className="sticky-title">{title}</span>
      {hasGame && (
        <span className="sticky-links">
          <button className="link" onClick={() => jump("sec-score")}>Score</button>
          <button className="link" onClick={() => jump("sec-radio")}>Radio</button>
          <button className="link" onClick={() => jump("sec-highlights")}>Highlights</button>
          <button className="link" onClick={() => jump("sec-box")}>Box</button>
        </span>
      )}
      <button className="primary" disabled={!canPlay} onClick={onPlay}>New game</button>
    </nav>
  );
}

function TeamSide(props: {
  label: string; index: TeamIndexRow[] | null; id: string; onPick: (id: string) => void;
  team: RawTeam | null; starter: string; onStarter: (s: string) => void;
}) {
  const { label, index, id, onPick, team, starter, onStarter } = props;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const row = index?.find((t) => t.id === id);
  const hits = useMemo(() => {
    if (!index || !q.trim()) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return index.filter((t) => words.every((w) => `${t.year} ${t.name} ${t.lg}`.toLowerCase().includes(w))).slice(0, 40);
  }, [index, q]);
  const starters = team ? [...team.pitchers].filter((p) => (p.GS ?? 0) > 0).sort((a, b) => (b.GS ?? 0) - (a.GS ?? 0)) : [];
  return (
    <div className="side">
      <div className="label">{label}</div>
      <div className="teamname">{row ? `${row.year} ${row.name}` : id}</div>
      {row && <div className="muted">{row.lg} · {row.W}–{row.L}{row.WS ? " · won the World Series" : ""}</div>}
      <div className="search">
        <input
          placeholder="Search: 1975 Reds, 1937 Grays, Cubs 2016…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          aria-label={`${label} team search`}
        />
        {open && hits.length > 0 && (
          <ul className="results">
            {hits.map((t) => (
              <li key={t.id}>
                <button onClick={() => { onPick(t.id); setQ(""); setOpen(false); }}>
                  <b>{t.year}</b> {t.name} <span className="muted">{t.lg} {t.W}–{t.L}{t.WS ? " ★" : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <label className="field">
        <span>Starting pitcher</span>
        <select value={starter} onChange={(e) => onStarter(e.target.value)} disabled={!team}>
          <option value="ace">Ace (most starts)</option>
          <option value="random">Random from rotation</option>
          {starters.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.W}–{p.L}, {p.IPOuts ? ((27 * (p.ER ?? 0)) / p.IPOuts).toFixed(2) : "?"} ERA, {p.GS} GS)</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Slider(p: { label: string; help: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="field" title={p.help}>
      <span>{p.label} <b>{p.value}</b></span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
      <small className="muted">{p.help}</small>
    </label>
  );
}

function Choice<T extends string>(p: { label: string; help: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="field">
      <span>{p.label}</span>
      <select value={p.value} onChange={(e) => p.onChange(e.target.value as T)}>
        {p.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <small className="muted">{p.help}</small>
    </label>
  );
}

function KnobsPanel(p: {
  knobs: Knobs; setK: <K extends keyof Knobs>(k: K, v: Knobs[K]) => void; preset: string; choosePreset: (s: string) => void;
  randomSeed: boolean; setRandomSeed: (b: boolean) => void;
}) {
  const { knobs: k, setK } = p;
  const parkMode = typeof k.park === "number" ? "custom" : k.park;
  return (
    <section className="card">
      {/* collapsed on phones so the game itself isn't buried under the settings */}
      <details className="knobs" open={typeof window === "undefined" || window.innerWidth > 720}>
      <summary><h2 className="inline">Knobs</h2> <span className="muted small">era, ballpark, ball, bullpen and more</span></summary>
      <div className="grid">
        <Choice label="Preset" help="How much of a season was skill vs. luck" value={p.preset} onChange={p.choosePreset}
          options={[["balanced", "Balanced (default)"], ["asItHappened", "As it happened"], ["trueTalent", "True talent (analyst)"]]} />
        <Choice label="Era to play in" help="The run-scoring world for this game" value={k.environment} onChange={(v) => setK("environment", v)}
          options={[["blend", "Halfway between the two teams"], ["home", "Home team's era"], ["away", "Away team's era"], ["year", "A specific season…"], ["alltime", "All-time MLB average"]]} />
        {k.environment === "year" && (
          <label className="field"><span>Season</span>
            <input type="number" min={1876} max={2025} value={k.envYear ?? 1960} onChange={(e) => setK("envYear", Number(e.target.value))} />
            <small className="muted">AL and NL averaged</small>
          </label>
        )}
        <Choice label="Era comparison" help="Relative judges players against their own league" value={k.eraMode} onChange={(v) => setK("eraMode", v)}
          options={[["relative", "Relative to their league"], ["raw", "Raw stats, no correction"]]} />
        <Slider label="Talent-spread adjust" help="Shrink stars from thin-talent eras (0 = off)" value={k.spreadAdjust} min={0} max={1} step={0.05} onChange={(v) => setK("spreadAdjust", v)} />
        <Choice label="Ballpark" help="Park effect on hitting" value={parkMode} onChange={(v) => setK("park", v === "custom" ? 1.1 : v)}
          options={[["home", "Home team's park"], ["neutral", "Neutral park"], ["custom", "Custom factor…"]]} />
        {typeof k.park === "number" && <Slider label="Park run factor" help="1.0 neutral, 1.2 Coors-like" value={k.park} min={0.8} max={1.3} step={0.01} onChange={(v) => setK("park", v)} />}
        <Choice label="Baseball" help="Change the ball itself" value={k.ball} onChange={(v) => setK("ball", v)}
          options={[["era", "Era's ball"], ["dead", "Dead ball"], ["lively", "Lively ball"], ["juiced", "Juiced ball"]]} />
        <Choice label="Mound" help="High mound before 1969" value={k.mound} onChange={(v) => setK("mound", v)}
          options={[["era", "Era's mound"], ["high", "High (15 in.)"], ["low", "Low (10 in.)"]]} />
        <Choice label="Designated hitter" help="Era follows the home team's rule" value={k.dh} onChange={(v) => setK("dh", v)}
          options={[["era", "Era rule"], ["on", "On"], ["off", "Off"]]} />
        <Choice label="Bullpen" help="How long starters stay in" value={k.bullpen} onChange={(v) => setK("bullpen", v)}
          options={[["team", "Each team's era"], ["modern", "Modern quick hooks"], ["classic", "Classic, starters finish"]]} />
        <Choice label="Batting order" help="Who bats where" value={k.lineup} onChange={(v) => setK("lineup", v)}
          options={[["traditional", "Traditional"], ["optimized", "Optimized (The Book)"]]} />
        <Choice label="Extra-inning runner" help="Runner on second in extras" value={k.ghostRunner} onChange={(v) => setK("ghostRunner", v)}
          options={[["era", "Era rule"], ["on", "On"], ["off", "Off"]]} />
        <Slider label="Home-field advantage" help="1 = historical" value={k.homeField} min={0} max={2} step={0.1} onChange={(v) => setK("homeField", v)} />
        <Slider label="Times-through-order effect" help="Batters improve vs. tiring starters" value={k.timesThroughOrder} min={0} max={2} step={0.1} onChange={(v) => setK("timesThroughOrder", v)} />
      </div>
      <details>
        <summary>Fine-tuning</summary>
        <div className="grid">
          <Slider label="Luck correction" help="0 = trust every stat line, 1 = analyst projection" value={k.regression} min={0} max={2} step={0.05} onChange={(v) => setK("regression", v)} />
          <Slider label="Pitcher control of balls in play" help="Credit pitchers for hits allowed" value={k.pitcherBipControl} min={0} max={1} step={0.05} onChange={(v) => setK("pitcherBipControl", v)} />
          <Slider label="Defense weight" help="How much fielders matter" value={k.defenseWeight} min={0} max={1} step={0.05} onChange={(v) => setK("defenseWeight", v)} />
          <Slider label="Home runs ×" help="" value={k.hrFactor} min={0.25} max={3} step={0.05} onChange={(v) => setK("hrFactor", v)} />
          <Slider label="Strikeouts ×" help="" value={k.soFactor} min={0.25} max={3} step={0.05} onChange={(v) => setK("soFactor", v)} />
          <Slider label="Walks ×" help="" value={k.bbFactor} min={0.25} max={3} step={0.05} onChange={(v) => setK("bbFactor", v)} />
          <Slider label="Hits on balls in play ×" help="" value={k.babipFactor} min={0.5} max={1.5} step={0.05} onChange={(v) => setK("babipFactor", v)} />
          <Slider label="Errors ×" help="" value={k.errorFactor} min={0} max={4} step={0.1} onChange={(v) => setK("errorFactor", v)} />
          <Slider label="Steal attempts ×" help="" value={k.stealFactor} min={0} max={4} step={0.1} onChange={(v) => setK("stealFactor", v)} />
          <label className="field"><span>Seed</span>
            <input type="number" value={k.seed} disabled={p.randomSeed} onChange={(e) => setK("seed", Number(e.target.value))} />
            <label className="check"><input type="checkbox" checked={p.randomSeed} onChange={(e) => p.setRandomSeed(e.target.checked)} /> New random game each time</label>
          </label>
        </div>
      </details>
      </details>
    </section>
  );
}

function SeriesCard({ s, away, home }: { s: Series; away: RawTeam; home: RawTeam }) {
  const pct = (100 * s.awayWins) / s.games;
  return (
    <section className="card">
      <h2>{s.games.toLocaleString()}-game series</h2>
      <div className="bar" role="img" aria-label={`${away.name} won ${pct.toFixed(1)} percent`}>
        <div className="bar-away" style={{ width: `${pct}%` }}>{away.year} {away.name} {s.awayWins}</div>
        <div className="bar-home">{home.year} {home.name} {s.games - s.awayWins}</div>
      </div>
      <p>Average score: {away.name} {(s.awayRuns / s.games).toFixed(2)}, {home.name} {(s.homeRuns / s.games).toFixed(2)}.
        {" "}Blowouts (5+ runs): {s.margins.filter((m) => Math.abs(m) >= 5).length}. One-run games: {s.margins.filter((m) => Math.abs(m) === 1).length}.</p>
    </section>
  );
}

const ip = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;

function GameView({ g, announcers, onEditAnnouncers }: { g: GameResult; announcers: Announcer[]; onEditAnnouncers: () => void }) {
  const names = useMemo(() => nameMap(g), [g]);
  const innings = Math.max(9, g.away.lineScore.length, g.home.lineScore.length);
  const key = keyPlays(g);
  const halves: { title: string; lines: string[] }[] = [];
  for (const e of g.events) {
    if (e.kind === "inning_start") halves.push({ title: e.text, lines: [] });
    else if (e.kind !== "game_end" && halves.length) halves[halves.length - 1].lines.push(describe(e, names));
  }
  return (
    <>
      <section className="card anchor" id="sec-score">
        <h2>Final{g.innings > 9 ? ` (${g.innings} innings)` : ""}</h2>
        <div className="scroll">
          <table className="linescore">
            <thead><tr><th></th>{Array.from({ length: innings }, (_, i) => <th key={i}>{i + 1}</th>)}<th>R</th><th>H</th><th>E</th></tr></thead>
            <tbody>
              {[g.away, g.home].map((t) => (
                <tr key={t.team.id} className={(t === g.away) === (g.winner === "away") ? "win" : ""}>
                  <th>{t.team.year} {t.team.name}</th>
                  {Array.from({ length: innings }, (_, i) => <td key={i}>{t.lineScore[i] === undefined ? "" : Number.isNaN(t.lineScore[i]) ? "x" : t.lineScore[i]}</td>)}
                  <td><b>{t.R}</b></td><td>{t.H}</td><td>{t.E}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Played in: {g.environment.label} (about {g.environment.runsPerGame.toFixed(2)} runs per team per game). Seed {g.knobs.seed}.</p>
      </section>

      <div id="sec-radio" className="anchor"><Radio g={g} announcers={announcers} onEditAnnouncers={onEditAnnouncers} /></div>

      <div id="sec-highlights" className="anchor">{key.length > 0 && <Highlights plays={key} names={names} />}</div>

      <section className="two anchor" id="sec-box">
        {[g.away, g.home].map((t) => <Box key={t.team.id} t={t} />)}
      </section>

      <section className="card">
        <details>
          <summary><h2 className="inline">Play-by-play</h2></summary>
          {halves.map((h, i) => (
            <div key={i} className="half">
              <h3>{h.title}</h3>
              <ul>{h.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>
            </div>
          ))}
        </details>
      </section>
    </>
  );
}

function Box({ t }: { t: TeamBox }) {
  const batters = t.batting.filter((b, i) => i < 9 || b.AB + b.BB + b.HBP > 0);
  return (
    <div className="card">
      <h2>{t.team.year} {t.team.name}</h2>
      <div className="scroll">
        <table className="box">
          <thead><tr><th>Batting</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>SO</th><th>HR</th></tr></thead>
          <tbody>{batters.map((b) => <tr key={b.id}><th>{b.name} <span className="muted">{b.pos}</span></th><td>{b.AB}</td><td>{b.R}</td><td>{b.H}</td><td>{b.RBI}</td><td>{b.BB}</td><td>{b.SO}</td><td>{b.HR}</td></tr>)}</tbody>
        </table>
        <table className="box">
          <thead><tr><th>Pitching</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>SO</th><th>HR</th></tr></thead>
          <tbody>{t.pitching.map((p) => <tr key={p.id}><th>{p.name}{p.decision ? ` (${p.decision})` : ""}</th><td>{ip(p.outs)}</td><td>{p.H}</td><td>{p.R}</td><td>{p.ER}</td><td>{p.BB}</td><td>{p.SO}</td><td>{p.HR}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
