import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Store } from "./types.js";

interface FileState {
  data: Record<string, string>;
}

export class JsonFileStore implements Store {
  private state: FileState = { data: {} };
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = this.doLoad();
    return this.loading;
  }

  private loading!: Promise<void>;

  private async doLoad(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<FileState>;
      this.state = { data: { ...(parsed.data ?? {}) } };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      this.state = { data: {} };
    }
    this.loaded = true;
  }

  private serialize(): string {
    return JSON.stringify(this.state);
  }

  async get(key: string): Promise<string | undefined> {
    await this.load();
    return this.state.data[key];
  }

  async set(key: string, value: string): Promise<void> {
    await this.load();
    this.state.data[key] = value;
    this.writing = this.writing.then(() => this.persist());
    await this.writing;
  }

  async delete(key: string): Promise<void> {
    await this.load();
    delete this.state.data[key];
    this.writing = this.writing.then(() => this.persist());
    await this.writing;
  }

  async flush(): Promise<void> {
    await this.writing;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, this.serialize(), "utf-8");
    await writeFile(this.filePath, this.serialize(), "utf-8");
  }
}
