// Rank index records against a query vector. All vectors are L2-normalized at
// embed time, so cosine similarity reduces to a plain dot product.

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function topK(queryVector, items, k) {
  const scored = items.map((item) => ({ ...item, score: dot(queryVector, item.vector) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
