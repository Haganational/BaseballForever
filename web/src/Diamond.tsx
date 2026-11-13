import { useEffect, useRef, useState } from "react";
import type { PlayEvent } from "../../src/game";

/**
 * An animated replay of one plate appearance on a little ballpark, drawn in SVG.
 * Everything comes from the play's real event data: where the ball went (fielder / field),
 * who was on base before and after, who scored, who was thrown out.
 * The big moments get a gag on top: fireworks, a giant K, a walk-off party.
 */

type Pt = [number, number];
const HOME: Pt = [200, 330];
const BASES: Pt[] = [[275, 255], [200, 180], [125, 255], HOME]; // 1B, 2B, 3B, home
const MOUND: Pt = [200, 262];
// where each fielder stands (scorer's numbers 1-9)
const FIELDERS: Record<number, Pt> = {
  1: MOUND, 2: [200, 350], 3: [268, 238], 4: [238, 196], 5: [134, 232], 6: [164, 196], 7: [96, 132], 8: [200, 82], 9: [304, 132],
};
const FENCE_R = 300; // distance from home to the wall
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

/** Point at distance d from home along the direction toward field position f (7 left, 8 center, 9 right). */
function toward(f: number | undefined, d: number, jitter = 0): Pt {
  const angle = ({ 7: -0.62, 8: 0, 9: 0.62 }[f ?? 8] ?? 0) + jitter; // radians off dead center
  return [HOME[0] + Math.sin(angle) * d, HOME[1] - Math.cos(angle) * d];
}

/** Path a runner takes from base index a to base index b (0 = home before batting, 1..3 bases, 4 = scored). */
function runnerPath(from: number, to: number): Pt[] {
  const stops: Pt[] = [HOME, BASES[0], BASES[1], BASES[2], HOME];
  const pts: Pt[] = [];
  for (let i = from; i <= to; i++) pts.push(stops[i]);
  return pts.length ? pts : [stops[from]];
}
function along(path: Pt[], t: number): Pt {
  if (path.length === 1) return path[0];
  const legs = path.length - 1;
  const x = clamp01(t) * legs;
  const i = Math.min(legs - 1, Math.floor(x));
  return lerp(path[i], path[i + 1], x - i);
}

interface Runner { id: string; from: number; to: number; out: boolean; label: string }

function plan(e: PlayEvent, names: Map<string, string>): Runner[] {
  const runners: Runner[] = [];
  const short = (id: string) => (names.get(id) ?? id).split(" ").slice(-1)[0];
  const destOf = (id: string) => {
    if (e.scored.includes(id)) return 4;
    const i = e.basesAfter.indexOf(id);
    return i >= 0 ? i + 1 : -1;
  };
  e.basesBefore.forEach((id, i) => {
    if (!id) return;
    const to = destOf(id);
    const out = e.outOnBases.includes(id) || to === -1;
    runners.push({ id, from: i + 1, to: out ? Math.min(4, i + 2) : to, out, label: short(id) });
  });
  const bTo = destOf(e.batter);
  const batterOut = bTo === -1;
  runners.push({ id: e.batter, from: 0, to: batterOut ? (e.result === "SO" ? 0 : 1) : bTo, out: batterOut, label: short(e.batter) });
  return runners;
}

