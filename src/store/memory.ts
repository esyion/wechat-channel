import type { Store } from "./types.js";

/**
 * In-process `Map`-backed `Store`. Useful for tests and ephemeral bots.
 *
 * Data does not survive process restart. `flush()` is a no-op since all
 * writes are synchronous.
 */
export class MemoryStore implements Store {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.map.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async flush(): Promise<void> {
    // No-op: all writes are synchronous.
  }
}
