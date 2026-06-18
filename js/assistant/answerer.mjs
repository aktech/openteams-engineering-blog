// Pluggable generation backend. One interface, two implementations chosen by a
// single config flag. Retrieval is identical for both; only the final answer
// call differs.
//
//   backend: "browser"  -> the in-browser model, via the worker (default).
//   backend: "hosted"   -> an OpenAI-compatible /chat/completions endpoint
//                          (OpenAI, OpenRouter, Ollama, llama.cpp, ...).
//
// Each answerer exposes: generate(messages, onToken) -> Promise<fullText>.

function browserAnswerer(client) {
  return {
    label: "in-browser",
    generate: (messages, onToken) => client.generate(messages, onToken),
  };
}

function hostedAnswerer(cfg) {
  const base = cfg.baseURL.replace(/\/$/, "");
  return {
    label: "hosted",
    async generate(messages, onToken) {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          stream: true,
          temperature: 0,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`Hosted backend error: ${res.status} ${res.statusText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep the partial line
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              onToken(delta);
            }
          } catch {
            // ignore keep-alive / non-JSON lines
          }
        }
      }
      return full;
    },
  };
}

export function createAnswerer(cfg, client) {
  return cfg.backend === "hosted" ? hostedAnswerer(cfg) : browserAnswerer(client);
}
