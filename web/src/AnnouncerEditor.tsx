import { useState } from "react";
import { blankAnnouncer, type Announcer } from "../../src/commentary/announcers";
import { speak, useVoices } from "./announcerStore";

const PHRASE_FIELDS: { key: keyof Announcer["phrases"]; label: string; help: string; colorOnly?: boolean; pbpOnly?: boolean }[] = [
  { key: "intro", label: "Opening line", help: "Said at the top of the broadcast" },
  { key: "homeRun", label: "Home run calls", help: "e.g. {batterLast} hits it a mile! Gone!", pbpOnly: true },
  { key: "bigHomeRun", label: "Huge home run calls", help: "For homers that swing the game", pbpOnly: true },
  { key: "strikeout", label: "Strikeout calls", help: "e.g. {pitcherLast} sets him down!" },
  { key: "doublePlay", label: "Double play calls", help: "Added after the play description", pbpOnly: true },
  { key: "bigHit", label: "Big hit calls", help: "When a run-scoring hit changes the game", pbpOnly: true },
  { key: "walkoff", label: "Walk-off call", help: "The game-winning moment", pbpOnly: true },
  { key: "final", label: "Sign-off", help: "Last words of the broadcast", pbpOnly: true },
  { key: "filler", label: "Go-to remarks", help: "Stories and opinions dropped in between plays", colorOnly: true },
];

export function AnnouncerEditor(props: { all: Announcer[]; custom: Announcer[]; save: (a: Announcer) => void; remove: (id: string) => void; onClose: () => void }) {
  const { all, custom, save, remove, onClose } = props;
  const [draft, setDraft] = useState<Announcer | null>(custom[0] ? structuredClone(custom[0]) : null);
  const voices = useVoices();
  const set = <K extends keyof Announcer>(k: K, v: Announcer[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const setPhrases = (k: keyof Announcer["phrases"], text: string) =>
    setDraft((d) => (d ? { ...d, phrases: { ...d.phrases, [k]: text.split("\n").map((s) => s.trim()).filter(Boolean) } } : d));

  const startFrom = (a: Announcer | null, role: "pbp" | "color" = "pbp") => {
    const base = a ? { ...structuredClone(a), id: blankAnnouncer().id, name: `${a.name} (my version)`, builtIn: false } : blankAnnouncer(role);
    setDraft(base);
  };

  return (
    <section className="card editor">
      <div className="radio-head">
        <h2>🎙️ Announcer booth</h2>
        <button className="link" onClick={onClose}>Done</button>
      </div>
      <p className="muted small">Make your own play-by-play voices and color analysts. They're saved in this browser.</p>
      <div className="editor-top">
        <button onClick={() => startFrom(null, "pbp")}>+ New play-by-play voice</button>
        <button onClick={() => startFrom(null, "color")}>+ New color analyst</button>
        <label className="field inline-field"><span>Or start from</span>
          <select value="" onChange={(e) => startFrom(all.find((a) => a.id === e.target.value) ?? null)}>
            <option value="">Copy an existing announcer…</option>
            {all.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {custom.length > 0 && (
          <label className="field inline-field"><span>Edit</span>
            <select value={draft && custom.some((c) => c.id === draft.id) ? draft.id : ""} onChange={(e) => { const a = custom.find((c) => c.id === e.target.value); if (a) setDraft(structuredClone(a)); }}>
              <option value="">Your announcers…</option>
              {custom.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {draft && (
        <div className="editor-body">
          <div className="grid">
            <label className="field"><span>Name</span><input value={draft.name} onChange={(e) => set("name", e.target.value)} /></label>
            <label className="field"><span>Tagline</span><input value={draft.tagline} onChange={(e) => set("tagline", e.target.value)} /></label>
            <label className="field"><span>Job</span>
              <select value={draft.role} onChange={(e) => set("role", e.target.value as Announcer["role"])}>
                <option value="pbp">Play-by-play (calls every play)</option>
                <option value="color">Color analyst (stats and stories)</option>
              </select>
            </label>
            <label className="field"><span>Roots for</span>
              <select value={draft.homer ?? "none"} onChange={(e) => set("homer", e.target.value === "none" ? null : (e.target.value as "away" | "home"))}>
                <option value="none">Nobody (neutral)</option>
                <option value="home">The home team</option>
                <option value="away">The away team</option>
              </select>
            </label>
            <label className="field"><span>Excitement <b>{draft.excitement}</b></span>
              <input type="range" min={0} max={1} step={0.05} value={draft.excitement} onChange={(e) => set("excitement", Number(e.target.value))} />
              <small className="muted">0 calm, 1 loses his mind</small>
            </label>
            <label className="field"><span>Chattiness <b>{draft.chattiness}</b></span>
              <input type="range" min={0} max={1} step={0.05} value={draft.chattiness} onChange={(e) => set("chattiness", Number(e.target.value))} />
              <small className="muted">0 just the facts, 1 never stops</small>
            </label>
            <label className="field"><span>Voice</span>
              <select value={draft.voice.name} onChange={(e) => set("voice", { ...draft.voice, name: e.target.value })}>
                <option value="">Browser default</option>
                {voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
              </select>
              <small className="muted">Voices come from your device, so they differ between phone and computer</small>
            </label>
            <label className="field"><span>Talking speed <b>{draft.voice.rate}</b></span>
              <input type="range" min={0.5} max={1.8} step={0.05} value={draft.voice.rate} onChange={(e) => set("voice", { ...draft.voice, rate: Number(e.target.value) })} />
            </label>
            <label className="field"><span>Pitch <b>{draft.voice.pitch}</b></span>
              <input type="range" min={0.2} max={1.8} step={0.05} value={draft.voice.pitch} onChange={(e) => set("voice", { ...draft.voice, pitch: Number(e.target.value) })} />
            </label>
          </div>
          <p className="muted small">Lines can use {"{batter}"}, {"{batterLast}"}, {"{pitcher}"}, {"{pitcherLast}"}, {"{fielder}"}, {"{field}"}, {"{team}"}, {"{otherTeam}"}, {"{score}"}, {"{inning}"}. One line per row. The announcer picks one at random each time.</p>
          <div className="grid phrases">
            {PHRASE_FIELDS.filter((f) => (draft.role === "color" ? !f.pbpOnly : !f.colorOnly)).map((f) => (
              <label key={f.key} className="field"><span>{f.label}</span>
                <textarea rows={3} defaultValue={draft.phrases[f.key].join("\n")} key={`${draft.id}-${f.key}`} onBlur={(e) => setPhrases(f.key, e.target.value)} placeholder={f.help} />
                <small className="muted">{f.help}</small>
              </label>
            ))}
          </div>
          <div className="radio-controls">
            <button className="primary" onClick={() => save({ ...draft, builtIn: false })}>Save announcer</button>
            <button onClick={() => speak(draft.phrases.homeRun[0]?.replace(/\{batter(Last)?\}/g, "Ruth") ?? `Hi, I'm ${draft.name}, and this is how I sound.`, draft, voices, 0.8)}>🔊 Test voice</button>
            {custom.some((c) => c.id === draft.id) && <button onClick={() => { remove(draft.id); setDraft(null); }}>Delete</button>}
          </div>
        </div>
      )}
    </section>
  );
}
