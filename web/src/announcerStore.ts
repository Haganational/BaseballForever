import { useEffect, useState } from "react";
import { BUILT_IN_ANNOUNCERS, type Announcer } from "../../src/commentary/announcers";

// Custom announcers are kept in this browser for now. When the Supabase step is switched on,
// this is the one place to change so they're saved to your account instead.
const KEY = "bf.customAnnouncers.v1";

function read(): Announcer[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Announcer[]) : [];
  } catch {
    return [];
  }
}

export function useAnnouncers() {
  const [custom, setCustom] = useState<Announcer[]>(read);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(custom)); } catch { /* storage blocked: keep in memory */ }
  }, [custom]);
  const all = [...BUILT_IN_ANNOUNCERS, ...custom];
  const save = (a: Announcer) => setCustom((xs) => (xs.some((x) => x.id === a.id) ? xs.map((x) => (x.id === a.id ? a : x)) : [...xs, a]));
  const remove = (id: string) => setCustom((xs) => xs.filter((x) => x.id !== id));
  return { all, custom, save, remove };
}

/** The browser's text-to-speech voices (they load asynchronously in some browsers). */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!canSpeak) return;
    const load = () => setVoices(speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en")));
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  return voices;
}

export const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

/** Stop talking. Only cancels when something is queued: Safari drops the next line if you cancel an idle synth. */
export function hush() {
  if (!canSpeak) return;
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
}

// Chrome can garbage-collect an utterance mid-sentence and then never fire its events; keep the live ones referenced.
const live = new Set<SpeechSynthesisUtterance>();

export function speak(text: string, a: Announcer, voices: SpeechSynthesisVoice[], excitement = 0.3): SpeechSynthesisUtterance | null {
  if (!canSpeak) return null;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  // Only pin a voice the announcer explicitly chose and this device has. Otherwise leave it to the
  // device's own default: on Android, forcing a voice from the list can leave Chrome silent.
  const v = a.voice.name ? voices.find((x) => x.name === a.voice.name) : undefined;
  if (v) u.voice = v;
  // excited calls come out a little faster and higher
  u.rate = Math.min(2, a.voice.rate * (1 + 0.12 * excitement * a.excitement));
  u.pitch = Math.min(2, a.voice.pitch * (1 + 0.1 * excitement * a.excitement));
  live.add(u);
  u.addEventListener("end", () => live.delete(u));
  u.addEventListener("error", () => live.delete(u));
  // Chrome sometimes leaves the synth paused after a tab switch
  if (speechSynthesis.paused) speechSynthesis.resume();
  speechSynthesis.speak(u);
  return u;
}

/** Plain test with no voice, rate or pitch set, reporting what the browser's speech engine does. */
export function soundCheck(log: (line: string) => void) {
  if (!canSpeak) { log("This browser has no read-aloud support at all."); return; }
  const all = speechSynthesis.getVoices();
  const en = all.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith("en"));
  log(`Voices on this device: ${all.length} (${en.length} English)${en.length ? ", e.g. " + en.slice(0, 3).map((v) => v.name).join(", ") : ""}`);
  log(`Engine state before test: ${speechSynthesis.speaking ? "speaking" : "idle"}${speechSynthesis.pending ? ", queue stuck" : ""}${speechSynthesis.paused ? ", paused" : ""}`);
  if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); log("Cleared a stuck queue."); }
  const t0 = performance.now();
  const ms = () => `${Math.round(performance.now() - t0)} ms`;
  const u = new SpeechSynthesisUtterance("Testing, one, two, three. Can you hear me?");
  u.lang = "en-US";
  live.add(u);
  let started = false, failed = false;
  u.onstart = () => { started = true; log(`Started talking after ${ms()}.`); };
  u.onend = () => { live.delete(u); log(`Finished after ${ms()}. If you heard nothing, the sound is muted or turned down on the phone.`); };
  u.onerror = (e) => { failed = true; live.delete(u); log(`Speech error after ${ms()}: ${e.error}`); };
  speechSynthesis.speak(u);
  log("Asked the phone to say a test line…");
  window.setTimeout(() => { if (!started && !failed) log("After 5 seconds the phone's speech engine still hasn't started. That points to the phone's text-to-speech setup, not the volume."); }, 5000);
}
