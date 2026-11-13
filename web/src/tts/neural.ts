import type { Announcer } from "../../../src/commentary/announcers";

/**
 * Studio voices: Piper neural voices that ship with the site and run on the device in a worker.
 * They play through Web Audio like any other sound, so they don't depend on the phone's own
 * text-to-speech setup (which is what made read-aloud silent on some phones).
 */
export const STUDIO_VOICES = [
  { id: "en_US-ryan-medium", label: "Ryan: clear, big-game voice" },
  { id: "en_US-joe-medium", label: "Joe: quick and punchy" },
  { id: "en_US-norman-medium", label: "Norman: gravelly old-timer" },
  { id: "en_US-lessac-medium", label: "Lessac: crisp and even (female)" },
] as const;
export const VOICE_MB = 63; // download size of one voice

const BASE = import.meta.env.BASE_URL;

export function studioVoiceFor(a: Announcer): string {
  if (a.voice.neural && STUDIO_VOICES.some((v) => v.id === a.voice.neural)) return a.voice.neural;
  return a.role === "pbp" ? "en_US-ryan-medium" : "en_US-norman-medium";
}

export const canStudio = typeof Worker !== "undefined" && typeof WebAssembly !== "undefined" &&
  typeof window !== "undefined" && ("AudioContext" in window || "webkitAudioContext" in window);

type Pending = { ok: (v: { pcm: Float32Array; sampleRate: number }) => void; fail: (e: Error) => void };
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const loads = new Map<string, Promise<void>>();
const loadWaiters = new Map<string, { ok: () => void; fail: (e: Error) => void }>();
let progressListener: ((voice: string, loaded: number, total: number) => void) | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(`${BASE}tts/worker.js`);
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === "progress") progressListener?.(m.id, m.loaded, m.total);
    else if (m.type === "loaded") { loadWaiters.get(m.voice)?.ok(); loadWaiters.delete(m.voice); }
    else if (m.type === "audio") { pending.get(m.id)?.ok({ pcm: m.pcm, sampleRate: m.sampleRate }); pending.delete(m.id); }
    else if (m.type === "error") {
      const err = new Error(m.message);
      if (m.id && pending.has(m.id)) { pending.get(m.id)!.fail(err); pending.delete(m.id); }
      if (m.voice && loadWaiters.has(m.voice)) { loadWaiters.get(m.voice)!.fail(err); loadWaiters.delete(m.voice); loads.delete(m.voice); }
    }
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || "voice engine failed to start");
    pending.forEach((p) => p.fail(err)); pending.clear();
    loadWaiters.forEach((w) => w.fail(err)); loadWaiters.clear(); loads.clear();
  };
  return worker;
}

export function onVoiceProgress(fn: typeof progressListener) { progressListener = fn; }

/** Download (or pull from cache) and start up a voice. */
export function loadVoice(voice: string): Promise<void> {
  if (!loads.has(voice)) {
    loads.set(voice, new Promise<void>((ok, fail) => {
      loadWaiters.set(voice, { ok, fail });
      getWorker().postMessage({ type: "load", voice, base: `${BASE}voices/` });
    }));
  }
  return loads.get(voice)!;
}

export function synth(text: string, voice: string, lengthScale = 1) {
  return new Promise<{ pcm: Float32Array; sampleRate: number }>((ok, fail) => {
    const id = nextId++;
    pending.set(id, { ok, fail });
    getWorker().postMessage({ type: "speak", id, voice, text, lengthScale, base: `${BASE}voices/` });
  });
}

/** How an announcer's settings translate to the studio voice: speed via length, pitch via detune. */
export function delivery(a: Announcer, excitement: number, speed: number) {
  const cents = Math.max(-500, Math.min(500, (a.voice.pitch - 1) * 300 + 120 * excitement * a.excitement));
  const pitchSpeed = Math.pow(2, cents / 1200); // detune also speeds playback up; compensate in the length
  const rate = a.voice.rate * (1 + 0.15 * excitement * a.excitement) * speed;
  const lengthScale = Math.max(0.3, Math.min(2.2, pitchSpeed / rate));
  return { cents, lengthScale };
}

// ---- playback ----
let ctx: AudioContext | null = null;
let current: AudioBufferSourceNode | null = null;

/** Must run inside a tap/click: phones only allow sound to start from a user gesture. */
export function unlockAudio() {
  try {
    // iPhone: play even with the ring/silent switch on (Safari 17+)
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch { /* not supported */ }
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state !== "running") void ctx.resume();
  // a tiny silent buffer finishes the unlock on older iOS
  const b = ctx.createBuffer(1, 1, 22050);
  const s = ctx.createBufferSource();
  s.buffer = b; s.connect(ctx.destination); s.start(0);
  return ctx;
}

export function audioState() { return ctx?.state ?? "not started"; }

/** Play a clip; resolves when it finishes or is stopped. */
export function playClip(pcm: Float32Array, sampleRate: number, cents = 0): Promise<void> {
  const c = ctx ?? unlockAudio();
  if (c.state !== "running") void c.resume();
  stopClip();
  const buf = c.createBuffer(1, pcm.length, sampleRate);
  buf.getChannelData(0).set(pcm);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.detune.value = cents;
  src.connect(c.destination);
  current = src;
  return new Promise((done) => {
    src.onended = () => { if (current === src) current = null; done(); };
    src.start();
  });
}

export function stopClip() {
  const s = current;
  current = null;
  if (s) { try { s.stop(); } catch { /* already stopped */ } }
}
