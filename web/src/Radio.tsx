import { useEffect, useMemo, useRef, useState } from "react";
import type { Announcer } from "../../src/commentary/announcers";
import { generateBroadcast } from "../../src/commentary/broadcast";
import type { GameResult } from "../../src/game";
import { canSpeak, hush, soundCheck, speak, useVoices } from "./announcerStore";
import { audioState, canStudio, delivery, loadVoice, onVoiceProgress, playClip, stopClip, studioVoiceFor, synth, unlockAudio, VOICE_MB } from "./tts/neural";
import { Diamond } from "./Diamond";
import { nameMap, walkoffIndex } from "./describe";
import type { PlayEvent } from "../../src/game";

type Mode = "idle" | "playing" | "paused" | "done";
type Sound = "studio" | "device" | "off";
type Clip = { pcm: Float32Array; sampleRate: number; cents: number };
const SOUND_KEY = "bf.sound.v1";
function savedSound(): Sound {
  try { const v = localStorage.getItem(SOUND_KEY) as Sound | null; if (v === "studio" && canStudio) return v; if (v === "device" && canSpeak) return v; if (v === "off") return v; } catch { /* no storage */ }
  return canStudio ? "studio" : canSpeak ? "device" : "off";
}

export function Radio({ g, announcers, onEditAnnouncers }: { g: GameResult; announcers: Announcer[]; onEditAnnouncers: () => void }) {
  const pbps = announcers.filter((a) => a.role === "pbp");
  const colors = announcers.filter((a) => a.role === "color");
  const [pbpId, setPbpId] = useState(pbps[0]?.id ?? "");
  const [colorId, setColorId] = useState(colors[0]?.id ?? "none");
  const [sound, setSoundState] = useState<Sound>(savedSound);
  const setSound = (v: Sound) => { setSoundState(v); try { localStorage.setItem(SOUND_KEY, v); } catch { /* no storage */ } };
  const voiceOn = sound === "device";
  const [loading, setLoading] = useState<string | null>(null); // studio voices downloading / warming up
  const [studioError, setStudioError] = useState<string | null>(null);
  const clips = useRef(new Map<number, Promise<Clip>>());
  const [silent, setSilent] = useState(false); // voice was asked for but the device never started talking
  const [speed, setSpeed] = useState(1);
  const [checkLog, setCheckLog] = useState<string[] | null>(null);
  const runCheck = () => {
    setCheckLog([]);
    const log = (l: string) => setCheckLog((xs) => [...(xs ?? []), l]);
    if (sound === "device") soundCheck(log); else void testStudio(log);
  };
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
  useEffect(() => { stop(); setShown(0); setMode("idle"); clips.current.clear(); }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { clips.current.clear(); }, [speed]);
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
    stopClip();
    setLoading(null);
  }

  function clipFor(i: number): Promise<Clip> {
    let p = clips.current.get(i);
    if (!p) {
      const l = lines[i];
      const d = delivery(l.speaker, l.excitement, speed);
      p = synth(l.text, studioVoiceFor(l.speaker), d.lengthScale).then((c) => ({ ...c, cents: d.cents }));
      p.catch(() => clips.current.delete(i));
      clips.current.set(i, p);
    }
    return p;
  }

  function step(i: number, token: number) {
    if (token !== run.current) return;
    if (i >= lines.length) { setMode("done"); return; }
    const line = lines[i];
    if (sound === "studio") {
      // the line appears when its audio starts; the next one is prepared while this one plays
      clipFor(i).then(async (c) => {
        if (token !== run.current) return;
        setLoading(null);
        setShown(i + 1);
        if (i + 1 < lines.length) void clipFor(i + 1).catch(() => {});
        await playClip(c.pcm, c.sampleRate, c.cents);
        if (token !== run.current) return;
        timer.current = window.setTimeout(() => step(i + 1, token), (line.pauseMs * 0.25) / speed);
      }).catch((err: Error) => {
        if (token !== run.current) return;
        setLoading(null);
        setStudioError(err.message);
        // keep the game going as text
        setShown(i + 1);
        timer.current = window.setTimeout(() => step(i + 1, token), (line.text.length * 45) / speed);
      });
      return;
    }
    setShown(i + 1);
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
    if (sound === "studio") {
      unlockAudio(); // has to happen inside the tap
      setStudioError(null);
      const voices = [...new Set([pbp, color].filter(Boolean).map((a) => studioVoiceFor(a!)))];
      const got = new Map<string, number>();
      let total = 0;
      onVoiceProgress((v, loaded, t) => {
        got.set(v, loaded); total = Math.max(total, t * voices.length);
        const sum = [...got.values()].reduce((a, b) => a + b, 0);
        if (token === run.current) setLoading(`Downloading the announcers' voices (one time only)… ${Math.min(99, Math.round((100 * sum) / (total || VOICE_MB * 1e6 * voices.length)))}%`);
      });
      setLoading("Warming up the booth…");
      voices.forEach((v) => void loadVoice(v).catch(() => {}));
    }
    const start = mode === "paused" ? shown : 0;
    if (start === 0) setShown(0);
    setMode("playing");
    step(start, token);
  }
  function pause() { stop(); setMode("paused"); }
  async function testStudio(log: (l: string) => void) {
    const a = pbp;
    if (!a) return;
    log(`Studio voices supported: ${canStudio ? "yes" : "no"}`);
    if (!canStudio) return;
    unlockAudio();
    log(`Audio: ${audioState()}`);
    const v = studioVoiceFor(a);
    const t0 = performance.now();
    onVoiceProgress((_v, loaded, t) => log(`Downloading ${v}: ${Math.round(loaded / 1e6)} of ${Math.round(t / 1e6) || VOICE_MB} MB`));
    try {
      await loadVoice(v);
      log(`Voice ready after ${Math.round(performance.now() - t0)} ms.`);
      const t1 = performance.now();
      const c = await synth("Testing, one, two, three. Can you hear me?", v);
      log(`Made ${(c.pcm.length / c.sampleRate).toFixed(1)} s of audio in ${Math.round(performance.now() - t1)} ms. Playing it now (audio: ${audioState()}).`);
      await playClip(c.pcm, c.sampleRate);
      log("Done. If you heard nothing, turn the media volume up.");
    } catch (e) {
      log(`Studio voice failed: ${(e as Error).message}`);
    }
  }
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
        <span className="head-links">
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
        <label className="field"><span>Sound</span>
          <select value={sound} onChange={(e) => { stop(); if (mode === "playing") setMode("paused"); setSound(e.target.value as Sound); }}>
            {canStudio && <option value="studio">Studio voices (best)</option>}
            {canSpeak && <option value="device">Phone's built-in voice</option>}
            <option value="off">Off (text only)</option>
          </select>
          {sound === "studio" && <small className="muted">First listen downloads about {VOICE_MB} MB per announcer, then it's saved. Wi-Fi helps.</small>}
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
      {loading && <p className="notice">⏳ {loading}</p>}
      {studioError && sound === "studio" && (
        <p className="notice">The studio voices couldn't play ({studioError}), so the game is scrolling as text. Try the phone's built-in voice under Sound, or tap Sound check.</p>
      )}
      {!canSpeak && !canStudio && <p className="notice">This browser can't read aloud, so the broadcast will scroll as text. If you opened the link inside another app, open it in Safari or Chrome instead to hear it.</p>}
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
