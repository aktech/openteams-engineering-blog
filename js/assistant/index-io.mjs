// Read/write the static retrieval index. Isolated behind these two functions
// so the on-disk format can later move to a binary / int8-quantized layout
// without touching the indexer or the browser runtime.
//
// Format v1: a single JSON document. Vectors are plain number arrays (one per
// record) so the file is self-describing and trivially diffable.
import { EMBED, INDEX } from "./config.mjs";

export function serializeIndex(records) {
  const dim = records.length ? records[0].vector.length : EMBED.dim;
  const obj = {
    version: INDEX.version,
    model: EMBED.modelId,
    dtype: EMBED.dtype,
    dim,
    count: records.length,
    records: records.map((r) => ({
      id: r.id,
      title: r.title,
      heading: r.heading,
      url: r.url,
      text: r.text,
      vector: Array.from(r.vector),
    })),
  };
  return JSON.stringify(obj);
}

export function deserializeIndex(input) {
  const obj = typeof input === "string" ? JSON.parse(input) : input;
  const meta = {
    version: obj.version,
    model: obj.model,
    dtype: obj.dtype,
    dim: obj.dim,
    count: obj.count,
  };
  const records = obj.records.map((r) => ({
    ...r,
    vector: Float32Array.from(r.vector),
  }));
  return { meta, records };
}
