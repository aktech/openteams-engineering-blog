// Ask Assistant UI orchestrator (main thread). Wires the trigger, slide-in
// panel, keyboard shortcut and focus trap to the retrieval + generation flow.
// Retrieval (index fetch + ranking) runs here; query embedding and in-browser
// generation run in the worker.
import { RETRIEVAL } from "./config.mjs";
import { deserializeIndex } from "./index-io.mjs";
import { topK } from "./rank.mjs";
import { buildAnswerMessages, buildFollowupMessages, parseFollowups, cleanAnswer, suggestFromChunks } from "./prompt.mjs";
import { renderMarkdown, escapeHtml } from "./markdown.mjs";
import { WorkerClient } from "./worker-client.mjs";
import { createAnswerer } from "./answerer.mjs";

const cfgEl = document.getElementById("darby-assistant-config");
if (cfgEl) boot(JSON.parse(cfgEl.textContent));

function boot(cfg) {
  const panel = document.getElementById("assistant-panel");
  const trigger = document.querySelector("[data-assistant-trigger]");
  if (!panel) return;

  const form = panel.querySelector("[data-assistant-form]");
  const input = panel.querySelector("[data-assistant-input]");
  const thread = panel.querySelector("[data-assistant-thread]");
  const closeBtn = panel.querySelector("[data-assistant-close]");
  const clearBtn = panel.querySelector("[data-assistant-clear]");

  const isMac = /mac/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.userAgent);
  // shortcut hint: Cmd+I on mac (⌘ glyph styled like the search ⌘K), Ctrl+I elsewhere
  const hintHtml = isMac ? '<span class="kbd-cmd">⌘</span>I' : "Ctrl+I";
  document.querySelectorAll("[data-assistant-kbd]").forEach((el) => {
    el.innerHTML = hintHtml;
  });

  const client = new WorkerClient(cfg.workerUrl);
  const answerer = createAnswerer(cfg, client);
  let records = null;
  let booted = null; // promise: index loaded + worker warmed
  let lastQuestion = "";
  let busy = false;
  let lastFocus = null;

  client.onProgress((p) => renderProgress(thread, p));

  function ensureReady() {
    if (!booted) {
      booted = (async () => {
        const res = await fetch(cfg.indexUrl);
        if (!res.ok) throw new Error(`Could not load the docs index (${res.status})`);
        records = deserializeIndex(await res.text()).records;
        // warm the models (generator only needed for the in-browser backend)
        await client.warmup(cfg.backend !== "hosted");
      })();
    }
    return booted;
  }

  // --- open / close ---
  function open() {
    if (panel.hasAttribute("hidden")) {
      lastFocus = document.activeElement;
      panel.removeAttribute("hidden");
      document.body.classList.add("assistant-open");
      requestAnimationFrame(() => panel.classList.add("is-open"));
    }
    input.focus();
    input.select();
    ensureReady().catch((e) => renderError(thread, e.message));
  }
  function close() {
    panel.classList.remove("is-open");
    document.body.classList.remove("assistant-open");
    panel.setAttribute("hidden", "");
    // Return focus to the invoking element, falling back to the trigger (the
    // canonical launcher) when opened via the keyboard shortcut.
    const target =
      lastFocus && lastFocus.focus && lastFocus !== document.body ? lastFocus : trigger;
    if (target && target.focus) target.focus();
  }
  const isOpen = () => !panel.hasAttribute("hidden");

  if (trigger) trigger.addEventListener("click", open);
  if (closeBtn) closeBtn.addEventListener("click", close);
  if (clearBtn)
    clearBtn.addEventListener("click", () => {
      thread.innerHTML = "";
      input.focus();
    });

  // --- keyboard: Cmd/Ctrl+I toggles, Esc closes, Tab trapped while open ---
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "i" || e.key === "I")) {
      e.preventDefault();
      isOpen() ? close() : open();
      return;
    }
    if (!isOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      trapFocus(panel, e);
    }
  });

  // --- ask flow ---
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) ask(q);
  });

  async function ask(question) {
    if (busy) return;
    busy = true;
    lastQuestion = question;
    input.value = "";

    addUser(thread, question);
    const turn = addAssistantTurn(thread);
    setStatus(turn, "Searching the docs…");

    try {
      await ensureReady();
      const qvec = await client.embedQuery(question);
      const hits = topK(qvec, records, RETRIEVAL.topK);
      setStatus(turn, `Read ${hits.length} source${hits.length === 1 ? "" : "s"}`);
      renderSources(turn, hits);

      const messages = buildAnswerMessages(question, hits);
      // generation indicator lives in the answer area; the first token clears it
      setPending(turn.querySelector("[data-answer]"), "Writing answer…");

      let raw = "";
      await answerer.generate(messages, (tok) => {
        raw += tok;
        renderAnswerStream(turn, raw, hits);
      });

      const answer = cleanAnswer(raw);
      finalizeAnswer(turn, answer, hits);

      // Follow-ups. Hosted backends are fast, so we generate real questions in a
      // short second call. The in-browser model is slow, so a second generation
      // would stall the panel; instead we derive instant chips from the
      // retrieved sources.
      if (cfg.backend === "hosted") {
        setPending(turn.querySelector("[data-followups]"), "Finding related questions…");
        try {
          const fuRaw = await answerer.generate(buildFollowupMessages(question, answer), () => {});
          renderFollowups(turn, parseFollowups(fuRaw), "Suggested questions");
        } catch {
          renderFollowups(turn, []); // clears the pending indicator
        }
      } else {
        renderFollowups(turn, suggestFromChunks(hits), "Related topics");
      }
    } catch (err) {
      renderError(turn, err.message);
    } finally {
      busy = false;
      input.focus();
    }
  }

  // expose follow-up + regenerate handlers via event delegation
  thread.addEventListener("click", (e) => {
    const fu = e.target.closest("[data-followup]");
    if (fu) {
      ask(fu.textContent.trim());
      return;
    }
    const regen = e.target.closest("[data-regen]");
    if (regen && lastQuestion) ask(lastQuestion);
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      const text = copy.closest("[data-turn]").querySelector("[data-answer]")?.innerText || "";
      navigator.clipboard?.writeText(text);
      copy.classList.add("copied");
      setTimeout(() => copy.classList.remove("copied"), 1200);
    }
    const fb = e.target.closest("[data-feedback]");
    if (fb) {
      const row = fb.parentElement;
      row.querySelectorAll("[data-feedback]").forEach((b) => b.classList.remove("active"));
      fb.classList.add("active");
    }
  });
}

