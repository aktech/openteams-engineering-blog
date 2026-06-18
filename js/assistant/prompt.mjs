// Build the grounded prompts and parse model output. The same prompts feed both
// the in-browser and the hosted backend.
//
// Follow-up questions are generated in a SEPARATE short call, not inline: a
// small (1B) in-browser model cannot reliably interleave an answer with a
// custom marker and follow-ups in one response, so keeping the answer prompt
// focused makes the answer itself far more reliable.

const ANSWER_SYSTEM = `You are a documentation assistant. Answer the user's question using the numbered context sources below, which are excerpts from the documentation.

Rules:
- Base your answer on the context. The answer is usually present, so read the sources carefully before deciding.
- Do not use outside knowledge or invent details beyond the context.
- Cite the sources you use inline like [1] or [2].
- Be concise and direct. Prefer short steps or a short paragraph.
- Only if the context genuinely contains nothing relevant, reply exactly: "I don't know based on these docs."`;

const FOLLOWUP_SYSTEM = `You suggest follow-up questions for a documentation reader. Output exactly three short questions the reader might ask next, one per line. No numbering, no bullets, no preamble. Each line must be a single question ending with a question mark.`;

export function buildAnswerMessages(query, chunks) {
  const context = chunks
    .map((c, i) => `[${i + 1}] (${c.heading || "Untitled"})\n${c.text}`)
    .join("\n\n");
  return [
    { role: "system", content: ANSWER_SYSTEM },
    { role: "user", content: `Context:\n\n${context}\n\nQuestion: ${query}` },
  ];
}

export function buildFollowupMessages(query, answer) {
  return [
    { role: "system", content: FOLLOWUP_SYSTEM },
    {
      role: "user",
      content: `Original question: ${query}\n\nAnswer given:\n${answer}\n\nThree follow-up questions, one per line:`,
    },
  ];
}

// A model may still emit a leftover marker from older prompts; strip it.
export function cleanAnswer(raw) {
  return (raw || "").split("===FOLLOWUPS===")[0].trim();
}

// Instant follow-ups for the in-browser backend: the distinct headings of the
// retrieved sources (other than the first, already-answered one). No second
// model call, so the panel never stalls on slow in-browser generation.
export function suggestFromChunks(chunks) {
  const seen = new Set();
  const out = [];
  for (const c of chunks.slice(1)) {
    const h = (c.heading || "").trim();
    const key = h.toLowerCase();
    if (h && !seen.has(key)) {
      seen.add(key);
      out.push(h);
    }
  }
  return out.slice(0, 3);
}

const PREAMBLE = /^(here|sure|certainly|the following|follow.?up|of course|okay|ok)\b/i;

export function parseFollowups(raw) {
  const lines = (raw || "")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.length >= 8 && l.length <= 120)
    .filter((l) => !PREAMBLE.test(l));
  const questions = lines.filter((l) => l.endsWith("?"));
  return (questions.length ? questions : lines).slice(0, 3);
}
