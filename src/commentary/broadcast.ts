import type { GameEvent, GameResult, PlayEvent, TeamBox } from "../game.js";
import { ordinal } from "../game.js";
import { Rng } from "../rng.js";
import type { RawBatter, RawPitcher, RawTeam } from "../types.js";
import type { Announcer } from "./announcers.js";

/**
 * Turns a finished game's event log into a two-person radio broadcast: a play-by-play voice
 * calls every play, and an optional color analyst adds stats, history and opinions.
 * The same game + booth + seed always produces the same broadcast.
 */

export interface BroadcastLine {
  speaker: Announcer;
  text: string;
  /** index into GameResult.events this line belongs to (-1 for intro) */
  eventIndex: number;
  /** 0..1, for pacing and how the line is shown or spoken */
  excitement: number;
  /** suggested pause after the line when played "live", in milliseconds */
  pauseMs: number;
}

export interface Booth {
  pbp: Announcer;
  color?: Announcer | null;
}

const POS_NAME: Record<string, string> = { p: "the pitcher", c: "the catcher", "1b": "first", "2b": "second", "3b": "third", ss: "short", lf: "left", cf: "center", rf: "right" };
const NUM_TO_POS = ["", "p", "c", "1b", "2b", "3b", "ss", "lf", "cf", "rf"];
const FIELD = ["", "", "", "", "", "", "", "left field", "center field", "right field"];
const NUMBER_WORDS = ["nothing", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const num = (n: number) => NUMBER_WORDS[n] ?? String(n);
const last = (name: string) => name.split(" ").slice(-1)[0];
const n0 = (v: number | null | undefined) => v ?? 0;

interface PlayerInfo { name: string; team: RawTeam; bat?: RawBatter; pitch?: RawPitcher }

export function generateBroadcast(g: GameResult, booth: Booth, seed = 1): BroadcastLine[] {
  const rng = new Rng(seed * 7919 + 13);
  const out: BroadcastLine[] = [];
  const { pbp, color } = booth;
  const awayT = g.away.team, homeT = g.home.team;
  const teamName = (side: "away" | "home") => (side === "away" ? awayT.name : homeT.name);
  const shortTeam = (side: "away" | "home") => last(teamName(side));

  // who's who
  const info = new Map<string, PlayerInfo>();
  for (const t of [awayT, homeT]) {
    for (const b of t.batters) info.set(b.id, { ...(info.get(b.id) ?? { name: b.name, team: t }), bat: b });
    for (const p of t.pitchers) info.set(p.id, { ...(info.get(p.id) ?? { name: p.name, team: t }), pitch: p });
  }
  const nm = (id: string) => info.get(id)?.name ?? id;
  // fielders by position, kept current as pitchers change
  const fielders = (box: TeamBox) => new Map(box.batting.filter((b) => b.pos !== "dh").map((b) => [b.pos, b.name]));
  const fieldersBy = { away: fielders(g.away), home: fielders(g.home) };

  const say = (speaker: Announcer, text: string, eventIndex: number, excitement = 0.3, pauseMs = 900) => {
    if (!text) return;
    out.push({ speaker, text, eventIndex, excitement: Math.max(0, Math.min(1, excitement)), pauseMs });
  };
  const pick = <T>(xs: T[]) => xs[Math.floor(rng.next() * xs.length)];
  /** Use the announcer's own line when he has one (most of the time), otherwise the house line. */
  const used = new Set<string>();
  /** Pick a line, avoiding ones already said this game when there's a fresh option. */
  const fresh = (xs: string[]) => {
    const unused = xs.filter((x) => !used.has(x));
    const x = pick(unused.length ? unused : xs);
    used.add(x);
    return x;
  };
  /** Use the announcer's own line when he has one (most of the time), otherwise the house line. */
  const own = (a: Announcer, key: keyof Announcer["phrases"], house: string[]) => {
    const mine = a.phrases[key];
    const always = key === "intro" || key === "final" || key === "walkoff";
    return mine.length && (always || rng.chance(0.75) || !house.length) ? fresh(mine) : fresh(house);
  };
  const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
  const scoreLine = (s: { away: number; home: number }) => {
    if (s.away === s.home) return s.away === 0 ? "no score" : `tied at ${num(s.away)}`;
    const lead: "away" | "home" = s.away > s.home ? "away" : "home";
    const hi = Math.max(s.away, s.home), lo = Math.min(s.away, s.home);
    return `${teamName(lead)} ${num(hi)}, ${teamName(lead === "away" ? "home" : "away")} ${num(lo)}`;
  };

  // ---------------------------------------------------------------- pregame
  const sp = (box: TeamBox) => box.pitching[0];
  say(pbp, own(pbp, "intro", ["Hello again, everybody, and welcome to the broadcast."]), -1, 0.4, 600);
  say(pbp, `Tonight it's the ${awayT.year} ${awayT.name} visiting the ${homeT.year} ${homeT.name}.${awayT.WSWin && homeT.WSWin ? " Two World Series champions." : ""}`, -1, 0.4);
  say(pbp, `On the mound, ${sp(g.away).name} for the ${shortTeam("away")}, and ${sp(g.home).name} for the ${shortTeam("home")}.`, -1, 0.3);
  if (color) {
    say(color, own(color, "intro", ["Great to be here. Should be a fun one."]), -1, 0.3);
    if (awayT.year !== homeT.year) {
      const gap = Math.abs(awayT.year - homeT.year);
      say(color, `${gap} years separate these two clubs. We're playing this one in a ${eraWords(g)} kind of world, about ${g.environment.runsPerGame.toFixed(1)} runs a game.`, -1, 0.3);
    }
  }

  // ---------------------------------------------------------------- the game
  const seenBatter = new Set<string>();
  let prevWp = 0.54;
  let prevScore = { away: 0, home: 0 };
  let halfRuns = 0, halfHits = 0;
  const lastPa = (() => { for (let i = g.events.length - 1; i >= 0; i--) if (g.events[i].kind === "pa") return i; return -1; })();

  g.events.forEach((e: GameEvent, i) => {
    const battingSide: "away" | "home" = e.half === "top" ? "away" : "home";
    const fieldingSide: "away" | "home" = battingSide === "away" ? "home" : "away";
    switch (e.kind) {
      case "inning_start": {
        halfRuns = 0; halfHits = 0;
        if (e.inning === 1 && e.half === "top") { say(pbp, `Here we go. ${teamName("away")} to lead off.`, i, 0.4); break; }
        const situation = e.inning >= 9 && e.half === "bottom" ? ` ${shortTeam("home")} need ${e.score.away - e.score.home + 1 > 0 ? `${num(e.score.away - e.score.home + 1)} to win it` : "just one to walk it off"}.` : "";
        say(pbp, `${e.half === "top" ? "Top" : "Bottom"} of the ${ordinal(e.inning)}. ${cap(scoreLine(e.score))}.${situation}`, i, e.inning >= 8 ? 0.5 : 0.3, 700);
        break;
      }
      case "pitching_change": {
        const p = info.get(e.player ?? "");
        let text = `There's a pitching change. ${p?.name ?? "A new pitcher"} is coming in.`;
        say(pbp, text, i, 0.35);
        if (color && p?.pitch && rng.chance(0.5 + color.chattiness * 0.5)) {
          const ps = p.pitch;
          const era = ps.IPOuts ? (27 * n0(ps.ER)) / ps.IPOuts : 0;
          text = n0(ps.SV) >= 10 ? `${last(p.name)} saved ${ps.SV} games that year. This is his kind of spot.`
            : `${last(p.name)} went ${n0(ps.W)} and ${n0(ps.L)} with a ${era.toFixed(2)} ERA in ${p.team.year}.`;
          say(color, text, i, 0.3);
        }
        break;
      }
      case "steal": say(pbp, `${nm(e.player ?? "")} takes off... and he's in there, stolen base!`, i, 0.5); break;
      case "caught": say(pbp, `${nm(e.player ?? "")} is running... and he's out! Thrown out stealing.`, i, 0.5); break;
      case "wildpitch": say(pbp, `That one gets away, it's a wild pitch!${e.text.includes("run scores") ? " A run comes in." : " The runners move up."}`, i, 0.5); break;
      case "ghost_runner": say(pbp, `Extra innings, so ${nm(e.player ?? "")} starts the inning on second base.`, i, 0.4); break;
      case "game_end": break;
      case "pa": {
        const pa = e as PlayEvent;
        const batter = nm(pa.batter), pitcher = nm(pa.pitcher);
        const swing = pa.homeWinProb - prevWp; // + good for home
        prevWp = pa.homeWinProb;
        const forBatting = battingSide === "home" ? swing : -swing;
        const leverage = Math.abs(swing);
        const isWalkoff = i === lastPa && pa.half === "bottom" && pa.inning >= 9 && g.winner === "home" && pa.scored.length > 0;
        const fullFielder = pa.fielder === 1 ? pitcher : pa.fielder ? fieldersBy[fieldingSide].get(NUM_TO_POS[pa.fielder]) : undefined;
        const fielderName = fullFielder ? last(fullFielder) : undefined;
        const vars = {
          batter, batterLast: last(batter), pitcher, pitcherLast: last(pitcher),
          fielder: fielderName ?? "the fielder", field: FIELD[pa.fielder ?? 8] || "the outfield",
          team: teamName(battingSide), otherTeam: teamName(fieldingSide), runs: num(pa.scored.length),
          score: scoreLine(pa.score), inning: ordinal(pa.inning), outs: num(pa.outsAfter), me: pbp.name,
        };

        // color: introduce a batter the first time up, sometimes
        if (color && !seenBatter.has(pa.batter) && rng.chance(0.15 + color.chattiness * 0.35)) {
          const b = info.get(pa.batter)?.bat;
          const intro = b ? batterNote(b, info.get(pa.batter)!.team) : null;
          if (intro) say(color, intro, i, 0.25, 700);
        }
        seenBatter.add(pa.batter);

        // situation setup, now and then, in tight spots
        const onBase = pa.basesBefore.filter(Boolean).length;
        if (leverage > 0.06 || (onBase >= 2 && rng.chance(pbp.chattiness * 0.6))) {
          const runners = runnersText(pa.basesBefore);
          say(pbp, `${runners ? cap(runners) + ", " : ""}${num(pa.outsBefore)} out${pa.outsBefore === 1 ? "" : "s"}, and here's ${batter}.`, i, 0.45, 500);
        }

        // the call
        const base = { HR: 0.8, "3B": 0.6, "2B": 0.5, "1B": 0.35, ROE: 0.35, BB: 0.2, HBP: 0.25, SO: 0.3, OUT: 0.2 }[pa.result];
        const exc = Math.min(1, base * (0.6 + 0.8 * pbp.excitement) + leverage * 2 * pbp.excitement);
        let call = callPlay(pa, vars, fielderName);
        if (pa.result === "HR") call = fill(leverage >= 0.12 ? own(pbp, "bigHomeRun", HOUSE.bigHomeRun) : own(pbp, "homeRun", HOUSE.homeRun), vars) + (pa.scored.length === 4 ? " A grand slam!" : pa.scored.length > 1 ? ` That's ${num(pa.scored.length)} runs in.` : "");
        else if (pa.result === "SO" && (pbp.phrases.strikeout.length && rng.chance(0.35))) call = fill(pick(pbp.phrases.strikeout), vars);
        else if (pa.doublePlay && pbp.phrases.doublePlay.length && rng.chance(0.6)) call = `${call} ${fill(pick(pbp.phrases.doublePlay), vars)}`;
        if (isWalkoff) call += " " + fill(own(pbp, "walkoff", HOUSE.walkoff), vars);
        else if (pa.scored.length && pa.result !== "HR" && leverage >= 0.1) call += " " + fill(own(pbp, "bigHit", HOUSE.bigHit), vars);
        say(pbp, call, i, exc, 600 + exc * 900);

        // homer announcers react to their team's fortunes
        if (pbp.homer && leverage >= 0.07) {
          const good = pbp.homer === battingSide ? forBatting > 0 : forBatting < 0;
          say(pbp, good ? pick(["Yes! That's what we needed!", "Oh, I love it!", "Now we're talking!"]) : pick(["Oh, brother.", "Ugh. That one hurts.", "You've got to be kidding me."]), i, good ? 0.8 : 0.3, 500);
        }

        // score update after runs
        if (pa.scored.length && !isWalkoff) say(pbp, `${cap(scoreLine(pa.score))}.`, i, 0.4, 600);
        if (["1B", "2B", "3B", "HR"].includes(pa.result)) halfHits++;
        halfRuns += pa.scored.length;

        // color analyst chimes in
        if (color && !isWalkoff) {
          const p = 0.08 + color.chattiness * 0.22 + (leverage > 0.1 ? 0.3 : 0) + (pa.result === "HR" ? 0.25 : 0);
          if (rng.chance(p)) {
            const remark = colorRemark(pa, info, color, rng, used);
            if (remark) say(color, fill(remark, vars), i, 0.3 + leverage * color.excitement, 900);
          }
        }

        // end of half inning wrap
        if (pa.outsAfter >= 3 && i !== lastPa) {
          const lob = pa.basesAfter.filter(Boolean).length;
          const wrap = halfRuns
            ? `${cap(num(halfRuns))} run${halfRuns > 1 ? "s" : ""}, ${num(halfHits)} hit${halfHits === 1 ? "" : "s"}${lob ? `, ${num(lob)} left on` : ""}.`
            : `No runs${halfHits ? `, ${num(halfHits)} hit${halfHits === 1 ? "" : "s"}` : ""}${lob ? `, ${num(lob)} left on base` : ""}.`;
          if (halfRuns || lob || rng.chance(pbp.chattiness)) say(pbp, wrap, i, 0.25, 1200);
        }
        prevScore = pa.score;
        break;
      }
    }
  });

  // ---------------------------------------------------------------- postgame
  const winSide = g.winner;
  say(pbp, `And that's the final: ${scoreLine(prevScore.away === g.away.R && prevScore.home === g.home.R ? prevScore : { away: g.away.R, home: g.home.R })}.`, g.events.length - 1, 0.5);
  const winP = [...g.away.pitching, ...g.home.pitching].find((p) => p.decision === "W");
  const saveP = [...g.away.pitching, ...g.home.pitching].find((p) => p.decision === "S");
  if (winP) say(pbp, `${winP.name} gets the win${saveP ? `, ${saveP.name} with the save` : ""}.`, g.events.length - 1, 0.3);
  if (pbp.homer) say(pbp, pbp.homer === winSide ? "What a night to be a fan of this ballclub!" : "We'll get 'em next time. We always do.", g.events.length - 1, 0.5);
  if (color) {
    const star = starOfGame(g);
    if (star) say(color, star, g.events.length - 1, 0.35);
  }
  say(pbp, own(pbp, "final", ["Thanks for listening, everybody. Good night."]), g.events.length - 1, 0.3, 0);
  return out;
}

// ------------------------------------------------------------------ house lines

const HOUSE = {
  homeRun: ["{batterLast} hits a high fly ball to {field}... it's way back... gone! Home run!", "{batter} swings and drives one deep to {field}, and that one's out of here!"],
  bigHomeRun: ["{batter} swings, there's a long drive to {field}... it's gone! What a moment!", "Oh, he crushed it! {batter} with a huge home run!"],
  walkoff: ["And the {team} win it! A walk-off for the {team}!"],
  bigHit: ["Big hit for the {team}!"],
};

function callPlay(pa: PlayEvent, v: Record<string, string>, fielder?: string): string {
  const who = fielder ? `${fielder}` : "the fielder";
  const scorers = pa.scored.length;
  const scoring = scorers ? ` ${scorers === 1 ? "One run scores" : `${cap(v.runs)} runs score`}.` : "";
  switch (pa.result) {
    case "SO": return pickFrom(pa, [`${v.pitcherLast} gets ${v.batterLast} swinging. Strike three.`, `Called strike three on ${v.batterLast}.`, `${v.batterLast} goes down on strikes.`]);
    case "BB": return pickFrom(pa, [`Ball four, ${v.batterLast} draws a walk.`, `${v.pitcherLast} misses high, and ${v.batterLast} takes his base.`]) + scoring;
    case "HBP": return `Oh, that one got him. ${v.batterLast} is hit by the pitch and takes first.${scoring}`;
    case "1B": return pickFrom(pa, [`${v.batterLast} lines a base hit into ${v.field}.`, `A ground ball through the hole, base hit for ${v.batterLast}.`, `${v.batterLast} loops one into ${v.field} for a single.`]) + scoring;
    case "2B": return pickFrom(pa, [`${v.batterLast} drives one into the gap in ${v.field}! He'll go into second with a double.`, `Into the corner in ${v.field}, and ${v.batterLast} is in with a double.`]) + scoring;
    case "3B": return `${v.batterLast} rips one into ${v.field}, it rolls to the wall, he's around second, he's going for three... and he's in there! A triple!${scoring}`;
    case "ROE": return `A grounder to ${who}... and it's booted! ${v.batterLast} is safe on the error.${scoring}`;
    default: {
      if (pa.doublePlay) return pa.battedBall === "LD" ? `Lined right at ${who}, and the runner's doubled off! Double play.` : `A ground ball to ${who}, over to second for one, on to first... double play!${scoring}`;
      if (pa.fieldersChoice) return `A grounder to ${who}, they get the force at second, but ${v.batterLast} is safe at first.${scoring}`;
      if (pa.sacFly) return `A fly ball to ${who} in ${v.field}, deep enough, and the runner tags and scores. Sacrifice fly.`;
      const outs = pa.outsAfter >= 3 ? " And that will end the inning." : "";
      if (pa.battedBall === "GB") return pa.fielder === 3 ? `${v.batterLast} grounds to first, ${who} takes it himself and steps on the bag.${scoring}${outs}` : `${v.batterLast} hits a ground ball to ${who}, and he throws him out.${scoring}${outs}`;
      if (pa.battedBall === "LD") return `${v.batterLast} lines one... right at ${who}.${pa.outsAfter === 1 ? " One away." : pa.outsAfter === 2 ? " Two down." : ""}${outs}`;
      return (pa.fielder ?? 9) >= 7 ? `${v.batterLast} lifts a fly ball to ${v.field}, and ${who} puts it away.${scoring}${outs}` : `A pop-up, and ${who} has it.${outs}`;
    }
  }
}

function pickFrom(pa: PlayEvent, xs: string[]): string {
  // deterministic variety without needing the rng: vary by inning and batter
  let h = pa.inning * 31 + pa.outsBefore * 7;
  for (const c of pa.batter) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return xs[h % xs.length];
}

function runnersText(b: (string | null)[]): string {
  const [f, s, t] = b.map(Boolean);
  if (f && s && t) return "bases loaded";
  if (s && t) return "runners at second and third";
  if (f && t) return "runners at the corners";
  if (f && s) return "two on, at first and second";
  if (t) return "a runner at third";
  if (s) return "a runner in scoring position at second";
  if (f) return "a runner at first";
  return "";
}

function batterNote(b: RawBatter, t: RawTeam): string | null {
  const ab = n0(b.AB);
  if (ab < 50) return null;
  const avg = n0(b.H) / ab;
  const avgTxt = avg.toFixed(3).replace(/^0/, "");
  const hr = n0(b.HR), sb = n0(b.SB), rbi = n0(b.RBI);
  if (hr >= 30) return `${b.name} hit ${hr} home runs with ${rbi} RBIs for the ${t.year} club. Pitch him carefully.`;
  if (avg >= 0.33) return `${b.name} hit ${avgTxt} that year. One of the toughest outs in the league.`;
  if (sb >= 40) return `${b.name} stole ${sb} bases in ${t.year}. If he gets on, watch him go.`;
  if (hr >= 20) return `${b.name}: ${avgTxt} with ${hr} homers in ${t.year}.`;
  return `${b.name} hit ${avgTxt} in ${t.year}.`;
}

function colorRemark(pa: PlayEvent, info: Map<string, PlayerInfo>, color: Announcer, rng: Rng, usedFiller: Set<string>): string | null {
  const b = info.get(pa.batter);
  const p = info.get(pa.pitcher);
  if (pa.result === "HR" && b?.bat) {
    const hr = n0(b.bat.HR);
    return hr >= 40 ? `That's what he does. ${hr} homers in ${b.team.year}, and you just saw why.` : hr <= 5 ? `Now that is a surprise. He only hit ${hr} all season in ${b.team.year}!` : `That's number ${hr + 1}, if we're counting his ${b.team.year} season.`;
  }
  if (pa.result === "SO" && p?.pitch && n0(p.pitch.SO) >= 200) return `${last(p.name)} struck out ${p.pitch.SO} that year. He makes good hitters look silly.`;
  if (pa.result === "SO" && b?.bat && b.team.year < p!.team.year - 40) return "You can see it, he hasn't seen velocity like that. That's the time machine at work.";
  if (pa.doublePlay) return "That's the pitcher's best friend right there.";
  if (pa.result === "BB" && pa.basesBefore.every(Boolean)) return "You can't walk in a run there. You just can't.";
  const filler = color.phrases.filler.filter((f) => !usedFiller.has(f));
  if (filler.length && rng.chance(0.5)) { const f = filler[Math.floor(rng.next() * filler.length)]; usedFiller.add(f); return f; }
  return null;
}

function starOfGame(g: GameResult): string | null {
  let best: { name: string; score: number; line: string } | null = null;
  for (const t of [g.away, g.home]) {
    for (const b of t.batting) {
      const score = b.H + b.HR * 2 + b.RBI + b.R * 0.5;
      if (!best || score > best.score) best = { name: b.name, score, line: `${num(b.H)} for ${num(b.AB)}${b.HR ? `, ${b.HR > 1 ? num(b.HR) + " homers" : "a homer"}` : ""}${b.RBI ? `, ${num(b.RBI)} driven in` : ""}` };
    }
    for (const p of t.pitching) {
      const score = p.outs / 3 + p.SO * 0.5 - p.R * 2;
      if (p.outs >= 21 && (!best || score > best.score)) best = { name: p.name, score, line: `${num(Math.floor(p.outs / 3))} innings, ${num(p.R)} run${p.R === 1 ? "" : "s"}, ${num(p.SO)} strikeouts` };
    }
  }
  return best && best.score >= 3 ? `My star of the game: ${best.name}. ${cap(best.line)}.` : null;
}

function eraWords(g: GameResult): string {
  const r = g.environment.rates;
  if (r.HR < 0.008) return "dead-ball";
  if (r.SO > 0.19) return "high-strikeout, swing-for-the-fences";
  if (g.environment.runsPerGame > 5) return "high-scoring";
  if (g.environment.runsPerGame < 3.8) return "pitcher-friendly";
  return "middle-of-the-road";
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