/* ---------------- rendering helpers ---------------- */

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function addUser(thread, text) {
  const row = el("div", "asst-user");
  row.append(el("div", "asst-bubble", escapeHtml(text)));
  thread.append(row);
  thread.scrollTop = thread.scrollHeight;
}

function addAssistantTurn(thread) {
  const turn = el("div", "asst-turn");
  turn.setAttribute("data-turn", "");
  turn.innerHTML = `
    <div class="asst-status" data-status></div>
    <div class="asst-sources" data-sources hidden></div>
    <div class="asst-answer" data-answer hidden></div>
    <div class="asst-followups" data-followups hidden></div>
    <div class="asst-feedback" data-feedback-row hidden></div>`;
  thread.append(turn);
  thread.scrollTop = thread.scrollHeight;
  return turn;
}

function setStatus(turn, text, spinning) {
  const s = turn.querySelector("[data-status]");
  s.innerHTML = `${spinning ? '<span class="asst-spinner"></span>' : searchIcon()} <span>${escapeHtml(text)}</span>`;
  s.hidden = false;
}

// Spinner + label placeholder inside a given area (answer / follow-ups). The
// first streamed token (or the rendered result) overwrites it.
function setPending(el, text) {
  if (!el) return;
  el.innerHTML = `<span class="asst-spinner"></span> <span class="asst-pending">${escapeHtml(text)}</span>`;
  el.hidden = false;
}

