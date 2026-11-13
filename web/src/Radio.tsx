import { useEffect, useMemo, useRef, useState } from "react";
import type { Announcer } from "../../src/commentary/announcers";
import { generateBroadcast } from "../../src/commentary/broadcast";
import type { GameResult } from "../../src/game";
import { canSpeak, hush, soundCheck, speak, useVoices } from "./announcerStore";
import { Diamond } from "./Diamond";
import { nameMap, walkoffIndex } from "./describe";
import type { PlayEvent } from "../../src/game";

type Mode = "idle" | "playing" | "paused" | "done";

export function Radio({ g, announcers, onEditAnnouncers }: { g: GameResult; announcers: Announcer[]; onEditAnnouncers: () => void }) {
  const pbps = announcers.filter((a) => a.role === "pbp");
  const colors = announcers.filter((a) => a.role === "color");
  const [pbpId, setPbpId] = useState(pbps[0]?.id ?? "");
  const [colorId, setColorId] = useState(colors[0]?.id ?? "none");
  const [voiceOn, setVoiceOn] = useState(canSpeak);
  const [silent, setSilent] = useState(false); // voice was asked for but the device never started talking
  const [speed, setSpeed] = useState(1);
  const [checkLog, setCheckLog] = useState<string[] | null>(null);
  const runCheck = () => { setCheckLog([]); soundCheck((l) => setCheckLog((xs) => [...(xs ?? []), l])); };
  const [mode, setMode] = useState<Mode>("idle");
  const [shown, setShown] = useState(0);
  const voices = useVoices();
  const timer = useRef<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const run = useRef(0); // bumps on every stop so stale callbacks do nothing

  const pbp = announcers.find((a) => a.id === pbpId) ?? pbps[0];
  const color = colorId === "none" ? null : announcers.find((a) => a.id === colorId) ?? null;
  const lines = useMemo(() => (pbp ? generateBroadcast(g, { pbp, color }, g.knobs.seed) : []), [g, pbp, color]);

  // a new game or a new booth starts the broadcast over
  useEffect(() => { stop(); setShown(0); setMode("idle"); }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // scroll only the transcript box, never the page, so you can scroll away while it plays
    const box = listRef.current;
    if (box && mode === "playing") box.scrollTop = box.scrollHeight;
  }, [shown, mode]);

  function stop() {
    run.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    hush();
  }

  function step(i: number, token: number) {
    if (token !== run.current) return;
    if (i >= lines.length) { setMode("done"); return; }
    setShown(i + 1);
    const line = lines[i];
    let advanced = false;
    const next = () => {
      if (advanced || token !== run.current) return;
      advanced = true;
      timer.current = window.setTimeout(() => step(i + 1, token), (voiceOn ? line.pauseMs * 0.3 : line.pauseMs) / speed);
    };
    if (voiceOn) {
      const u = speak(line.text, line.speaker, voices, line.excitement);
      if (u) {
        u.rate = Math.min(2, u.rate * speed);
        let started = false;
        u.onstart = () => { started = true; setSilent(false); };
        u.onend = next;
        u.onerror = next;
        // if the device hasn't started talking after a few seconds, say so on screen
        window.setTimeout(() => { if (!started && token === run.current) setSilent(true); }, 3500);
        // some browsers never fire "end" (or have no voices); don't let the broadcast stall
        timer.current = window.setTimeout(next, 3000 + (line.text.length * 110) / speed);
        return;
      }
    }
    // reading pace without a voice: about 22 characters a second, sped up by the speed setting
    timer.current = window.setTimeout(next, (line.text.length * 45) / speed);
  }

  function play() {
    stop();
    const token = run.current;
    const start = mode === "paused" ? shown : 0;
    if (start === 0) setShown(0);
    setMode("playing");
    step(start, token);
  }
  function pause() { stop(); setMode("paused"); }
  function showAll() { stop(); setShown(lines.length); setMode("done"); }

  const current = lines[Math.max(0, shown - 1)];
  const ev = current && current.eventIndex >= 0 ? g.events[current.eventIndex] : null;
  const score = ev ? ev.score : { away: 0, home: 0 };
  const inningText = ev ? `${ev.half === "top" ? "▲" : "▼"} ${ev.inning}` : "Pregame";
  const visible = lines.slice(0, shown);
  const names = useMemo(() => nameMap(g), [g]);
  const wo = useMemo(() => walkoffIndex(g), [g]);
  // the live diamond shows the most recent play that has been called
  let liveIdx = -1;
  for (let i = shown - 1; i >= 0; i--) { const ei = lines[i].eventIndex; if (ei >= 0 && g.events[ei].kind === "pa") { liveIdx = ei; break; } }
  const livePlay = liveIdx >= 0 ? (g.events[liveIdx] as PlayEvent) : null;

  return (
    <section className="card radio">
      <div className="radio-head">
        <h2>📻 Radio broadcast</h2>
        <span>
          <button className="link" onClick={runCheck}>🔈 Sound check</button>
          <button className="link" onClick={onEditAnnouncers}>Create or edit announcers</button>
        </span>
      </div>
      <div className="grid">
        <label className="field"><span>Play-by-play</span>
          <select value={pbp?.id} onChange={(e) => setPbpId(e.target.value)}>
            {pbps.map((a) => <option key={a.id} value={a.id}>{a.name}: {a.tagline}</option>)}
          </select>
        </label>
        <label className="field"><span>Color analyst</span>
          <select value={colorId} onChange={(e) => setColorId(e.target.value)}>
            <option value="none">Nobody (solo broadcast)</option>
            {colors.map((a) => <option key={a.id} value={a.id}>{a.name}: {a.tagline}</option>)}
          </select>
        </label>
        <label className="field"><span>Speed <b>{speed}×</b></span>
          <input type="range" min={0.5} max={3} step={0.25} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
        </label>
        <label className="check">
          <input type="checkbox" checked={voiceOn} disabled={!canSpeak} onChange={(e) => setVoiceOn(e.target.checked)} /> Read it out loud
        </label>
      </div>
      <div className="radio-controls">
        {mode === "playing"
          ? <button onClick={pause}>⏸ Pause</button>
          : <button className="primary" onClick={play}>{mode === "paused" ? "▶ Resume" : mode === "done" ? "▶ Play again" : "▶ Listen live"}</button>}
        <button onClick={showAll}>Show whole transcript</button>
        <div className="mini-score" aria-live="polite">
          <span>{g.away.team.name} <b>{score.away}</b></span>
          <span>{g.home.team.name} <b>{score.home}</b></span>
          <span className="muted">{inningText}</span>
        </div>
      </div>
      {!canSpeak && <p className="notice">This browser can't read aloud, so the broadcast will scroll as text. If you opened the link inside another app, open it in Safari or Chrome instead to hear it.</p>}
      {canSpeak && voiceOn && silent && !checkLog && (
        <p className="notice">
          No sound? Turn the volume up (on iPhone, also flip the ring/silent switch off). If you opened the link inside another app,
          open it in Safari or Chrome. The broadcast keeps going as text either way.
          <button className="link" onClick={runCheck}>Run sound check</button>
        </p>
      )}
      {checkLog && (
        <div className="notice">
          <b>Sound check</b> <button className="link" onClick={() => setCheckLog(null)}>Close</button>
          <ul className="check-log">{checkLog.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <p className="small muted">
            Android: read-aloud uses the <b>media</b> volume, so press volume up while a line is playing, or check Settings › Sound › Media volume.
            To test the phone's own speech engine, open Settings › Accessibility › Text-to-speech output and tap Play. If that's silent too,
            install or update "Speech Services by Google" from the Play Store.
            iPhone: flip the ring/silent switch off.
          </p>
          <button onClick={runCheck}>Run again</button>
        </div>
      )}
      {visible.length > 0 && (
        <div className="radio-live">
        <Diamond event={mode === "done" && shown === lines.length && liveIdx < 0 ? null : livePlay} names={names} walkoff={liveIdx === wo} compact duration={(livePlay?.result === "HR" || liveIdx === wo ? 3600 : 2200) / speed} />
        <ol className="transcript" ref={listRef}>
          {visible.map((l, i) => (
            <li key={i} className={l.excitement >= 0.75 ? "hot" : ""}>
              <b className={l.speaker.role === "pbp" ? "pbp" : "color"}>{l.speaker.name}:</b> {l.text}
            </li>
          ))}
        </ol>
        </div>
      )}
      {visible.length === 0 && <p className="muted">Press Listen live to hear the game called from the first pitch, or show the whole transcript.</p>}
    </section>
  );
}
