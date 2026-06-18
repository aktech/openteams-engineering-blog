// Ask Assistant Web Worker. Keeps the heavy transformers.js library, model
// downloads, query embedding and (for the in-browser backend) text generation
// entirely off the main thread.
//
// The library is imported from the pinned CDN build, so no bundler is needed;
// the model ids / dtype / pooling all come from the shared config the CI
// indexer uses too. WebGPU is used when available, with a wasm fallback.
import { TRANSFORMERS_CDN, EMBED, GEN } from "./config.mjs";
import { embedQuery } from "./embed.mjs";

const tf = await import(/* @vite-ignore */ `${TRANSFORMERS_CDN}`);
const { pipeline, TextStreamer, env } = tf;

env.allowRemoteModels = true; // download weights from the HF hub (cached after)

const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;

let extractorPromise = null;
let generatorPromise = null;

function progress(stage) {
  return (p) => {
    if (p.status === "progress" && p.file && p.total) {
      self.postMessage({
        type: "progress",
        stage,
        file: p.file,
        loaded: p.loaded,
        total: p.total,
      });
    } else if (p.status === "ready" || p.status === "done") {
      self.postMessage({ type: "progress", stage, status: p.status });
    }
  };
}

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", EMBED.modelId, {
      dtype: EMBED.dtype,
      progress_callback: progress("embedder"),
    });
  }
  return extractorPromise;
}

function getGenerator() {
  if (!generatorPromise) {
    const tier = hasWebGPU ? GEN.webgpu : GEN.wasm;
    generatorPromise = pipeline("text-generation", tier.modelId, {
      dtype: tier.dtype,
      device: hasWebGPU ? "webgpu" : "wasm",
      progress_callback: progress("generator"),
    });
  }
  return generatorPromise;
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === "warmup") {
      // Pre-load whichever models this backend needs.
      await getExtractor();
      if (msg.needGenerator) await getGenerator();
      self.postMessage({ type: "ready" });
      return;
    }

    if (msg.type === "embedQuery") {
      const extractor = await getExtractor();
      const vector = await embedQuery(extractor, msg.text);
      self.postMessage({ type: "queryVector", id: msg.id, vector });
      return;
    }

    if (msg.type === "generate") {
      const generator = await getGenerator();
      const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text) => {
          self.postMessage({ type: "token", id: msg.id, text });
        },
      });
      const out = await generator(msg.messages, {
        max_new_tokens: GEN.maxNewTokens,
        do_sample: false,
        streamer,
      });
      const full = out[0].generated_text;
      const text = Array.isArray(full) ? full[full.length - 1].content : full;
      self.postMessage({ type: "generated", id: msg.id, text });
      return;
    }
  } catch (err) {
    self.postMessage({ type: "error", id: msg && msg.id, message: String(err && err.message || err) });
  }
};
