/**
 * Per-user context_token map. Persisted to disk so the long-poll cursor and
 * outbound send references survive restarts.
 */

import { JsonStore } from "./store.js";

type TokenMap = Record<string, string>; // userId → contextToken

export class ContextTokenStore {
  private store: JsonStore<TokenMap>;

  private constructor(store: JsonStore<TokenMap>) {
    this.store = store;
  }

  static async load(filePath: string): Promise<ContextTokenStore> {
    const store = await JsonStore.load<TokenMap>(filePath, {});
    return new ContextTokenStore(store);
  }

  async set(userId: string, token: string): Promise<void> {
    await this.store.update((cur) => ({ ...cur, [userId]: token }));
  }

  get(userId: string): string | undefined {
    return this.store.snapshot()[userId];
  }

  delete(userId: string): Promise<void> {
    return this.store.update((cur) => {
      const next = { ...cur };
      delete next[userId];
      return next;
    });
  }

  async flush(): Promise<void> {
    await this.store.flush();
  }
}
