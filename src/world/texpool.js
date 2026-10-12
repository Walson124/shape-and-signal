import { generatePlanet, generateRing } from './planetgen.js';

// A small pool of texture workers. Falls back to the main thread if workers
// can't start (very old browsers, strict CSP).
class TexPool {
  constructor() {
    this.workers = [];
    this.queue = [];
    this.pending = new Map();
    this.seq = 0;
    this.failed = false;
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./texgen.worker.js', import.meta.url), { type: 'module' });
        w.busy = false;
        w.onmessage = (e) => this.onDone(w, e.data);
        w.onerror = () => {
          this.failed = true;
        };
        this.workers.push(w);
      }
    } catch {
      this.failed = true;
    }
  }

  run(kind, job) {
    if (this.failed || !this.workers.length) {
      return new Promise((resolve) => {
        setTimeout(() => resolve(kind === 'ring' ? generateRing(job) : generatePlanet(job)), 0);
      });
    }
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject, kind, job });
      this.queue.push({ id, kind, job });
      this.pump();
    });
  }

  pump() {
    for (const w of this.workers) {
      if (w.busy || !this.queue.length) continue;
      const task = this.queue.shift();
      w.busy = true;
      w.task = task.id;
      w.postMessage(task);
    }
  }

  onDone(w, { id, out, error }) {
    w.busy = false;
    const p = this.pending.get(id);
    this.pending.delete(id);
    if (p) {
      if (error) {
        // retry on the main thread
        setTimeout(() => p.resolve(p.kind === 'ring' ? generateRing(p.job) : generatePlanet(p.job)), 0);
      } else {
        p.resolve(out);
      }
    }
    this.pump();
  }
}

export const texPool = new TexPool();
