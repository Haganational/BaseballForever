import { useEffect, useState } from "react";
import { Diamond } from "./Diamond";
import { describe, type KeyPlay } from "./describe";

/** Key plays of the game, each with an animated replay, plus a highlight reel that plays them all. */
export function Highlights({ plays, names }: { plays: KeyPlay[]; names: Map<string, string> }) {
  const [sel, setSel] = useState(0);
  const [replay, setReplay] = useState(0);
  const [reel, setReel] = useState(false);
  const cur = plays[Math.min(sel, plays.length - 1)];
  const dur = cur && (cur.event.result === "HR" || cur.walkoff) ? 4200 : 2600;

  useEffect(() => { setSel(0); setReel(false); }, [plays]);
  // highlight reel: advance after each replay finishes (plus a beat to read the caption)
  useEffect(() => {
    if (!reel) return;
    const id = window.setTimeout(() => {
      if (sel + 1 < plays.length) { setSel(sel + 1); setReplay((r) => r + 1); } else setReel(false);
    }, dur + 1400);
    return () => clearTimeout(id);
  }, [reel, sel, replay, dur, plays.length]);

  if (!cur) return null;
  const caption = `${cur.event.half === "top" ? "▲" : "▼"}${cur.event.inning}: ${describe(cur.event, names)}`;
  return (
    <section className="card highlights">
      <div className="radio-head">
        <h2>🎬 Key plays</h2>
        <button className={reel ? "" : "primary"} onClick={() => { if (reel) setReel(false); else { setSel(0); setReplay((r) => r + 1); setReel(true); } }}>
          {reel ? "⏹ Stop reel" : "▶ Play highlight reel"}
        </button>
      </div>
      <div className="hl-grid">
        <Diamond event={cur.event} names={names} caption={caption} walkoff={cur.walkoff} replayKey={replay} duration={dur} />
        <ol className="plays">
          {plays.map((k, i) => (
            <li key={k.index} className={i === sel ? "active" : ""}>
              <button className="play-btn" onClick={() => { setReel(false); setSel(i); setReplay((r) => r + 1); }} aria-label="Replay this play">▶</button>
              <span className="tag">{k.event.half === "top" ? "▲" : "▼"}{k.event.inning}</span> {describe(k.event, names)}
              <span className="muted"> {k.walkoff ? "(walk-off)" : `(${k.swing > 0 ? "+" : ""}${Math.round(k.swing * 100)}% home win chance)`}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