function renderProgress(thread, p) {
  // model-download progress is shown on the most recent turn's status line
  const turn = thread.querySelector("[data-turn]:last-child");
  if (!turn) return;
  if (p.file && p.total) {
    const pct = Math.round((p.loaded / p.total) * 100);
    setStatus(turn, `Loading model ${pct}%`, true);
  }
}

function renderSources(turn, hits) {
  const box = turn.querySelector("[data-sources]");
  box.innerHTML = hits
    .map(
      (h, i) =>
        `<a class="asst-source" href="${h.url}"><span class="asst-source-n">${i + 1}</span>` +
        `<span class="asst-source-h">${escapeHtml(h.heading || h.title)}</span>` +
        `<span class="asst-source-u">${escapeHtml(prettyPath(h.url))}</span></a>`
    )
    .join("");
  box.hidden = false;
}

function renderAnswerStream(turn, raw, hits) {
  const a = turn.querySelector("[data-answer]");
  a.innerHTML = renderMarkdown(cleanAnswer(raw), hits);
  a.hidden = false;
  const thread = turn.parentElement;
  thread.scrollTop = thread.scrollHeight;
}

function renderFollowups(turn, followups, label = "Suggested questions") {
  const fu = turn.querySelector("[data-followups]");
  if (!followups || !followups.length) {
    fu.hidden = true; // clears any pending indicator
    return;
  }
  fu.innerHTML =
    `<div class="asst-fu-label">${escapeHtml(label)}</div>` +
    followups
      .map((q) => `<button type="button" class="asst-fu" data-followup>${escapeHtml(q)}</button>`)
      .join("");
  fu.hidden = false;
  const thread = turn.parentElement;
  thread.scrollTop = thread.scrollHeight;
}

function finalizeAnswer(turn, answer, hits) {
  const a = turn.querySelector("[data-answer]");
  a.innerHTML = renderMarkdown(answer, hits);
  a.hidden = false;

  const row = turn.querySelector("[data-feedback-row]");
  row.innerHTML = `
    <button type="button" class="asst-fb" data-feedback aria-label="Helpful">${thumbIcon(true)}</button>
    <button type="button" class="asst-fb" data-feedback aria-label="Not helpful">${thumbIcon(false)}</button>
    <button type="button" class="asst-fb" data-copy aria-label="Copy answer">${copyIcon()}</button>
    <button type="button" class="asst-fb" data-regen aria-label="Regenerate">${regenIcon()}</button>`;
  row.hidden = false;
}

function renderError(target, message) {
  const turn = target.matches?.("[data-turn]") ? target : addAssistantTurn(target);
  const s = turn.querySelector("[data-status]") || turn;
  s.innerHTML = `<span class="asst-error">${escapeHtml(message)}</span>`;
  s.hidden = false;
}

/* ---------------- helpers ---------------- */

function prettyPath(url) {
  try {
    return new URL(url, location.origin).pathname;
  } catch {
    return url;
  }
}

/* ---------------- focus trap ---------------- */

function trapFocus(panel, e) {
  const f = panel.querySelectorAll(
    'a[href], button:not([disabled]), textarea, input, [tabindex]:not([tabindex="-1"])'
  );
  if (!f.length) return;
  const first = f[0];
  const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ---------------- icons ---------------- */
const stroke = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const searchIcon = () => `<svg width="14" height="14" viewBox="0 0 24 24" ${stroke}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`;
const copyIcon = () => `<svg width="15" height="15" viewBox="0 0 24 24" ${stroke}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`;
const regenIcon = () => `<svg width="15" height="15" viewBox="0 0 24 24" ${stroke}><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v5h-5"/></svg>`;
const thumbIcon = (up) => `<svg width="15" height="15" viewBox="0 0 24 24" ${stroke} style="transform:scaleY(${up ? 1 : -1})"><path d="M7 10v11"/><path d="M7 10l4-7a2 2 0 0 1 3 2l-1 5h5a2 2 0 0 1 2 2.3l-1.4 6A2 2 0 0 1 20.6 21H7"/></svg>`;
