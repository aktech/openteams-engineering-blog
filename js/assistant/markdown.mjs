// Minimal Markdown -> HTML for assistant answers. Pure (no DOM), so it is
// unit-tested. Handles paragraphs, bold, inline code, links, [n] source
// citations, lists, and fenced code blocks with syntax highlighting.
import { highlightCode } from "./highlight.mjs";

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderInline(s, hits) {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // [1] citation -> link to the matching source
  t = t.replace(/\[(\d+)\]/g, (m, n) => {
    const h = hits && hits[Number(n) - 1];
    return h ? `<a class="asst-cite" href="${h.url}">[${n}]</a>` : m;
  });
  return t;
}

function codeBlock(lines, lang) {
  return `<pre class="chroma"><code>${highlightCode(lines.join("\n"), lang)}</code></pre>`;
}

export function renderMarkdown(src, hits) {
  const lines = String(src).split("\n");
  let html = "";
  let list = null;
  let code = null; // { lang, lines } while inside a fenced block
  const flushList = () => {
    if (list) {
      html += `<${list.tag}>${list.items.join("")}</${list.tag}>`;
      list = null;
    }
  };

  for (const line of lines) {
    if (code) {
      if (/^\s*```\s*$/.test(line)) {
        html += codeBlock(code.lines, code.lang);
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }
    const fence = line.match(/^\s*```([\w+-]*)\s*$/);
    if (fence) {
      flushList();
      code = { lang: fence[1] || "", lines: [] };
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul || ol) {
      const tag = ul ? "ul" : "ol";
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push(`<li>${renderInline((ul || ol)[1], hits)}</li>`);
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      html += `<p>${renderInline(line, hits)}</p>`;
    }
  }
  flushList();
  // a fence still open at end of input (e.g. streaming) -> render what we have
  if (code) html += codeBlock(code.lines, code.lang);
  return html;
}
