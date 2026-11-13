// Puts the studio-voice engine and voices in public/ so they're served with the site.
// Engine files come from node_modules; voices (Piper, MIT/CC licensed) are downloaded once from
// the sherpa-onnx model releases on GitHub and kept out of git because they're 63 MB each.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = new URL("..", import.meta.url).pathname;
const tts = join(here, "public/tts");
const voicesDir = join(here, "public/voices");
mkdirSync(tts, { recursive: true });
mkdirSync(voicesDir, { recursive: true });

for (const f of ["piper_phonemize.js", "piper_phonemize.wasm", "piper_phonemize.data"])
  copyFileSync(join(here, "node_modules/@diffusionstudio/piper-wasm/build", f), join(tts, f));
for (const f of ["ort.wasm.min.js", "ort-wasm-simd.wasm", "ort-wasm.wasm"])
  copyFileSync(join(here, "node_modules/onnxruntime-web/dist", f), join(tts, f));

const VOICES = ["en_US-ryan-medium", "en_US-joe-medium", "en_US-norman-medium", "en_US-lessac-medium"];
for (const v of VOICES) {
  if (existsSync(join(voicesDir, `${v}.onnx`)) && existsSync(join(voicesDir, `${v}.onnx.json`))) continue;
  const url = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-${v}.tar.bz2`;
  console.log(`downloading voice ${v}`);
  const tmp = mkdtempSync(join(tmpdir(), "voice-"));
  execFileSync("curl", ["-sSfL", "--retry", "3", "-o", join(tmp, "v.tar.bz2"), url], { stdio: "inherit" });
  execFileSync("tar", ["xjf", join(tmp, "v.tar.bz2"), "-C", tmp], { stdio: "inherit" });
  for (const ext of [".onnx", ".onnx.json"]) copyFileSync(join(tmp, `vits-piper-${v}`, v + ext), join(voicesDir, v + ext));
  rmSync(tmp, { recursive: true, force: true });
}
console.log("studio voices ready");
