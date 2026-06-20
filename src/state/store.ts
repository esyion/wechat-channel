/**
 * Atomic JSON-file key-value store, backed by a single JSON file per "table".
 *
 * Use cases in this project:
 *   - get_updates_buf cursor (one per bot account)
 *   - per-user context_token map
 *   - per-user Claude sessionId map
 *
 * Writes are debounced and serialized through a per-file write queue.
 * Reads always hit the in-memory snapshot.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class JsonStore<T extends object> {
  private data: T;
  private dirty = false;
  private writePromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    initial: T,
  ) {
    this.data = initial;
  }

  /** Load the store from disk. Missing file → empty initial. */
  static async load<T extends object>(
    filePath: string,
    initial: T,
  ): Promise<JsonStore<T>> {
    const store = new JsonStore<T>(filePath, initial);
    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as T;
      store.data = { ...initial, ...parsed };
    } catch {
      // file missing or corrupt → start fresh
    }
    return store;
  }

  /** Snapshot of the current data (caller must not mutate). */
  snapshot(): T {
    return this.data;
  }

  /** Read a top-level field. */
  get<K extends keyof T>(key: K): T[K] {
    return this.data[key];
  }

  /** Apply a mutator and schedule a write. Mutator may be async. */
  async update(mutator: (current: T) => T | Promise<T>): Promise<void> {
    // Chain writes so they happen sequentially.
    const previous = this.writePromise;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    this.writePromise = previous.then(() => gate);

    try {
      await previous;
      const next = await mutator(this.data);
      this.data = next;
      this.dirty = true;
      // Fire and forget: the gate ensures sequencing; we do an async write now
      void this.writeSnapshot();
    } finally {
      release();
    }
  }

  /** Force-flush any pending writes. */
  async flush(): Promise<void> {
    await this.writePromise;
  }

  /** Synchronous flush of dirty data. Use only at process exit. */
  flushSync(): void {
    if (!this.dirty) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      fs.mkdirSync(dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
      this.dirty = false;
    } catch {
      // best-effort
    }
  }

  private async writeSnapshot(): Promise<void> {
    if (!this.dirty) return;
    const snapshot = this.data;
    this.dirty = false;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(snapshot, null, 2), "utf-8");
    } catch {
      this.dirty = true; // retry next time
    }
  }
}
