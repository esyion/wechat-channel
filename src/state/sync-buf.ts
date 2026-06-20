/**
 * Long-poll cursor persistence. One cursor per bot account.
 */

import { JsonStore } from "./store.js";

interface SyncBufData {
  get_updates_buf: string;
}

export class SyncBufStore {
  private store: JsonStore<SyncBufData>;

  private constructor(store: JsonStore<SyncBufData>) {
    this.store = store;
  }

  static async load(filePath: string): Promise<SyncBufStore> {
    const store = await JsonStore.load<SyncBufData>(filePath, { get_updates_buf: "" });
    return new SyncBufStore(store);
  }

  get(): string {
    return this.store.snapshot().get_updates_buf;
  }

  async set(buf: string): Promise<void> {
    await this.store.update((cur) => ({ ...cur, get_updates_buf: buf }));
  }

  async flush(): Promise<void> {
    await this.store.flush();
  }
}
