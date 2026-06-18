// Main-thread wrapper around the Ask Assistant worker. Promise-based requests
// with token streaming, plus model-download progress events.

export class WorkerClient {
  constructor(workerUrl) {
    this.worker = new Worker(workerUrl, { type: "module" });
    this.seq = 0;
    this.pending = new Map(); // id -> { resolve, reject, onToken }
    this.progressHandlers = new Set();
    this.worker.onmessage = (e) => this._handle(e.data);
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || "worker error"));
      this.pending.clear();
    };
  }

  onProgress(fn) {
    this.progressHandlers.add(fn);
  }

  _handle(msg) {
    if (msg.type === "progress") {
      for (const fn of this.progressHandlers) fn(msg);
      return;
    }
    if (msg.type === "ready") {
      const p = this.pending.get("warmup");
      if (p) { this.pending.delete("warmup"); p.resolve(); }
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.type === "token") {
      if (p.onToken) p.onToken(msg.text);
    } else if (msg.type === "queryVector") {
      this.pending.delete(msg.id);
      p.resolve(msg.vector);
    } else if (msg.type === "generated") {
      this.pending.delete(msg.id);
      p.resolve(msg.text);
    } else if (msg.type === "error") {
      this.pending.delete(msg.id);
      p.reject(new Error(msg.message));
    }
  }

  warmup(needGenerator) {
    return new Promise((resolve, reject) => {
      this.pending.set("warmup", { resolve, reject });
      this.worker.postMessage({ type: "warmup", needGenerator });
    });
  }

  embedQuery(text) {
    const id = `q${this.seq++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: "embedQuery", id, text });
    });
  }

  generate(messages, onToken) {
    const id = `g${this.seq++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onToken });
      this.worker.postMessage({ type: "generate", id, messages });
    });
  }
}
