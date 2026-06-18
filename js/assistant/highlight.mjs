// Tiny, zero-dependency syntax highlighter for the assistant's code blocks.
// It does not aim to be a full parser; it tokenises the common pieces
// (comments, strings, numbers, keywords, function calls) and emits the SAME
// Chroma token classes the theme already styles in chroma.css, so highlighted
// answers look identical to the docs' own code blocks with no extra CSS or deps.

const KEYWORDS = new Set([
  "function", "fn", "func", "def", "return", "if", "else", "elif", "for", "while",
  "do", "switch", "case", "break", "continue", "const", "let", "var", "class",
  "struct", "interface", "enum", "import", "from", "export", "default", "async",
  "await", "yield", "new", "delete", "typeof", "instanceof", "in", "of", "try",
  "catch", "finally", "throw", "throws", "public", "private", "protected",
  "static", "void", "package", "type", "pub", "use", "mut", "impl", "match",
  "module", "require", "include", "extends", "implements", "super", "this",
  "self", "with", "as", "lambda", "pass", "raise", "except", "global", "and",
  "or", "not", "is", "then", "fi", "esac", "local", "echo", "set",
]);

const CONSTANTS = new Set([
  "true", "false", "null", "nil", "none", "undefined", "nan",
  "True", "False", "None", "NaN",
]);

const HASH_LANGS = new Set([
  "py", "python", "bash", "sh", "shell", "zsh", "fish", "yaml", "yml", "toml",
  "ruby", "rb", "perl", "r", "ini", "conf", "dockerfile", "makefile", "make",
]);

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&#34;", "'": "&#39;" }[c]));
}

function span(cls, text) {
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

export function highlightCode(code, lang = "") {
  const l = String(lang).toLowerCase();
  const hash = HASH_LANGS.has(l);
  const slash = !hash; // default to slash-style comments unless it's a hash lang

  // Build the line-comment alternative for this language. // is guarded by a
  // lookbehind so it does not fire on http:// (preceded by ":") or mid-word.
  const lineComments = [];
  if (slash) lineComments.push("(?<![:\\w/])//[^\\n]*");
  if (hash) lineComments.push("(?<!\\w)#[^\\n]*");
  const lineComment = lineComments.length ? `(?:${lineComments.join("|")})` : "(?!x)x";

  const TOKEN = new RegExp(
    [
      "(/\\*[\\s\\S]*?\\*/)",                                  // 1 block comment
      `(${lineComment})`,                                     // 2 line comment
      "(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|`(?:\\\\.|[^`\\\\])*`)", // 3 string
      "(\\b0[xX][0-9a-fA-F]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)", // 4 number
      "([A-Za-z_$][\\w$]*)",                                  // 5 identifier
    ].join("|"),
    "g"
  );

  let out = "";
  let last = 0;
  let m;
  while ((m = TOKEN.exec(code))) {
    if (m.index > last) out += escapeHtml(code.slice(last, m.index)); // plain gap
    const [whole, block, line, str, num, ident] = m;
    if (block || line) out += span("c1", whole);
    else if (str) out += span("s", str);
    else if (num) out += span("mi", num);
    else if (ident) {
      if (KEYWORDS.has(ident)) out += span("k", ident);
      else if (CONSTANTS.has(ident)) out += span("kc", ident);
      else if (code[TOKEN.lastIndex] === "(") out += span("nf", ident);
      else out += escapeHtml(ident);
    }
    last = TOKEN.lastIndex;
  }
  if (last < code.length) out += escapeHtml(code.slice(last));
  return out;
}
