import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { BotCredentials, BotCredentialStore } from "./types.js";

type BotMap = Record<string, BotCredentials>;

/**
 * 默认凭证持久化：明文扁平 JSON（<stateDir>/bots.json）。
 *
 * ⚠️ botToken 是敏感登录态，此处明文存盘（与库现状 store.json 同水位）。
 * 生产环境建议传入自定义 BotCredentialStore 接入加密存储。
 *
 * 写串行化：每次 save/delete 读全量→改→原子写（.tmp swap），调用方
 * 顺序 await 即可（manager 的 add 本就顺序）。
 */
export class JsonBotCredentialStore implements BotCredentialStore {
  constructor(private readonly filePath: string) {}

  private async readAll(): Promise<BotMap> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf-8")) as BotMap;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      return {};
    }
  }

  private async writeAll(map: BotMap): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const body = JSON.stringify(map);
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, body, "utf-8");
    await writeFile(this.filePath, body, "utf-8");
  }

  async save(botId: string, creds: BotCredentials): Promise<void> {
    const map = await this.readAll();
    map[botId] = creds;
    await this.writeAll(map);
  }

  async load(botId: string): Promise<BotCredentials | undefined> {
    return (await this.readAll())[botId];
  }

  async list(): Promise<Array<{ botId: string; creds: BotCredentials }>> {
    const map = await this.readAll();
    return Object.entries(map).map(([botId, creds]) => ({ botId, creds }));
  }

  async delete(botId: string): Promise<void> {
    const map = await this.readAll();
    delete map[botId];
    await this.writeAll(map);
  }
}
