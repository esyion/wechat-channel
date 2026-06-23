/**
 * Key-value persistence for channel state (sync cursor, per-user context tokens,
 * and anything else the library needs to survive a restart).
 *
 * All values are strings — JSON-serialize your own structures. The library
 * calls `flush()` during `channel.stop()` so pending writes are durable
 * before the process exits.
 *
 * Two built-in implementations are exported:
 * - {@link JsonFileStore} — atomic writes to a single JSON file (default for production)
 * - {@link MemoryStore} — in-process Map (testing only)
 */
export interface Store {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Persist any pending in-memory writes. Called by channel.stop(). */
  flush(): Promise<void>;
}
