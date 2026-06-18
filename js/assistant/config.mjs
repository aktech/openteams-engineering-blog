// Shared Ask Assistant config. Imported by BOTH the Node CI indexer and the
// browser runtime so the embedding model, tokenizer, ONNX weights, pooling and
// chunking params can never drift between the two sides.
//
// Vectors are L2-normalized at embed time, so ranking is a plain dot product.

export const TRANSFORMERS_VERSION = "4.2.0";

// Browser loads the library from a pinned CDN (no bundler needed); CI imports
// the same version from node_modules. Same version + same model ids + same
// dtype => identical weights.
export const TRANSFORMERS_CDN =
  `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}`;

// --- Embedding model (runs in Node AND browser) ---
export const EMBED = {
  modelId: "Xenova/bge-small-en-v1.5",
  // q8 = onnx/model_quantized.onnx. Pinned identical on both sides so document
  // vectors (CI) and query vectors (browser) live in the same space.
  dtype: "q8",
  dim: 384,
  pooling: "mean",
  normalize: true,
  // bge applies an instruction prefix to QUERIES only; documents get none.
  queryPrefix: "Represent this sentence for searching relevant passages: ",
  docPrefix: "",
};

// --- In-browser generation model (browser only) ---
// Llama-3.2-1B-Instruct: the model transformers.js's own WebGPU chat demo
// ships, so it is verified to run correctly on the in-browser ONNX runtime.
// (Qwen2.5-1.5B emits degenerate output there on BOTH webgpu and wasm; the
// 0.5B runs but ignores the context. Llama-3.2-1B runs correctly AND grounds.)
// WebGPU loads the dedicated q4f16 repo (self-contained, no external data);
// the wasm/CPU fallback loads q8 from the main ONNX repo.
export const GEN = {
  webgpu: { modelId: "onnx-community/Llama-3.2-1B-Instruct-q4f16", dtype: "q4f16" },
  wasm: { modelId: "onnx-community/Llama-3.2-1B-Instruct-ONNX", dtype: "q8" },
  maxNewTokens: 512,
};

// --- Chunking (used by the CI indexer) ---
// Sized so one chunk usually holds a complete answer. Lengths are in characters
// (~4 chars/token), tuned to bge-small's 512-token window with room for the
// query prefix.
export const CHUNK = {
  targetChars: 900,
  maxChars: 1500,
  minChars: 280, // shorter trailing pieces merge back into the previous chunk
};

// --- Retrieval ---
export const RETRIEVAL = {
  topK: 4, // pass the top 3-5 chunks to the model as context
};

// --- Index format ---
export const INDEX = {
  version: 1,
  // Path the browser fetches the prebuilt index from (relative to baseURL).
  publicPath: "assistant-index.json",
};
