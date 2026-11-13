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

export function speak(text: string, a: Announcer, voices: SpeechSynthesisVoice[], excitement = 0.3): SpeechSynthesisUtterance | null {
  if (!canSpeak) return null;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  // the chosen voice if this device has it, otherwise any English voice (some Android browsers stay silent without one)
  const v = voices.find((x) => x.name === a.voice.name) ?? voices.find((x) => x.default) ?? voices[0];
  if (v) u.voice = v;
  // excited calls come out a little faster and higher
  u.rate = Math.min(2, a.voice.rate * (1 + 0.12 * excitement * a.excitement));
  u.pitch = Math.min(2, a.voice.pitch * (1 + 0.1 * excitement * a.excitement));
  // Chrome sometimes leaves the synth paused after a tab switch
  if (speechSynthesis.paused) speechSynthesis.resume();
  speechSynthesis.speak(u);
  return u;
}
