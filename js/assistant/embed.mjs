// Shared embedding logic. The transformers.js feature-extraction pipeline is
// injected (CI creates it from node_modules, the browser from the pinned CDN),
// so the prefix/pooling/normalize rules live in ONE place and cannot drift.
import { EMBED } from "./config.mjs";

// bge applies the instruction prefix to QUERIES only; documents get none.
function withPrefix(texts, isQuery) {
  const prefix = isQuery ? EMBED.queryPrefix : EMBED.docPrefix;
  return prefix ? texts.map((t) => prefix + t) : texts;
}

// Returns an array of plain number[] rows (one vector per input), L2-normalized.
export async function embedTexts(extractor, texts, { isQuery = false } = {}) {
  const inputs = withPrefix(texts, isQuery);
  const out = await extractor(inputs, {
    pooling: EMBED.pooling,
    normalize: EMBED.normalize,
  });
  return out.tolist();
}

export async function embedQuery(extractor, text) {
  const [vec] = await embedTexts(extractor, [text], { isQuery: true });
  return vec;
}
