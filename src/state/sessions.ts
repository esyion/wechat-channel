/**
 * Per-user Claude Agent SDK session ID map.
 *
 * Each WeChat user gets their own persistent Claude conversation.
 * The SDK's `resume: <sessionId>` option continues an existing conversation.
 */

import { JsonStore } from "./store.js";

type SessionMap = Record<string, string>; // userId → claudeSessionId

export class SessionStore {
  private store: JsonStore<SessionMap>;

  private constructor(store: JsonStore<SessionMap>) {
    this.store = store;
  }

  static async load(filePath: string): Promise<SessionStore> {
    const store = await JsonStore.load<SessionMap>(filePath, {});
    return new SessionStore(store);
  }

  get(userId: string): string | undefined {
    return this.store.snapshot()[userId];
  }

  async set(userId: string, claudeSessionId: string): Promise<void> {
    await this.store.update((cur) => ({ ...cur, [userId]: claudeSessionId }));
  }

  async clear(userId: string): Promise<void> {
    await this.store.update((cur) => {
      const next = { ...cur };
      delete next[userId];
      return next;
    });
  }

  async flush(): Promise<void> {
    await this.store.flush();
  }
}
