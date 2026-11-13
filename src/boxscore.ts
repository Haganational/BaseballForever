import type { GameResult, TeamBox, PitchLine } from "./game.js";

const pad = (s: string | number, n: number) => String(s).padStart(n);
const padR = (s: string | number, n: number) => String(s).padEnd(n);
const ip = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;

export function renderBoxScore(g: GameResult): string {
  const out: string[] = [];
  const innings = Math.max(g.away.lineScore.length, g.home.lineScore.length, 9);
  const nameW = Math.max(g.away.team.name.length, g.home.team.name.length) + 6;
  const header = padR("", nameW) + Array.from({ length: innings }, (_, i) => pad(i + 1, 3)).join("") + "   R  H  E";
  out.push(header);
  for (const t of [g.away, g.home]) {
    const cells = Array.from({ length: innings }, (_, i) => {
      const v = t.lineScore[i];
      return pad(v === undefined ? "" : Number.isNaN(v) ? "x" : v, 3);
    }).join("");
    out.push(padR(`${t.team.year} ${t.team.name}`, nameW) + cells + pad(t.R, 4) + pad(t.H, 3) + pad(t.E, 3));
  }
  out.push("");
  for (const t of [g.away, g.home]) out.push(...batting(t), "");
  for (const t of [g.away, g.home]) out.push(...pitching(t), "");
  const k = g.knobs;
  out.push(`World: ${g.environment.label} (about ${g.environment.runsPerGame.toFixed(2)} runs per team per game)`);
  out.push(`Era mode: ${k.eraMode}, talent spread adjust ${k.spreadAdjust}, park ${k.park}, ball ${k.ball}, mound ${k.mound}, DH ${k.dh}, bullpen ${k.bullpen}, seed ${k.seed}`);
  return out.join("\n");
}

function batting(t: TeamBox): string[] {
  const rows = [`${padR(t.team.name, 26)}  AB  R  H RBI BB SO  HR`];
  for (const b of t.batting.filter((b, i) => i < 9 || b.AB + b.BB + b.HBP > 0)) {
    rows.push(`${padR(`${b.name}, ${b.pos}`, 26)}${pad(b.AB, 4)}${pad(b.R, 3)}${pad(b.H, 3)}${pad(b.RBI, 4)}${pad(b.BB, 3)}${pad(b.SO, 3)}${pad(b.HR, 4)}`);
  }
  const extra: string[] = [];
  const list = (label: string, f: (b: (typeof t.batting)[number]) => number) => {
    const xs = t.batting.filter((b) => f(b) > 0).map((b) => `${b.name}${f(b) > 1 ? " " + f(b) : ""}`);
    if (xs.length) extra.push(`${label}: ${xs.join(", ")}`);
  };
  list("2B", (b) => b["2B"]);
  list("3B", (b) => b["3B"]);
  list("HR", (b) => b.HR);
  list("SB", (b) => b.SB);
  list("HBP", (b) => b.HBP);
  rows.push(...extra.map((x) => "  " + x), `  LOB: ${t.LOB}`);
  return rows;
}

function pitching(t: TeamBox): string[] {
  const rows = [`${padR(t.team.name, 26)}   IP  H  R ER BB SO HR`];
  for (const p of t.pitching as PitchLine[]) {
    const nm = p.decision ? `${p.name} (${p.decision})` : p.name;
    rows.push(`${padR(nm, 26)}${pad(ip(p.outs), 5)}${pad(p.H, 3)}${pad(p.R, 3)}${pad(p.ER, 3)}${pad(p.BB, 3)}${pad(p.SO, 3)}${pad(p.HR, 3)}`);
  }
  return rows;
}