export function Diamond(props: {
  event: PlayEvent | null;
  names: Map<string, string>;
  caption?: string;
  walkoff?: boolean;
  /** milliseconds for the whole replay */
  duration?: number;
  /** change this to replay the same play again */
  replayKey?: number;
  compact?: boolean;
}) {
  const { event: e, names, caption, walkoff, compact } = props;
  const duration = props.duration ?? (e?.result === "HR" || walkoff ? 4200 : 2600);
  const [t, setT] = useState(1);
  const raf = useRef(0);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!e) return;
    if (reduced) { setT(1); return; }
    const start = performance.now();
    const tick = (now: number) => {
      const x = clamp01((now - start) / duration);
      setT(x);
      if (x < 1) raf.current = requestAnimationFrame(tick);
    };
    setT(0);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [e, props.replayKey, duration, reduced]);

  if (!e) {
    return <svg className={`diamond ${compact ? "compact" : ""}`} viewBox="0 0 400 380" role="img" aria-label="Ballpark"><Field /></svg>;
  }

  const runners = plan(e, names);
  const r = e.result;
  const isHit = r === "1B" || r === "2B" || r === "3B" || r === "HR";
  const inPlay = r !== "SO" && r !== "BB" && r !== "HBP";

  // ---- the ball
  const pitchT = seg(t, 0, 0.14);
  let ball: Pt = lerp(MOUND, HOME, ease(pitchT));
  let ballLift = 0; // how high the ball is (drawn as a bigger ball + offset shadow)
  let throwLine: Pt[] | null = null;
  if (inPlay && t > 0.14) {
    const flyT = seg(t, 0.14, r === "HR" ? 0.6 : 0.45);
    let land: Pt;
    if (r === "HR") land = toward(e.fielder, FENCE_R + 60, 0.08);
    else if (r === "3B") land = toward(e.fielder, FENCE_R - 12, 0.25);
    else if (r === "2B") land = toward(e.fielder, FENCE_R - 40, -0.2);
    else if (r === "1B") land = toward(e.fielder, 190, 0.15);
    else land = FIELDERS[e.fielder ?? 6];
    const lofted = r === "HR" || r === "3B" || r === "2B" || e.battedBall === "FB" || e.sacFly;
    ball = lerp(HOME, land, lofted ? flyT : ease(flyT));
    ballLift = lofted ? Math.sin(Math.PI * flyT) * (r === "HR" ? 70 : e.battedBall === "FB" && (e.fielder ?? 9) <= 6 ? 60 : 38) : 0;
    // the fielder throws it in (not on homers)
    if (r !== "HR" && t > (lofted ? 0.45 : 0.45)) {
      const tt = seg(t, 0.5, 0.75);
      const target = e.doublePlay ? (tt < 0.5 ? BASES[1] : BASES[0]) : isHit ? BASES[r === "1B" ? 1 : r === "2B" ? 2 : 2] : BASES[0];
      if (e.doublePlay && e.battedBall !== "LD") {
        ball = tt < 0.5 ? lerp(land, BASES[1], tt * 2) : lerp(BASES[1], BASES[0], (tt - 0.5) * 2);
        throwLine = [land, BASES[1], BASES[0]];
      } else if (!(e.battedBall === "FB" || e.battedBall === "LD") || isHit) {
        ball = lerp(land, target, ease(tt));
      } else ball = land;
    }
  }

  // ---- fielder chasing the ball
  const chaser = inPlay && e.fielder ? e.fielder : 0;

  // ---- runners: they start moving when the ball is put in play (or on ball four)
  const runStart = inPlay ? 0.2 : 0.18;
  const runEnd = r === "HR" ? 0.98 : 0.85;

  // ---- gags
  const showK = r === "SO" && t > 0.18;
  const fireworks = r === "HR" && t > 0.55;
  const bannerText = walkoff ? "WALK-OFF!" : r === "HR" ? (e.scored.length === 4 ? "GRAND SLAM!" : "GONE!") : e.doublePlay ? "TURN TWO!" : r === "3B" ? "TRIPLE!" : r === "ROE" ? "OOPS!" : null;
  const showBanner = bannerText && t > (r === "HR" ? 0.58 : 0.5);

  return (
    <figure className={`diamond-wrap ${compact ? "compact" : ""}`}>
      <svg className="diamond" viewBox="0 0 400 380" role="img" aria-label={caption ?? "Play replay"}>
        <Field />
        {/* fielders */}
        {Object.entries(FIELDERS).map(([n, p]) => {
          const num = Number(n);
          let pos = p;
          if (num === chaser && t > 0.18 && r !== "HR") {
            const target = r === "1B" ? toward(e.fielder, 190, 0.15) : r === "2B" ? toward(e.fielder, FENCE_R - 40, -0.2) : r === "3B" ? toward(e.fielder, FENCE_R - 12, 0.25) : p;
            pos = lerp(p, target, ease(seg(t, 0.18, 0.48)));
          }
          return <circle key={n} cx={pos[0]} cy={pos[1]} r={6} className="fielder" />;
        })}
        {throwLine && <polyline points={throwLine.map((p) => p.join(",")).join(" ")} className="throw" />}
        {/* runners */}
        {runners.map((rn) => {
          const k = seg(t, runStart, runEnd);
          const path = runnerPath(rn.from, rn.to);
          const at = along(path, ease(k));
          const scored = rn.to === 4 && !rn.out && k >= 1;
          const outFade = rn.out && k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
          // runners who score wave and step off the plate
          const homeFade = rn.to === 4 && !rn.out ? 1 - seg(t, runEnd, Math.min(1, runEnd + 0.12)) : 1;
          if (rn.from === 0 && rn.to === 0) return null; // struck out: stays at the plate
          return (
            <g key={rn.id} opacity={rn.to === 4 && !rn.out ? homeFade : Math.max(0.15, outFade)} className={scored ? "scored" : ""}>
              <circle cx={at[0]} cy={at[1]} r={7.5} className={rn.from === 0 ? "batter" : "runner"} />
              <text x={at[0]} y={at[1] - 11} className="runner-label">{rn.label}{rn.out && k > 0.7 ? " OUT" : ""}</text>
            </g>
          );
        })}
        {/* ball and its shadow */}
        <circle cx={ball[0]} cy={ball[1]} r={2.6} className="ball-shadow" opacity={ballLift ? 0.35 : 0} />
        <circle cx={ball[0]} cy={ball[1] - ballLift} r={3.6 + ballLift / 22} className="ball" opacity={r === "HR" && t > 0.62 ? 0 : 1} />
        {/* gags */}
        {showK && <text x={200} y={210} className={`gag-k ${pick(e) ? "backwards" : ""}`} style={{ opacity: Math.min(1, (t - 0.18) * 4) }}>K</text>}
        {fireworks && <Fireworks t={seg(t, 0.55, 1)} origin={toward(e.fielder, FENCE_R + 20)} />}
        {walkoff && t > 0.6 && <Fireworks t={seg(t, 0.6, 1)} origin={[200, 200]} confetti />}
        {showBanner && <text x={200} y={58} className="gag-banner" style={{ fontSize: 34 + 8 * Math.sin(Math.min(1, (t - 0.5) * 3) * Math.PI) }}>{bannerText}</text>}
        {e.scored.length > 0 && t > runEnd && <text x={200} y={372} className="gag-runs">+{e.scored.length} run{e.scored.length > 1 ? "s" : ""}</text>}
      </svg>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

/** Called vs. swinging strikeout gets the scorer's backwards K about a third of the time. */
function pick(e: PlayEvent) {
  return (e.inning * 7 + e.outsBefore + e.batter.length) % 3 === 0;
}

function Field() {
  // fair territory wedge, outfield grass, infield dirt, bases
  const left = toward(7, FENCE_R, -0.17), right = toward(9, FENCE_R, 0.17);
  return (
    <g>
      <rect x={0} y={0} width={400} height={380} className="stands" />
      <path d={`M ${HOME[0]} ${HOME[1]} L ${left[0]} ${left[1]} A ${FENCE_R} ${FENCE_R} 0 0 1 ${right[0]} ${right[1]} Z`} className="grass" />
      <path d={`M ${left[0]} ${left[1]} A ${FENCE_R} ${FENCE_R} 0 0 1 ${right[0]} ${right[1]}`} className="wall" />
      <path d={`M ${HOME[0]} ${HOME[1] + 6} L ${BASES[0][0] + 14} ${BASES[0][1]} Q ${BASES[1][0]} ${BASES[1][1] - 52} ${BASES[2][0] - 14} ${BASES[2][1]} Z`} className="dirt" />
      <polygon points={[HOME, BASES[0], BASES[1], BASES[2]].map((p) => p.join(",")).join(" ")} className="infield-grass" />
      <circle cx={MOUND[0]} cy={MOUND[1]} r={9} className="dirt" />
      {BASES.slice(0, 3).map((b, i) => <rect key={i} x={b[0] - 5} y={b[1] - 5} width={10} height={10} transform={`rotate(45 ${b[0]} ${b[1]})`} className="base" />)}
      <polygon points={`${HOME[0] - 6},${HOME[1] - 4} ${HOME[0] + 6},${HOME[1] - 4} ${HOME[0] + 6},${HOME[1] + 2} ${HOME[0]},${HOME[1] + 7} ${HOME[0] - 6},${HOME[1] + 2}`} className="base" />
    </g>
  );
}

function Fireworks({ t, origin, confetti }: { t: number; origin: Pt; confetti?: boolean }) {
  const bursts = confetti ? 5 : 3;
  const parts: JSX.Element[] = [];
  for (let b = 0; b < bursts; b++) {
    const bt = clamp01(t * 1.4 - b * 0.18);
    if (bt <= 0) continue;
    const cx = origin[0] + (b - (bursts - 1) / 2) * (confetti ? 60 : 45);
    const cy = origin[1] - 30 - (b % 2) * 25;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + b;
      const d = 8 + 42 * Math.sqrt(bt);
      parts.push(
        <circle key={`${b}-${i}`} cx={cx + Math.cos(a) * d} cy={cy + Math.sin(a) * d + (confetti ? bt * 40 : bt * 12)} r={confetti ? 3 : 2.4}
          className={`spark s${(i + b) % 4}`} opacity={1 - bt} />,
      );
    }
  }
  return <g>{parts}</g>;
}
