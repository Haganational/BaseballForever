import type { GameEvent, GameResult, PlayEvent } from "../../src/game";

// Plain play-by-play text. This is a placeholder voice: step 3 replaces it with the radio
// commentary and swappable announcer profiles, built from the same event log.

const FIELDER = ["", "pitcher", "catcher", "first baseman", "second baseman", "third baseman", "shortstop", "left fielder", "center fielder", "right fielder"];
const FIELD = ["", "", "", "", "", "", "", "left field", "center field", "right field"];

export function nameMap(g: GameResult): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of [g.away, g.home]) {
    for (const b of t.batting) m.set(b.id, b.name);
    for (const p of t.pitching) m.set(p.id, p.name);
  }
  return m;
}

export function describe(e: GameEvent, names: Map<string, string>): string {
  if (e.kind !== "pa") return e.text;
  const b = names.get(e.batter) ?? e.batter;
  const nm = (id: string) => names.get(id) ?? id;
  const f = e.fielder ?? 0;
  let s: string;
  switch (e.result) {
    case "SO": s = `${b} strikes out`; break;
    case "BB": s = `${b} walks`; break;
    case "HBP": s = `${b} is hit by the pitch`; break;
    case "HR": s = e.scored.length === 4 ? `GRAND SLAM! ${b} homers to ${FIELD[f]}` : `${b} homers to ${FIELD[f]}`; break;
    case "3B": s = `${b} triples to ${FIELD[f]}`; break;
    case "2B": s = `${b} doubles to ${FIELD[f]}`; break;
    case "1B": s = `${b} singles to ${FIELD[f]}`; break;
    case "ROE": s = `${b} reaches on an error by the ${FIELDER[f]}`; break;
    default: {
      const kind = e.battedBall === "GB" ? "grounds" : e.battedBall === "LD" ? "lines" : f <= 6 ? "pops" : "flies";
      if (e.doublePlay) s = `${b} ${kind} into a double play`;
      else if (e.fieldersChoice) s = `${b} reaches on a fielder's choice, ${nm(e.outOnBases[0])} forced out`;
      else if (e.sacFly) s = `${b} hits a sacrifice fly to ${FIELD[f]}`;
      else s = `${b} ${kind} out to the ${FIELDER[f]}`;
    }
  }
  if (e.error) s += ", and an error lets the runners move up";
  if (e.scored.length && e.result !== "HR") s += `. ${e.scored.map(nm).join(" and ")} ${e.scored.length > 1 ? "score" : "scores"}`;
  return s + ".";
}

/** Plays that swung the win probability the most: candidates for animations in step 4. */
export function keyPlays(g: GameResult, howMany = 5): { event: PlayEvent; swing: number }[] {
  let prev = 0.54;
  const out: { event: PlayEvent; swing: number }[] = [];
  for (const e of g.events) {
    if (e.kind !== "pa") continue;
    const swing = e.homeWinProb - prev;
    prev = e.homeWinProb;
    out.push({ event: e, swing });
  }
  return out.sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing)).slice(0, howMany).filter((x) => Math.abs(x.swing) >= 0.08);
}
