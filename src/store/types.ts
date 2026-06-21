export interface Store {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Persist any pending in-memory writes. Called by channel.stop(). */
  flush(): Promise<void>;
}
