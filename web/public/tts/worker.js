/* Neural text-to-speech worker: Piper voices (VITS) run with onnxruntime-web. Plain script, served as-is. */
importScripts("ort.wasm.min.js", "piper_phonemize.js");
ort.env.wasm.numThreads = 1; // GitHub Pages can't enable cross-origin isolation, so no threads
ort.env.wasm.wasmPaths = self.location.href.replace(/worker\.js.*$/, "");

const voices = new Map(); // id -> Promise<{ session, config }>
let phonemizer = null; // Promise<module>
let printHandler = null;

function getPhonemizer() {
  if (!phonemizer) {
    phonemizer = createPiperPhonemize({
      print: (d) => printHandler && printHandler(d),
      printErr: () => {},
      noExitRuntime: true,
      locateFile: (u) => u,
    });
  }
  return phonemizer;
}

async function fetchWithProgress(url, id) {
  // Cache Storage keeps the big model files across visits (the browser's HTTP cache may evict them)
  let cache = null;
  try { cache = await caches.open("bf-voices-v1"); } catch {}
  let res = cache && (await cache.match(url));
  if (!res) {
    const net = await fetch(url);
    if (!net.ok) throw new Error(`Couldn't download ${url} (${net.status})`);
    const total = +(net.headers.get("Content-Length") || 0);
    const reader = net.body.getReader();
    const chunks = [];
    let got = 0, last = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (got - last > 500000) { last = got; postMessage({ type: "progress", id, loaded: got, total }); }
    }
    const blob = new Blob(chunks);
    if (cache) { try { await cache.put(url, new Response(blob)); } catch {} }
    return blob.arrayBuffer();
  }
  return res.arrayBuffer();
}

function loadVoice(id, base) {
  if (!voices.has(id)) {
    const p = (async () => {
      const config = await (await fetch(`${base}${id}.onnx.json`)).json();
      const model = await fetchWithProgress(`${base}${id}.onnx`, id);
      const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
      return { session, config };
    })();
    p.catch(() => voices.delete(id));
    voices.set(id, p);
  }
  return voices.get(id);
}

async function phonemeIds(text, espeakVoice) {
  const mod = await getPhonemizer();
  return new Promise((resolve, reject) => {
    printHandler = (d) => { printHandler = null; try { resolve(JSON.parse(d).phoneme_ids); } catch (e) { reject(e); } };
    try {
      mod.callMain(["-l", espeakVoice, "--input", JSON.stringify([{ text }]), "--espeak_data", "/espeak-ng-data"]);
    } catch (e) { printHandler = null; reject(e); }
  });
}

let queue = Promise.resolve();
onmessage = (e) => {
  const m = e.data;
  if (m.type === "load") {
    loadVoice(m.voice, m.base).then(() => postMessage({ type: "loaded", voice: m.voice }), (err) => postMessage({ type: "error", id: m.id, voice: m.voice, message: String(err && err.message || err) }));
    return;
  }
  if (m.type === "speak") {
    // one line at a time: the phonemizer isn't re-entrant
    queue = queue.then(async () => {
      try {
        const { session, config } = await loadVoice(m.voice, m.base);
        const ids = await phonemeIds(m.text, config.espeak.voice);
        const inf = config.inference;
        const feeds = {
          input: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
          input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
          scales: new ort.Tensor("float32", Float32Array.from([inf.noise_scale, inf.length_scale * (m.lengthScale || 1), inf.noise_w]), [3]),
        };
        if (config.num_speakers > 1) feeds.sid = new ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
        const out = await session.run(feeds);
        const pcm = new Float32Array(out.output.data);
        postMessage({ type: "audio", id: m.id, pcm, sampleRate: config.audio.sample_rate }, [pcm.buffer]);
      } catch (err) {
        postMessage({ type: "error", id: m.id, message: String(err && err.message || err) });
      }
    });
  }
};
