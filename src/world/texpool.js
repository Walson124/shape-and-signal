import { generatePlanet, generateRing } from './planetgen.js';
import { buildChunk } from './chunkgen.js';
import { buildVoxelCell } from './voxel.js';

const RUN = { ring: generateRing, chunk: buildChunk, planet: generatePlanet, voxel: buildVoxelCell };

// Worker pool for texture and terrain generation. Jobs may carry a priority
// function (lower runs first) and a cancelled() check. Falls back to the main
// thread if workers can't start.
class WorkerPool {
  constructor() {
    this.workers = [];
    this.queue = [];
    this.pending = new Map();
    this.seq = 0;
    this.failed = false;
    const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./texgen.worker.js', import.meta.url), { type: 'module' });
        w.busy = false;
        w.onmessage = (e) => this.onDone(w, e.data);
        w.onerror = () => { this.failed = true; };
        this.workers.push(w);
      }
    } catch {
      this.failed = true;
    }
  }

  get busy() {
    return this.queue.length + this.workers.filter((w) => w.busy).length;
  }

  run(kind, job, opts = {}) {
    if (this.failed || !this.workers.length) {
      return new Promise((resolve) => setTimeout(() => resolve(RUN[kind](job)), 0));
    }
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const task = { id, kind, job, priority: opts.priority || null, cancelled: opts.cancelled || null, resolve, reject };
      this.pending.set(id, task);
      this.queue.push(task);
      this.pump();
    });
  }

  pump() {
    for (const w of this.workers) {
      if (w.busy) continue;
      // drop cancelled tasks
      this.queue = this.queue.filter((t) => {
        if (t.cancelled && t.cancelled()) {
          this.pending.delete(t.id);
          t.resolve(null);
          return false;
        }
        return true;
      });
      if (!this.queue.length) return;
      let bi = 0, bp = Infinity;
      for (let i = 0; i < this.queue.length; i++) {
        const p = this.queue[i].priority ? this.queue[i].priority() : -1;
        if (p < bp) { bp = p; bi = i; }
      }
      const task = this.queue.splice(bi, 1)[0];
      w.busy = true;
      w.postMessage({ id: task.id, kind: task.kind, job: task.job });
    }
  }

  onDone(w, { id, out, error }) {
    w.busy = false;
    const t = this.pending.get(id);
    this.pending.delete(id);
    if (t) {
      if (error) {
        console.warn('worker job failed, retrying on main thread', error);
        try { t.resolve(RUN[t.kind](t.job)); } catch (e) { t.reject(e); }
      } else {
        t.resolve(out);
      }
    }
    this.pump();
  }
}

export const texPool = new WorkerPool();
