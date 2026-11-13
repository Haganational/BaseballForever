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
    if (typeof speechSynthesis === "undefined") return;
    const load = () => setVoices(speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en")));
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  return voices;
}

export function speak(text: string, a: Announcer, voices: SpeechSynthesisVoice[], excitement = 0.3): SpeechSynthesisUtterance | null {
  if (typeof speechSynthesis === "undefined") return null;
  const u = new SpeechSynthesisUtterance(text);
  const v = voices.find((x) => x.name === a.voice.name);
  if (v) u.voice = v;
  // excited calls come out a little faster and higher
  u.rate = Math.min(2, a.voice.rate * (1 + 0.12 * excitement * a.excitement));
  u.pitch = Math.min(2, a.voice.pitch * (1 + 0.1 * excitement * a.excitement));
  speechSynthesis.speak(u);
  return u;
}
