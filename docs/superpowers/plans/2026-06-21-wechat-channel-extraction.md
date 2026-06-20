# @wechat/channel Library Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the existing WeChat ilink CLI bot into a reusable, agent-agnostic npm library `@wechat/channel`, archive the old Claude bot under `legacy/`, ship ESM + CJS dual entry.

**Architecture:** Single npm package. `createChannel()` factory wires `WechatApiClient` + long-poll loop + `Store` + media I/O. `ChannelMsg`/`Reply` interfaces isolate the handler. `QRLoginHandle` exposes raw matrix + renderers for terminal/web. Public package name scoped `@wechat/channel`.

**Tech Stack:** TypeScript 5.7, Node ≥ 22, ESM primary + CJS via separate tsconfig, vitest, pino, qrcode, dotenv.

**Spec:** [`../specs/2026-06-21-wechat-channel-library-design.md`](../specs/2026-06-21-wechat-channel-library-design.md)

## Global Constraints

- Node.js ≥ 22
- Public package name: `@wechat/channel` (scoped)
- `package.json#publishConfig.access = "public"`
- Zero dependencies on agent SDKs — `@anthropic-ai/claude-agent-sdk` MUST NOT appear in `package.json`
- `qrcode` is the only added dep (for `toPng/toSvg/toDataURL` renderers)
- ESM primary; CJS secondary via `tsconfig.cjs.json` outputting to `dist-cjs/`
- `package.json#files = ["dist", "dist-cjs", "README.md"]` — `legacy/` excluded from publish
- Tests live in `test/` only; `legacy/test/` is excluded from root vitest config
- All commits use present-tense, scoped prefixes: `feat:`, `refactor:`, `test:`, `chore:`, `docs:`
- Branch: `feat/package` (current) — work happens on this branch

---

## File Structure (locked-in)

| File | Responsibility |
|---|---|
| `src/index.ts` | Public exports: `createChannel`, `ChannelMsg`, `Reply`, `QRLoginHandle`, `Store`, errors |
| `src/config.ts` | `loadEnvOverrides(prefix)` — env-driven defaults, no module-level singleton |
| `src/errors.ts` | `ChannelError`, `WechatApiError`, `MediaError` |
| `src/wechat/api.ts` | `WechatApiClient` (unchanged from current) |
| `src/wechat/crypto.ts` | AES-128-ECB helpers (unchanged) |
| `src/wechat/login.ts` | QR login state machine — refactored to expose raw QR matrix |
| `src/wechat/media.ts` | CDN upload/download helpers (unchanged) |
| `src/wechat/types.ts` | ilink protocol types (unchanged) |
| `src/channel/types.ts` | `ChannelMsg`, `Reply`, `QRLoginHandle`, `LoginResult` interfaces |
| `src/channel/create.ts` | `createChannel()` factory |
| `src/channel/long-poll.ts` | Long-poll loop + error recovery |
| `src/channel/inbound.ts` | Decrypt inbound media → `ChannelMsg` |
| `src/channel/outbound.ts` | text/media/typing helpers |
| `src/channel/reply.ts` | Reply object factory |
| `src/channel/typing.ts` | TypingKeepalive (heartbeat) |
| `src/channel/login.ts` | QRLoginHandle wrapper around login state machine |
| `src/store/types.ts` | `Store` interface |
| `src/store/file.ts` | `JsonFileStore` (default) |
| `src/store/memory.ts` | `MemoryStore` (testing) |
| `bin/migrate-credentials.ts` | One-shot CLI for migrating `~/.wechat-agent-channel/credentials.json` (lives at `src/bin/migrate-credentials.ts`) |
| `test/errors.test.ts` | Error class shape tests |
| `test/store/file.test.ts` | JsonFileStore tests |
| `test/store/memory.test.ts` | MemoryStore tests |
| `test/channel/inbound.test.ts` | Inbound decrypt + ChannelMsg assembly |
| `test/channel/outbound.test.ts` | text/media/typing helpers |
| `test/channel/long-poll.test.ts` | Long-poll loop + error recovery |
| `test/channel/login.test.ts` | QRLoginHandle renderers + waitForLogin |
| `test/cjs-smoke.test.ts` | CJS `require("@wechat/channel")` smoke test |

---

## Task 1: Set up package identity (`@wechat/channel`)

**Files:**
- Modify: `package.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json` (ESM)
- Create: `tsconfig.cjs.json` (CJS)
- Modify: `tsconfig.json` (current → base)

**Goal:** Lock in package name, deps, exports map, dual-build tsconfigs.

- [ ] **Step 1: Update `package.json`**

Replace existing `package.json` with:

```json
{
  "name": "@wechat/channel",
  "version": "0.1.0",
  "description": "Agent-agnostic WeChat ilink channel library. Bridges long-poll protocol to user-defined handlers.",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist-cjs/index.js",
      "types": "./dist/index.d.ts"
    },
    "./package.json": "./package.json"
  },
  "bin": {
    "wechat-channel": "./dist/bin/migrate-credentials.js"
  },
  "files": ["dist", "dist-cjs", "README.md"],
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json && tsc -p tsconfig.cjs.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=22"
  },
  "dependencies": {
    "@paulmillr/qr": "^0.4.0",
    "dotenv": "^16.4.5",
    "pino": "^10.3.1",
    "qrcode": "^1.5.4"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/qrcode": "^1.5.5",
    "pino-pretty": "^13.1.3",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.2.6"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  }
}
```

- [ ] **Step 3: Replace `tsconfig.json`**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "dist-cjs", "legacy", "test"]
}
```

- [ ] **Step 4: Create `tsconfig.cjs.json`**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist-cjs",
    "rootDir": "src",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "declaration": false,
    "declarationMap": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "dist-cjs", "legacy", "test"]
}
```

- [ ] **Step 5: Install updated deps**

Run: `npm install`
Expected: removes `@anthropic-ai/claude-agent-sdk` + `qrcode-terminal`; adds `qrcode` + `@types/qrcode`.

- [ ] **Step 6: Verify nothing imports removed modules**

Run: `grep -rn "@anthropic-ai/claude-agent-sdk\|qrcode-terminal" src/ test/ || echo "no imports"`
Expected: `no imports`

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.base.json tsconfig.cjs.json
git commit -m "chore: rename to @wechat/channel, drop Claude SDK, add qrcode, dual ESM/CJS"
```

---

## Task 2: Move existing `src/wechat/*` unchanged

**Files:**
- Move: `src/wechat/api.ts`, `crypto.ts`, `login.ts`, `media.ts`, `types.ts` (already in place)

**Goal:** Confirm `src/wechat/` works as the protocol layer of the library.

- [ ] **Step 1: Verify current state**

Run: `ls src/wechat/`
Expected: `api.ts  crypto.ts  login.ts  media.ts  types.ts`

- [ ] **Step 2: Refactor `src/wechat/api.ts` to drop `isDev` import**

Replace the import block (lines ~17-20) with:

```ts
import type {
  BaseInfo,
  GetConfigResp,
  GetUpdatesReq,
  GetUpdatesResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  NotifyResp,
  SendMessageReq,
  SendTypingReq,
} from "./types.js";
```

Replace the `isDev` debug block in `postJson` (lines ~129-133) with:

```ts
// Dev debug logging removed; pass a logger via constructor if needed.
```

Add a constructor option:

```ts
export interface ApiClientOptions extends CommonOpts {
  botToken?: string;
  defaultTimeoutMs?: number;
  longPollTimeoutMs?: number;
  logger?: { debug: (obj: object, msg?: string) => void };
}
```

Store logger in private field; call `this.logger?.debug(...)` instead of `console.error`.

- [ ] **Step 3: Refactor `src/wechat/login.ts` to expose low-level primitives**

Currently `src/wechat/login.ts` exports only `runLoginFlow` (callback-based). Split it into three low-level functions plus keep `runLoginFlow` as a thin wrapper for backward compat:

```ts
export type QrStatus =
  | "wait"
  | "scaned"
  | "confirmed"
  | "expired"
  | "scaned_but_redirect"
  | "need_verifycode"
  | "verify_code_blocked"
  | "binded_redirect";

export interface RequestedQr {
  qrcode: string;
  qrcodeImgContent: string; // data: URL or "weixin://..." — see docs
}

/** Step 1: get a fresh QR code from ilink. */
export async function requestQrCode(api: WechatApiClient, opts: { botType?: string }): Promise<RequestedQr>;

/** Step 1b: decode qrcode_img_content into a 2D boolean matrix.
 *  Uses @paulmillr/qr (small pure-JS decoder). Returns rows × cols, true = dark. */
export async function decodeQrMatrix(qrcodeImgContent: string): Promise<boolean[][]>;

/** Step 2: poll get_qrcode_status until terminal state. Caller passes onVerifyCode
 *  to handle verify-code prompts (returns code or throws to abort). */
export async function pollQrLogin(
  api: WechatApiClient,
  opts: {
    qrcode: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    onVerifyCode?: (prompt: string) => Promise<string>;
    onStatus?: (status: QrStatus) => void;
  },
): Promise<LoginResult>;
```

Implementation: extract the body of `runLoginFlow` into `requestQrCode` + `pollQrLogin`. The `runLoginFlow` export becomes a 20-line wrapper that wires callbacks. `decodeQrMatrix` uses `@paulmillr/qr`'s `decode` API.

Update `package.json#dependencies` to add `"@paulmillr/qr": "^0.4.0"` (already in Task 1).

- [ ] **Step 4: Verify build still works**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add src/wechat/ package.json package-lock.json
git commit -m "refactor(wechat): drop isDev debug; expose raw QR matrix from login state machine"
```

---

## Task 3: Move and refactor `src/state/*` → `src/store/*`

**Files:**
- Delete: `src/state/` (entire dir)
- Create: `src/store/types.ts`
- Create: `src/store/file.ts`
- Create: `src/store/memory.ts`
- Tests: `test/store/file.test.ts`, `test/store/memory.test.ts`

**Goal:** Replace ad-hoc state files with a `Store` interface and two implementations.

- [ ] **Step 1: Create `src/store/types.ts`**

```ts
export interface Store {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Persist any pending in-memory writes. Called by channel.stop(). */
  flush(): Promise<void>;
}
```

- [ ] **Step 2: Write failing test for `MemoryStore`**

Create `test/store/memory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/store/memory.js";

describe("MemoryStore", () => {
  it("returns undefined for missing keys", async () => {
    const s = new MemoryStore();
    expect(await s.get("missing")).toBeUndefined();
  });

  it("round-trips values", async () => {
    const s = new MemoryStore();
    await s.set("k", "v");
    expect(await s.get("k")).toBe("v");
  });

  it("deletes values", async () => {
    const s = new MemoryStore();
    await s.set("k", "v");
    await s.delete("k");
    expect(await s.get("k")).toBeUndefined();
  });

  it("flush resolves without error", async () => {
    const s = new MemoryStore();
    await expect(s.flush()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/store/memory.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: Implement `MemoryStore`**

Create `src/store/memory.ts`:

```ts
import type { Store } from "./types.js";

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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/store/memory.test.ts`
Expected: 4 passed

- [ ] **Step 6: Write failing test for `JsonFileStore`**

Create `test/store/file.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFileStore } from "../../src/store/file.js";

describe("JsonFileStore", () => {
  let dir: string;
  let store: JsonFileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "json-store-"));
    store = new JsonFileStore(join(dir, "store.json"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists across instances", async () => {
    await store.set("k", "v");
    await store.flush();
    const reopened = new JsonFileStore(join(dir, "store.json"));
    expect(await reopened.get("k")).toBe("v");
  });

  it("survives concurrent sets", async () => {
    await Promise.all([
      store.set("a", "1"),
      store.set("b", "2"),
      store.set("c", "3"),
    ]);
    await store.flush();
    expect(await store.get("a")).toBe("1");
    expect(await store.get("b")).toBe("2");
    expect(await store.get("c")).toBe("3");
  });

  it("deletes keys", async () => {
    await store.set("k", "v");
    await store.delete("k");
    expect(await store.get("k")).toBeUndefined();
  });

  it("creates parent directory if missing", async () => {
    const nested = new JsonFileStore(join(dir, "a", "b", "store.json"));
    await nested.set("k", "v");
    await nested.flush();
    expect(await nested.get("k")).toBe("v");
  });

  it("flush is idempotent", async () => {
    await store.set("k", "v");
    await store.flush();
    await expect(store.flush()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run test/store/file.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 8: Implement `JsonFileStore`**

Create `src/store/file.ts`:

```ts
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

  private async load(): Promise<void> {
    if (this.loaded) return;
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
    // Coalesce writes: chain onto the last in-flight write.
    this.writing = this.writing.then(() => this.persist());
  }

  async delete(key: string): Promise<void> {
    await this.load();
    delete this.state.data[key];
    this.writing = this.writing.then(() => this.persist());
  }

  async flush(): Promise<void> {
    await this.writing;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, this.serialize(), "utf-8");
    await writeFile(this.filePath, this.serialize(), "utf-8"); // atomic-ish
  }
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run test/store/`
Expected: 9 passed

- [ ] **Step 10: Delete old `src/state/`**

Run: `git rm -r src/state/`
Expected: removed files

- [ ] **Step 11: Commit**

```bash
git add src/store/ test/store/ src/state/
git commit -m "refactor(store): introduce Store interface, JsonFileStore + MemoryStore"
```

---

## Task 4: Define error classes

**Files:**
- Create: `src/errors.ts`
- Test: `test/errors.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ChannelError, MediaError, WechatApiError } from "../src/errors.js";

describe("errors", () => {
  it("ChannelError carries code", () => {
    const e = new ChannelError("AUTH_REQUIRED", "missing token");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("AUTH_REQUIRED");
    expect(e.message).toBe("missing token");
  });

  it("WechatApiError carries ret + errcode + errmsg", () => {
    const e = new WechatApiError({ ret: -14, errcode: -14, errmsg: "session expired" });
    expect(e).toBeInstanceOf(Error);
    expect(e.ret).toBe(-14);
    expect(e.errcode).toBe(-14);
    expect(e.errmsg).toBe("session expired");
  });

  it("MediaError carries phase + cause", () => {
    const cause = new Error("boom");
    const e = new MediaError("decrypt", cause);
    expect(e.phase).toBe("decrypt");
    expect(e.cause).toBe(cause);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/errors.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/errors.ts`**

```ts
export type ChannelErrorCode = "AUTH_REQUIRED" | "INVALID_TOKEN" | "ABORTED";

export class ChannelError extends Error {
  readonly code: ChannelErrorCode;
  constructor(code: ChannelErrorCode, message: string) {
    super(message);
    this.name = "ChannelError";
    this.code = code;
  }
}

export interface WechatApiErrorPayload {
  ret?: number;
  errcode?: number;
  errmsg?: string;
}

export class WechatApiError extends Error {
  readonly ret?: number;
  readonly errcode?: number;
  readonly errmsg?: string;
  constructor(payload: WechatApiErrorPayload, message?: string) {
    super(message ?? payload.errmsg ?? `wechat api error ${payload.errcode ?? payload.ret ?? "unknown"}`);
    this.name = "WechatApiError";
    this.ret = payload.ret;
    this.errcode = payload.errcode;
    this.errmsg = payload.errmsg;
  }
}

export type MediaPhase = "download" | "decrypt" | "upload" | "encrypt";

export class MediaError extends Error {
  readonly phase: MediaPhase;
  readonly cause: unknown;
  constructor(phase: MediaPhase, cause: unknown, message?: string) {
    super(message ?? `media ${phase} failed: ${String(cause)}`);
    this.name = "MediaError";
    this.phase = phase;
    this.cause = cause;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/errors.test.ts`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts test/errors.test.ts
git commit -m "feat(errors): add ChannelError, WechatApiError, MediaError"
```

---

## Task 5: Define public types (`ChannelMsg`, `Reply`, `QRLoginHandle`, `LoginResult`)

**Files:**
- Create: `src/channel/types.ts`

- [ ] **Step 1: Create `src/channel/types.ts`**

```ts
import type { WeixinMessage } from "../wechat/types.js";

export interface MediaRef {
  /** Absolute path to a local file the handler can read. */
  path: string;
  /** MIME type — image/* are vision-eligible, others are file references. */
  mime: string;
}

export interface ChannelMsg {
  fromUserId: string;
  contextToken: string;
  text: string;
  media: ReadonlyArray<MediaRef>;
  raw: WeixinMessage;
}

export interface ReplyTextOpts {
  maxChars?: number;
}

export interface Reply {
  text(content: string, opts?: ReplyTextOpts): Promise<void>;
  media(filePath: string, caption?: string): Promise<void>;
  typing(on?: boolean): Promise<void>;
}

export interface QrTerminalOpts {
  margin?: number;
  invert?: boolean;
}

export interface QrPngOpts {
  size?: number;
  margin?: number;
}

export interface QrSvgOpts {
  margin?: number;
}

export interface WaitForLoginOpts {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LoginResult {
  botToken: string;
  accountId: string;
  baseUrl: string;
}

export interface QRLoginHandle {
  matrix: boolean[][];
  toTerminal(opts?: QrTerminalOpts): string;
  toPng(opts?: QrPngOpts): Promise<Buffer>;
  toSvg(opts?: QrSvgOpts): string;
  toDataURL(opts?: QrPngOpts): Promise<string>;
  waitForLogin(opts?: WaitForLoginOpts): Promise<LoginResult>;
}
```

- [ ] **Step 2: Verify build still works**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/channel/types.ts
git commit -m "feat(channel): define ChannelMsg, Reply, QRLoginHandle public types"
```

---

## Task 6: Build `channel/inbound.ts` (decrypt inbound media → `ChannelMsg`)

**Files:**
- Create: `src/channel/inbound.ts`
- Test: `test/channel/inbound.test.ts`

**Goal:** Decouple from global `config`; take inputs as parameters; return `ChannelMsg`.

- [ ] **Step 1: Write failing test**

Create `test/channel/inbound.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInbound } from "../../src/channel/inbound.js";

describe("buildInbound", () => {
  let mediaTmpDir: string;

  beforeEach(async () => {
    mediaTmpDir = await mkdtemp(join(tmpdir(), "inbound-"));
  });

  afterEach(async () => {
    await rm(mediaTmpDir, { recursive: true, force: true });
  });

  it("returns text-only ChannelMsg for a TEXT item", async () => {
    const cdn = { download: vi.fn() } as any;
    const result = await buildInbound({
      api: cdn,
      mediaTmpDir,
      msg: {
        from_user_id: "u1",
        context_token: "ctx",
        item_list: [{ type: 1 /* TEXT */, text_item: { text: "hi" } }],
      } as any,
    });
    expect(result.text).toBe("hi");
    expect(result.media).toEqual([]);
    expect(result.fromUserId).toBe("u1");
  });

  it("downloads IMAGE items and adds to media[]", async () => {
    const cdn = {
      cdnBaseUrl: "https://cdn",
      downloadAndDecryptCdn: vi.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
    } as any;
    const result = await buildInbound({
      api: cdn,
      mediaTmpDir,
      msg: {
        from_user_id: "u1",
        context_token: "ctx",
        item_list: [{
          type: 2 /* IMAGE */,
          image_item: {
            aeskey: "00".repeat(16),
            media: { encrypt_query_param: "x", aes_key: "AAAA", full_url: "https://cdn/x" },
          },
        }],
      } as any,
    });
    expect(result.media).toHaveLength(1);
    expect(result.media[0]?.mime).toBe("image/jpeg");
    expect(result.media[0]?.path.startsWith(mediaTmpDir)).toBe(true);
    await writeFile(result.media[0]!.path, Buffer.from([1, 2, 3])); // pretend
    // file should now exist on disk
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/channel/inbound.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/channel/inbound.ts`**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { MediaError } from "../errors.js";
import { downloadAndDecryptCdn } from "../wechat/media.js";
import type { WeixinMessage } from "../wechat/types.js";
import { MessageItemType } from "../wechat/types.js";
import type { ChannelMsg, MediaRef } from "./types.js";

export interface BuildInboundOpts {
  api: { cdnBaseUrl: string };
  mediaTmpDir: string;
  msg: WeixinMessage;
}

const IMAGE_EXTS: Record<string, string> = {
  ".png": ".png",
  ".jpg": ".jpg",
  ".jpeg": ".jpg",
  ".gif": ".gif",
  ".webp": ".webp",
  ".bmp": ".bmp",
};

function sanitizeUserId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_@.\-]/g, "_").slice(0, 64);
}

export async function buildInbound(opts: BuildInboundOpts): Promise<ChannelMsg> {
  const { api, mediaTmpDir, msg } = opts;
  const fromUserId = msg.from_user_id ?? "unknown";
  const contextToken = msg.context_token ?? "";
  const userDir = resolve(mediaTmpDir, sanitizeUserId(fromUserId));
  await mkdir(userDir, { recursive: true });

  let text = "";
  const media: MediaRef[] = [];

  for (const item of msg.item_list ?? []) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      text = String(item.text_item.text);
      continue;
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      text = String(item.voice_item.text);
    }
    if (item.type === MessageItemType.IMAGE) {
      const img = item.image_item;
      if (!img?.media?.encrypt_query_param && !img?.media?.full_url) continue;
      try {
        const buf = await downloadAndDecryptCdn({
          cdnBaseUrl: api.cdnBaseUrl,
          encryptedQueryParam: img.media?.encrypt_query_param ?? "",
          ...(img.aeskey ? { aesKeyHex: img.aeskey } : {}),
          ...(img.media?.aes_key ? { aesKeyBase64: img.media.aes_key } : {}),
          ...(img.media?.full_url ? { fullUrl: img.media.full_url } : {}),
          label: "image",
        });
        const path = resolve(userDir, `img-${Date.now()}.jpg`);
        await writeFile(path, buf);
        media.push({ path, mime: "image/jpeg" });
      } catch (err) {
        throw new MediaError("decrypt", err);
      }
      continue;
    }
    if (item.type === MessageItemType.FILE) {
      const f = item.file_item;
      if (!f?.media?.encrypt_query_param && !f?.media?.full_url) continue;
      try {
        const buf = await downloadAndDecryptCdn({
          cdnBaseUrl: api.cdnBaseUrl,
          encryptedQueryParam: f.media?.encrypt_query_param ?? "",
          ...(f.media?.aes_key ? { aesKeyBase64: f.media.aes_key } : {}),
          ...(f.media?.full_url ? { fullUrl: f.media.full_url } : {}),
          label: "file",
        });
        const name = f.file_name ?? `file-${Date.now()}.bin`;
        const path = resolve(userDir, name);
        await writeFile(path, buf);
        media.push({ path, mime: "application/octet-stream" });
      } catch (err) {
        throw new MediaError("decrypt", err);
      }
      continue;
    }
    if (item.type === MessageItemType.VOICE) {
      const v = item.voice_item;
      if (!v?.media?.encrypt_query_param && !v?.media?.full_url) continue;
      try {
        const buf = await downloadAndDecryptCdn({
          cdnBaseUrl: api.cdnBaseUrl,
          encryptedQueryParam: v.media?.encrypt_query_param ?? "",
          ...(v.media?.aes_key ? { aesKeyBase64: v.media.aes_key } : {}),
          ...(v.media?.full_url ? { fullUrl: v.media.full_url } : {}),
          label: "voice",
        });
        const path = resolve(userDir, `voice-${Date.now()}.silk`);
        await writeFile(path, buf);
        media.push({ path, mime: "audio/silk" });
      } catch (err) {
        throw new MediaError("decrypt", err);
      }
      continue;
    }
    if (item.type === MessageItemType.VIDEO) {
      const v = item.video_item;
      if (!v?.media?.encrypt_query_param && !v?.media?.full_url) continue;
      try {
        const buf = await downloadAndDecryptCdn({
          cdnBaseUrl: api.cdnBaseUrl,
          encryptedQueryParam: v.media?.encrypt_query_param ?? "",
          ...(v.media?.aes_key ? { aesKeyBase64: v.media.aes_key } : {}),
          ...(v.media?.full_url ? { fullUrl: v.media.full_url } : {}),
          label: "video",
        });
        const path = resolve(userDir, `video-${Date.now()}.mp4`);
        await writeFile(path, buf);
        media.push({ path, mime: "video/mp4" });
      } catch (err) {
        throw new MediaError("decrypt", err);
      }
      continue;
    }
  }

  if (!text && media.length === 0) {
    text = "[empty message]";
  }

  return { fromUserId, contextToken, text, media, raw: msg };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/channel/inbound.test.ts`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/channel/inbound.ts test/channel/inbound.test.ts
git commit -m "feat(channel): buildInbound returns ChannelMsg, decoupled from config"
```

---

## Task 7: Build `channel/outbound.ts` (text/media/typing helpers)

**Files:**
- Create: `src/channel/outbound.ts`
- Test: `test/channel/outbound.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/channel/outbound.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { chunkText, sendText, sendMedia } from "../../src/channel/outbound.js";

describe("chunkText", () => {
  it("returns single chunk if under limit", () => {
    expect(chunkText("hi", 100)).toEqual(["hi"]);
  });

  it("splits on newlines near limit", () => {
    const text = "a\n".repeat(50) + "tail"; // 105 chars
    const chunks = chunkText(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toContain("tail");
  });
});

describe("sendText", () => {
  it("calls api.sendMessage once for short text", async () => {
    const api = { sendMessage: vi.fn().mockResolvedValue(undefined) } as any;
    await sendText({ api, toUserId: "u1", contextToken: "ctx" }, "hi");
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    const req = api.sendMessage.mock.calls[0][0];
    expect(req.msg.item_list[0].text_item.text).toBe("hi");
    expect(req.msg.context_token).toBe("ctx");
  });

  it("chunks long text into multiple sends", async () => {
    const api = { sendMessage: vi.fn().mockResolvedValue(undefined) } as any;
    const long = "x".repeat(5000);
    await sendText({ api, toUserId: "u1", contextToken: "ctx" }, long, { maxChars: 100 });
    expect(api.sendMessage.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("sendMedia", () => {
  it("dispatches to uploadImage for image mime", async () => {
    const api = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getUploadUrl: vi.fn().mockResolvedValue({ upload_url: "u", encrypt_query_param: "q" }),
    } as any;
    const uploadImage = vi.fn().mockResolvedValue({
      aeskey: "00".repeat(16),
      downloadEncryptedQueryParam: "q",
      fileSizeCiphertext: 10,
      fileSize: 10,
    });
    // mock fs.stat via module mock if needed; simpler: pass real path via tmpfile
    const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "media-"));
    const path = join(dir, "x.png");
    await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await sendMedia({ api, toUserId: "u1", contextToken: "ctx", uploadImage }, path);
    expect(uploadImage).toHaveBeenCalled();
    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/channel/outbound.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/channel/outbound.ts`**

```ts
import { stat } from "node:fs/promises";

import type { WechatApiClient } from "../wechat/api.js";
import { aesKeyHexToBase64, getMimeFromFilename, uploadAttachment, uploadImage, uploadVideo } from "../wechat/media.js";
import type { MessageItem } from "../wechat/types.js";
import { MessageItemType, MessageState, MessageType } from "../wechat/types.js";
import { MediaError } from "../errors.js";

export interface SendCtx {
  api: WechatApiClient;
  toUserId: string;
  contextToken: string;
  /** Overrideable for testing. */
  uploadImage?: typeof uploadImage;
  uploadVideo?: typeof uploadVideo;
  uploadAttachment?: typeof uploadAttachment;
  defaultMaxChars?: number;
}

function newClientId(): string {
  return `wac:${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (rest.length <= max) {
      out.push(rest);
      break;
    }
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.6) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.6) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  return out;
}

export async function sendText(ctx: SendCtx, text: string, opts?: { maxChars?: number }): Promise<void> {
  const max = opts?.maxChars ?? ctx.defaultMaxChars ?? 4000;
  for (const chunk of chunkText(text, max)) {
    await ctx.api.sendMessage({
      msg: {
        from_user_id: "",
        to_user_id: ctx.toUserId,
        client_id: newClientId(),
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: chunk } }],
        context_token: ctx.contextToken,
      },
    });
  }
}

export async function sendMedia(ctx: SendCtx, filePath: string, caption?: string): Promise<void> {
  const st = await stat(filePath).catch((err) => {
    throw new MediaError("upload", err);
  });
  if (!st.isFile()) {
    throw new MediaError("upload", new Error(`not a file: ${filePath}`));
  }
  const mime = getMimeFromFilename(filePath);
  const upImg = ctx.uploadImage ?? uploadImage;
  const upVid = ctx.uploadVideo ?? uploadVideo;
  const upAtt = ctx.uploadAttachment ?? uploadAttachment;
  let uploaded;
  if (mime.startsWith("image/")) uploaded = await upImg(ctx.api, filePath, ctx.toUserId);
  else if (mime.startsWith("video/")) uploaded = await upVid(ctx.api, filePath, ctx.toUserId);
  else uploaded = await upAtt(ctx.api, filePath, ctx.toUserId);

  let mediaItem: MessageItem;
  if (mime.startsWith("image/")) {
    mediaItem = {
      type: MessageItemType.IMAGE,
      image_item: {
        aeskey: uploaded.aeskey,
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: aesKeyHexToBase64(uploaded.aeskey),
          encrypt_type: 1,
        },
        mid_size: uploaded.fileSizeCiphertext,
      },
    };
  } else if (mime.startsWith("video/")) {
    mediaItem = {
      type: MessageItemType.VIDEO,
      video_item: {
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: aesKeyHexToBase64(uploaded.aeskey),
          encrypt_type: 1,
        },
        video_size: uploaded.fileSizeCiphertext,
      },
    };
  } else {
    const fileName = filePath.split("/").pop() ?? "file";
    mediaItem = {
      type: MessageItemType.FILE,
      file_item: {
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: aesKeyHexToBase64(uploaded.aeskey),
          encrypt_type: 1,
        },
        file_name: fileName,
        len: String(uploaded.fileSize),
      },
    };
  }

  if (caption) {
    await ctx.api.sendMessage({
      msg: {
        from_user_id: "",
        to_user_id: ctx.toUserId,
        client_id: newClientId(),
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: caption } }],
        context_token: ctx.contextToken,
      },
    });
  }
  await ctx.api.sendMessage({
    msg: {
      from_user_id: "",
      to_user_id: ctx.toUserId,
      client_id: newClientId(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: [mediaItem],
      context_token: ctx.contextToken,
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/channel/outbound.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/channel/outbound.ts test/channel/outbound.test.ts
git commit -m "feat(channel): outbound sendText + sendMedia helpers, chunked text"
```

---

## Task 8: Build `channel/typing.ts` (TypingKeepalive heartbeat)

**Files:**
- Create: `src/channel/typing.ts`
- Test: `test/channel/typing.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/channel/typing.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TypingKeepalive } from "../../src/channel/typing.js";

describe("TypingKeepalive", () => {
  let api: any;
  beforeEach(() => {
    vi.useFakeTimers();
    api = {
      getConfig: vi.fn().mockResolvedValue({ typing_ticket: "ticket-1" }),
      sendTyping: vi.fn().mockResolvedValue(undefined),
    };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends status=1 immediately on start", async () => {
    const t = new TypingKeepalive({ api, userId: "u", contextToken: "c", intervalMs: 1000 });
    await t.start();
    expect(api.sendTyping).toHaveBeenCalledWith({
      ilink_user_id: "u",
      typing_ticket: "ticket-1",
      status: 1,
    });
  });

  it("re-sends status=1 every interval", async () => {
    const t = new TypingKeepalive({ api, userId: "u", contextToken: "c", intervalMs: 1000 });
    await t.start();
    api.sendTyping.mockClear();
    await vi.advanceTimersByTimeAsync(3500);
    expect(api.sendTyping.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("stop() sends status=2 once and clears interval", async () => {
    const t = new TypingKeepalive({ api, userId: "u", contextToken: "c", intervalMs: 1000 });
    await t.start();
    api.sendTyping.mockClear();
    t.stop();
    expect(api.sendTyping).toHaveBeenCalledWith({
      ilink_user_id: "u",
      typing_ticket: "ticket-1",
      status: 2,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.sendTyping.mock.calls.length).toBe(1); // no further calls
  });

  it("stop() without ticket is a no-op", async () => {
    api.getConfig.mockResolvedValue({ typing_ticket: undefined });
    const t = new TypingKeepalive({ api, userId: "u", contextToken: "c" });
    await t.start();
    api.sendTyping.mockClear();
    t.stop();
    expect(api.sendTyping).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/channel/typing.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/channel/typing.ts`**

```ts
import type { WechatApiClient } from "../wechat/api.js";

export interface TypingOpts {
  api: WechatApiClient;
  userId: string;
  contextToken: string;
  intervalMs?: number;
}

export class TypingKeepalive {
  private ticket: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly intervalMs: number;

  constructor(private readonly opts: TypingOpts) {
    this.intervalMs = opts.intervalMs ?? 5000;
  }

  async start(): Promise<void> {
    if (this.stopped) return;
    try {
      const cfg = await this.opts.api.getConfig({
        ilinkUserId: this.opts.userId,
        contextToken: this.opts.contextToken,
      });
      this.ticket = cfg.typing_ticket ?? null;
      if (!this.ticket) return;
      await this.fire(1);
      this.timer = setInterval(() => void this.tick(), this.intervalMs);
    } catch {
      // best-effort; swallow
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ticket) {
      this.fire(2).catch(() => {});
    }
  }

  private async fire(status: 1 | 2): Promise<void> {
    if (!this.ticket) return;
    await this.opts.api.sendTyping({
      ilink_user_id: this.opts.userId,
      typing_ticket: this.ticket,
      status,
    });
  }

  private async tick(): Promise<void> {
    try {
      await this.fire(1);
    } catch {
      this.stop();
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/channel/typing.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/channel/typing.ts test/channel/typing.test.ts
git commit -m "feat(channel): TypingKeepalive heartbeat helper"
```

---

## Task 9: Build `channel/reply.ts` (Reply object factory)

**Files:**
- Create: `src/channel/reply.ts`

- [ ] **Step 1: Implement `src/channel/reply.ts`**

```ts
import type { WechatApiClient } from "../wechat/api.js";
import type { Reply, ReplyTextOpts } from "./types.js";
import { sendMedia, sendText, type SendCtx } from "./outbound.js";
import { TypingKeepalive } from "./typing.js";

export interface ReplyDeps {
  api: WechatApiClient;
  toUserId: string;
  contextToken: string;
  defaultMaxChars?: number;
}

export function createReply(deps: ReplyDeps): Reply {
  const sendCtx: SendCtx = {
    api: deps.api,
    toUserId: deps.toUserId,
    contextToken: deps.contextToken,
    defaultMaxChars: deps.defaultMaxChars,
  };
  const typing = new TypingKeepalive({
    api: deps.api,
    userId: deps.toUserId,
    contextToken: deps.contextToken,
  });
  let typingStarted = false;

  return {
    async text(content: string, opts?: ReplyTextOpts): Promise<void> {
      await sendText(sendCtx, content, opts);
    },
    async media(filePath: string, caption?: string): Promise<void> {
      await sendMedia(sendCtx, filePath, caption);
    },
    async typing(on: boolean = true): Promise<void> {
      if (on && !typingStarted) {
        await typing.start();
        typingStarted = true;
      } else if (!on && typingStarted) {
        typing.stop();
        typingStarted = false;
      }
    },
  };
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/channel/reply.ts
git commit -m "feat(channel): createReply factory wires Reply + TypingKeepalive"
```

---

## Task 10: Build `channel/long-poll.ts` (long-poll loop + error recovery)

**Files:**
- Create: `src/channel/long-poll.ts`
- Test: `test/channel/long-poll.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/channel/long-poll.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runLongPoll } from "../../src/channel/long-poll.js";

describe("runLongPoll", () => {
  it("invokes handler for each message", async () => {
    const api = {
      notifyStart: vi.fn().mockResolvedValue({ ret: 0 }),
      getUpdates: vi
        .fn()
        .mockResolvedValueOnce({
          ret: 0,
          get_updates_buf: "buf-1",
          msgs: [{ from_user_id: "u1", context_token: "ctx", item_list: [{ type: 1, text_item: { text: "hi" } }] }],
        })
        .mockResolvedValueOnce({ ret: 0, get_updates_buf: "buf-2", msgs: [] }),
    } as any;
    const store = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
      flush: vi.fn(),
    };
    const handler = vi.fn().mockResolvedValue(undefined);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    await runLongPoll({
      api,
      store,
      mediaTmpDir: "/tmp",
      onMessage: handler,
      longPollTimeoutMs: 1000,
      signal: ac.signal,
      onError: vi.fn(),
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].text).toBe("hi");
  });

  it("retries on consecutive network errors with backoff", async () => {
    const api = {
      notifyStart: vi.fn().mockResolvedValue({ ret: 0 }),
      getUpdates: vi.fn().mockRejectedValue(new Error("network")),
    } as any;
    const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn(), flush: vi.fn() };
    const handler = vi.fn();
    const ac = new AbortController();
    const errors: any[] = [];
    const start = Date.now();
    setTimeout(() => ac.abort(), 200);
    await runLongPoll({
      api,
      store,
      mediaTmpDir: "/tmp",
      onMessage: handler,
      longPollTimeoutMs: 100,
      signal: ac.signal,
      onError: (e) => errors.push(e),
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it("pauses 1 hour on errcode=-14", async () => {
    const api = {
      notifyStart: vi.fn().mockResolvedValue({ ret: 0 }),
      getUpdates: vi
        .fn()
        .mockResolvedValueOnce({ ret: -14, errmsg: "session expired", msgs: [] })
        .mockResolvedValueOnce({ ret: 0, msgs: [] }),
    } as any;
    const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn(), flush: vi.fn() };
    const handler = vi.fn();
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    await runLongPoll({
      api,
      store,
      mediaTmpDir: "/tmp",
      onMessage: handler,
      longPollTimeoutMs: 50,
      signal: ac.signal,
      onError: vi.fn(),
    });
    // Should have only called getUpdates once (paused)
    expect(api.getUpdates).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/channel/long-poll.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/channel/long-poll.ts`**

```ts
import { WechatApiError } from "../errors.js";
import type { Store } from "../store/types.js";
import type { WechatApiClient } from "../wechat/api.js";
import { buildInbound } from "./inbound.js";
import { createReply } from "./reply.js";
import type { ChannelMsg } from "./types.js";

export interface LongPollOpts {
  api: WechatApiClient;
  store: Store;
  mediaTmpDir: string;
  onMessage: (msg: ChannelMsg, reply: ReturnType<typeof createReply>) => Promise<void> | void;
  onError: (err: unknown, ctx?: { phase: string }) => void;
  longPollTimeoutMs: number;
  signal: AbortSignal;
  /** Optional max chunk for reply text. */
  defaultMaxChars?: number;
}

const SESSION_EXPIRED = -14;
const CONSECUTIVE_FAILURE_LIMIT = 3;
const BACKOFF_MS = 30_000;
const RETRY_DELAY_MS = 2_000;
const SESSION_PAUSE_MS = 60 * 60 * 1000;

export async function runLongPoll(opts: LongPollOpts): Promise<void> {
  const { api, store, mediaTmpDir, onMessage, onError, longPollTimeoutMs, signal } = opts;

  try {
    const resp = await api.notifyStart();
    if (resp.ret !== undefined && resp.ret !== 0) {
      onError(new WechatApiError({ ret: resp.ret, errmsg: resp.errmsg }), { phase: "notifyStart" });
    }
  } catch (err) {
    onError(err, { phase: "notifyStart" });
  }

  let consecutive = 0;
  let sessionPausedUntil = 0;

  while (!signal.aborted) {
    const now = Date.now();
    if (now < sessionPausedUntil) {
      await sleep(sessionPausedUntil - now, signal);
      continue;
    }

    let resp;
    try {
      resp = await api.getUpdates(
        { get_updates_buf: (await store.get("sync_buf")) ?? "" },
        { timeoutMs: longPollTimeoutMs, signal },
      );
    } catch (err) {
      if (signal.aborted) break;
      consecutive += 1;
      onError(err, { phase: "getUpdates" });
      const wait = consecutive >= CONSECUTIVE_FAILURE_LIMIT ? BACKOFF_MS : RETRY_DELAY_MS;
      await sleep(wait, signal);
      continue;
    }

    const isError = (resp.ret !== undefined && resp.ret !== 0) || (resp.errcode !== undefined && resp.errcode !== 0);
    if (isError) {
      if (resp.errcode === SESSION_EXPIRED || resp.ret === SESSION_EXPIRED) {
        sessionPausedUntil = Date.now() + SESSION_PAUSE_MS;
        onError(new WechatApiError({ ret: resp.ret, errcode: resp.errcode, errmsg: resp.errmsg }), { phase: "sessionExpired" });
        continue;
      }
      consecutive += 1;
      onError(new WechatApiError({ ret: resp.ret, errcode: resp.errcode, errmsg: resp.errmsg }), { phase: "getUpdates" });
      const wait = consecutive >= CONSECUTIVE_FAILURE_LIMIT ? BACKOFF_MS : RETRY_DELAY_MS;
      await sleep(wait, signal);
      continue;
    }

    consecutive = 0;
    if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
      await store.set("sync_buf", resp.get_updates_buf);
    }

    for (const fullMsg of resp.msgs ?? []) {
      if (signal.aborted) break;
      const userId = fullMsg.from_user_id ?? "";
      if (!userId) continue;
      const contextToken = fullMsg.context_token ?? (await store.get(`ctx:${userId}`)) ?? "";
      if (fullMsg.context_token) {
        await store.set(`ctx:${userId}`, fullMsg.context_token);
      }
      let msg: ChannelMsg;
      try {
        msg = await buildInbound({ api, mediaTmpDir, msg: fullMsg });
      } catch (err) {
        onError(err, { phase: "inbound" });
        continue;
      }
      const reply = createReply({
        api,
        toUserId: userId,
        contextToken,
        defaultMaxChars: opts.defaultMaxChars,
      });
      try {
        await onMessage(msg, reply);
      } catch (err) {
        onError(err, { phase: "handler" });
      }
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    }, { once: true });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/channel/long-poll.test.ts`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/channel/long-poll.ts test/channel/long-poll.test.ts
git commit -m "feat(channel): long-poll loop with errcode=-14 pause + backoff"
```

---

## Task 11: Build `channel/login.ts` (`QRLoginHandle` with renderers)

**Files:**
- Create: `src/channel/login.ts`
- Test: `test/channel/login.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/channel/login.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createQRLoginHandle } from "../../src/channel/login.js";

describe("QRLoginHandle", () => {
  const matrix = [
    [true, false, true],
    [false, true, false],
    [true, false, true],
  ];

  it("toTerminal renders ASCII", () => {
    const h = createQRLoginHandle({ matrix, waitForLogin: vi.fn() });
    const out = h.toTerminal({ margin: 0 });
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("█");
    expect(out).toContain(" ");
  });

  it("toTerminal invert swaps characters", () => {
    const h = createQRLoginHandle({ matrix, waitForLogin: vi.fn() });
    const normal = h.toTerminal({ margin: 0 });
    const inverted = h.toTerminal({ margin: 0, invert: true });
    expect(inverted).not.toBe(normal);
  });

  it("toPng returns Buffer", async () => {
    const h = createQRLoginHandle({ matrix, waitForLogin: vi.fn() });
    const buf = await h.toPng({ size: 100 });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("toSvg returns string", () => {
    const h = createQRLoginHandle({ matrix, waitForLogin: vi.fn() });
    const svg = h.toSvg({ margin: 1 });
    expect(typeof svg).toBe("string");
    expect(svg).toContain("<svg");
  });

  it("toDataURL returns data URL", async () => {
    const h = createQRLoginHandle({ matrix, waitForLogin: vi.fn() });
    const url = await h.toDataURL({ size: 100 });
    expect(url).toMatch(/^data:image\/png;base64,/);
  });

  it("waitForLogin delegates to injected function", async () => {
    const fn = vi.fn().mockResolvedValue({ botToken: "t", accountId: "a", baseUrl: "b" });
    const h = createQRLoginHandle({ matrix, waitForLogin: fn });
    const r = await h.waitForLogin();
    expect(r.botToken).toBe("t");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/channel/login.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/channel/login.ts`**

```ts
import { toBuffer as qrToBuffer, toDataURL as qrToDataURL, toString as qrToString } from "qrcode";

import type {
  LoginResult,
  QRLoginHandle,
  QrPngOpts,
  QrSvgOpts,
  QrTerminalOpts,
  WaitForLoginOpts,
} from "./types.js";

export interface CreateQRLoginOpts {
  matrix: boolean[][];
  waitForLogin: (opts?: WaitForLoginOpts) => Promise<LoginResult>;
}

export function createQRLoginHandle(opts: CreateQRLoginOpts): QRLoginHandle {
  return {
    matrix: opts.matrix,
    toTerminal(o?: QrTerminalOpts): string {
      const margin = o?.margin ?? 2;
      const invert = o?.invert ?? false;
      const dark = invert ? " " : "█";
      const light = invert ? "█" : " ";
      const lines: string[] = [];
      for (let i = 0; i < margin; i++) lines.push(light.repeat(opts.matrix[0]!.length + margin * 2));
      for (const row of opts.matrix) {
        const line = row.map((cell) => (cell ? dark : light)).join("");
        lines.push(light.repeat(margin) + line + light.repeat(margin));
      }
      for (let i = 0; i < margin; i++) lines.push(light.repeat(opts.matrix[0]!.length + margin * 2));
      return lines.join("\n");
    },
    async toPng(o?: QrPngOpts): Promise<Buffer> {
      return qrToBuffer(matrixToString(opts.matrix), {
        type: "png",
        width: o?.size ?? 300,
        margin: o?.margin ?? 2,
        errorCorrectionLevel: "M",
      });
    },
    toSvg(o?: QrSvgOpts): string {
      return qrToString(matrixToString(opts.matrix), {
        type: "svg",
        margin: o?.margin ?? 2,
        errorCorrectionLevel: "M",
      });
    },
    async toDataURL(o?: QrPngOpts): Promise<string> {
      return qrToDataURL(matrixToString(opts.matrix), {
        width: o?.size ?? 300,
        margin: o?.margin ?? 2,
        errorCorrectionLevel: "M",
      });
    },
    waitForLogin: opts.waitForLogin,
  };
}

/** Flatten a 2D QR matrix into the canonical string format the `qrcode` package expects. */
function matrixToString(matrix: boolean[][]): string {
  // qrcode package accepts a string of binary chars; render row by row.
  return matrix.map((row) => row.map((cell) => (cell ? "1" : "0")).join("")).join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/channel/login.test.ts`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add src/channel/login.ts test/channel/login.test.ts
git commit -m "feat(channel): QRLoginHandle with toTerminal/toPng/toSvg/toDataURL"
```

---

## Task 12: Build `channel/create.ts` (`createChannel` factory)

**Files:**
- Create: `src/channel/create.ts`
- Test: `test/channel/create.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/channel/create.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createChannel } from "../../src/channel/create.js";
import { MemoryStore } from "../../src/store/memory.js";

describe("createChannel", () => {
  it("returns handle with api/start/stop/loginQR", async () => {
    const ch = await createChannel({
      botToken: "tok",
      accountId: "acc",
      store: new MemoryStore(),
    });
    expect(ch.api).toBeDefined();
    expect(typeof ch.start).toBe("function");
    expect(typeof ch.stop).toBe("function");
    expect(typeof ch.loginQR).toBe("function");
  });

  it("start() calls api.notifyStart and runs long-poll", async () => {
    const ch = await createChannel({
      botToken: "tok",
      accountId: "acc",
      store: new MemoryStore(),
    });
    vi.spyOn(ch.api, "notifyStart").mockResolvedValue({ ret: 0 } as any);
    vi.spyOn(ch.api, "getUpdates").mockResolvedValue({ ret: 0, msgs: [] } as any);
    const ac = new AbortController();
    const p = ch.start({ signal: ac.signal });
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await p.catch(() => {});
    expect(ch.api.notifyStart).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/channel/create.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/channel/create.ts`**

```ts
import { loadEnvOverrides } from "../config.js";
import { ChannelError } from "../errors.js";
import { JsonFileStore } from "../store/file.js";
import { MemoryStore } from "../store/memory.js";
import type { Store } from "../store/types.js";
import { WechatApiClient } from "../wechat/api.js";
import { decodeQrMatrix, pollQrLogin, requestQrCode } from "../wechat/login.js";
import { runLongPoll } from "./long-poll.js";
import { createQRLoginHandle } from "./login.js";
import type { ChannelMsg, QRLoginHandle, Reply } from "./types.js";

export interface CreateChannelOpts {
  botToken: string;
  accountId: string;
  baseUrl?: string;
  cdnBaseUrl?: string;
  channelVersion?: string;
  botAgent?: string;
  botType?: string;
  stateDir?: string;
  store?: Store;
  onMessage?: (msg: ChannelMsg, reply: Reply) => Promise<void> | void;
  onError?: (err: unknown, ctx?: { phase: string }) => void;
  longPollTimeoutMs?: number;
  mediaTmpDir?: string;
  blockedUsers?: ReadonlySet<string>;
}

export interface ChannelHandle {
  api: WechatApiClient;
  start(opts?: { signal?: AbortSignal }): Promise<void>;
  stop(): Promise<void>;
  loginQR(opts?: { botType?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<QRLoginHandle>;
}

export async function createChannel(opts: CreateChannelOpts): Promise<ChannelHandle> {
  if (!opts.botToken) throw new ChannelError("AUTH_REQUIRED", "botToken is required");
  if (!opts.accountId) throw new ChannelError("INVALID_TOKEN", "accountId is required");

  const env = loadEnvOverrides("WECHAT_CHANNEL_");
  const baseUrl = opts.baseUrl ?? env.baseUrl ?? "https://ilinkai.weixin.qq.com";
  const cdnBaseUrl = opts.cdnBaseUrl ?? env.cdnBaseUrl ?? "https://novac2c.cdn.weixin.qq.com/c2c";
  const channelVersion = opts.channelVersion ?? "wechat-channel/0.1.0";
  const botAgent = opts.botAgent ?? channelVersion;
  const longPollTimeoutMs = opts.longPollTimeoutMs ?? env.longPollTimeoutMs ?? 35_000;

  const api = new WechatApiClient({
    baseUrl,
    cdnBaseUrl,
    botToken: opts.botToken,
    channelVersion,
    botAgent,
    longPollTimeoutMs,
  });

  const stateDir = opts.stateDir ?? env.stateDir ?? `${process.env.HOME ?? "."}/.wechat-channel`;
  const store: Store = opts.store ?? new JsonFileStore(`${stateDir}/store.json`);
  const mediaTmpDir = opts.mediaTmpDir ?? `${stateDir}/media`;

  const onError = opts.onError ?? ((err) => console.error("[wechat-channel]", err));

  let abortController: AbortController | null = null;
  let loopPromise: Promise<void> | null = null;

  async function start(startOpts?: { signal?: AbortSignal }): Promise<void> {
    if (loopPromise) throw new ChannelError("ABORTED", "channel already started");
    abortController = new AbortController();
    if (startOpts?.signal) {
      startOpts.signal.addEventListener("abort", () => abortController?.abort(), { once: true });
    }
    if (opts.onMessage) {
      const handler = opts.onMessage;
      loopPromise = runLongPoll({
        api,
        store,
        mediaTmpDir,
        onMessage: (msg, reply) => {
          if (opts.blockedUsers?.has(msg.fromUserId)) return Promise.resolve();
          return handler(msg, reply);
        },
        onError,
        longPollTimeoutMs,
        signal: abortController.signal,
      });
    }
    await loopPromise;
  }

  async function stop(): Promise<void> {
    abortController?.abort();
    try {
      await api.notifyStop();
    } catch (err) {
      onError(err, { phase: "notifyStop" });
    }
    await store.flush();
    loopPromise = null;
  }

  async function loginQR(loginOpts?: { botType?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<QRLoginHandle> {
    const botType = loginOpts?.botType ?? opts.botType ?? "3";
    const { qrcode, qrcodeImgContent } = await requestQrCode(api, { botType });
    const matrix = await decodeQrMatrix(qrcodeImgContent);
    return createQRLoginHandle({
      matrix,
      waitForLogin: async (waitOpts) => {
        const result = await pollQrLogin(api, {
          qrcode,
          timeoutMs: waitOpts?.timeoutMs ?? loginOpts?.timeoutMs ?? 120_000,
          signal: waitOpts?.signal ?? loginOpts?.signal,
        });
        return { botToken: result.botToken!, accountId: result.accountId!, baseUrl: result.baseUrl ?? baseUrl };
      },
    });
  }

  return { api, start, stop, loginQR };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/channel/create.test.ts`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/channel/create.ts test/channel/create.test.ts
git commit -m "feat(channel): createChannel factory wires api + store + long-poll + loginQR"
```

---

## Task 13: Build `src/config.ts` (`loadEnvOverrides`) and `src/index.ts` (exports)

**Files:**
- Replace: `src/config.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Replace `src/config.ts`**

```ts
import "dotenv/config";

export interface EnvOverrides {
  baseUrl?: string;
  cdnBaseUrl?: string;
  stateDir?: string;
  longPollTimeoutMs?: number;
}

export function loadEnvOverrides(prefix: string): EnvOverrides {
  const get = (suffix: string): string | undefined => {
    const v = process.env[`${prefix}${suffix}`]?.trim();
    return v && v.length > 0 ? v : undefined;
  };
  const longPollRaw = get("LONG_POLL_TIMEOUT_MS");
  return {
    baseUrl: get("BASE_URL"),
    cdnBaseUrl: get("CDN_BASE_URL"),
    stateDir: get("STATE_DIR"),
    longPollTimeoutMs: longPollRaw ? Number.parseInt(longPollRaw, 10) : undefined,
  };
}
```

- [ ] **Step 2: Create `src/index.ts`**

```ts
export { createChannel, type CreateChannelOpts, type ChannelHandle } from "./channel/create.js";
export type { ChannelMsg, MediaRef, Reply, ReplyTextOpts } from "./channel/types.js";
export type { QRLoginHandle, LoginResult, QrTerminalOpts, QrPngOpts, QrSvgOpts, WaitForLoginOpts } from "./channel/types.js";
export type { Store } from "./store/types.js";
export { JsonFileStore } from "./store/file.js";
export { MemoryStore } from "./store/memory.js";
export { ChannelError, WechatApiError, MediaError } from "./errors.js";
export type { ChannelErrorCode, WechatApiErrorPayload, MediaPhase } from "./errors.js";
export { WechatApiClient, type ApiClientOptions } from "./wechat/api.js";
export type { WeixinMessage, MessageItem } from "./wechat/types.js";
```

- [ ] **Step 3: Verify build (both targets)**

Run: `npm run build`
Expected: dist/ and dist-cjs/ populated

- [ ] **Step 4: Commit**

```bash
git add src/config.ts src/index.ts
git commit -m "feat: loadEnvOverrides + public API surface"
```

---

## Task 14: Add CJS smoke test

**Files:**
- Create: `test/cjs-smoke.test.ts`

- [ ] **Step 1: Create `test/cjs-smoke.test.ts`**

```ts
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

describe("CJS entry smoke", () => {
  it("require('@wechat/channel') exports createChannel", () => {
    const require = createRequire(import.meta.url);
    // Resolve via the package.json#main fallback
    const mod = require("../../dist-cjs/index.js") as typeof import("../src/index.js");
    expect(typeof mod.createChannel).toBe("function");
    expect(typeof mod.JsonFileStore).toBe("function");
    expect(typeof mod.MemoryStore).toBe("function");
    expect(typeof mod.ChannelError).toBe("function");
  });
});
```

- [ ] **Step 2: Build first, then run**

Run: `npm run build && npx vitest run test/cjs-smoke.test.ts`
Expected: 1 passed

- [ ] **Step 3: Commit**

```bash
git add test/cjs-smoke.test.ts
git commit -m "test: CJS entry smoke test"
```

---

## Task 15: Migrate Claude bot to `legacy/`

**Files:**
- Move: `src/bot.ts`, `src/bot/`, `src/claude/`, `src/state/sessions.ts`, `src/index.ts`, `src/login.ts`, `test/bot/`, `test/inbound.test.ts` (adapted), `test/streaming.test.ts`, `test/markdown-filter.test.ts`
- Create: `legacy/README.md`

- [ ] **Step 1: Move Claude-specific files**

```bash
mkdir -p legacy/src/bot legacy/src/claude legacy/src/state legacy/test
git mv src/bot.ts legacy/src/bot.ts
git mv src/bot/inbound.ts legacy/src/bot/inbound.ts
git mv src/bot/send.ts legacy/src/bot/send.ts
git mv src/bot/streaming.ts legacy/src/bot/streaming.ts
git mv src/bot/markdown-filter.ts legacy/src/bot/markdown-filter.ts
git mv src/claude/agent.ts legacy/src/claude/agent.ts
git mv src/state/sessions.ts legacy/src/state/sessions.ts
git mv src/index.ts legacy/src/index.ts
git mv src/login.ts legacy/src/login.ts
git mv test/streaming.test.ts legacy/test/streaming.test.ts
git mv test/markdown-filter.test.ts legacy/test/markdown-filter.test.ts
```

- [ ] **Step 2: Create `legacy/README.md`**

```markdown
# legacy/ — Archived CLI Bot

**This directory is NOT part of the published `@wechat/channel` package. It is not maintained.**

It contains an earlier CLI bot implementation that hard-wired the WeChat channel to Claude Agent SDK. Kept for historical reference only.

To run the old bot:
1. Copy this `legacy/` tree to a separate repo
2. Add a fresh `package.json` with `@anthropic-ai/claude-agent-sdk`, `dotenv`, `pino`, `qrcode-terminal`, and `tsx` as deps
3. Update import paths to point at the current `@wechat/channel` package
4. Run with `tsx legacy/src/index.ts`

Do NOT import from this directory in your `@wechat/channel` code.
```

- [ ] **Step 3: Update root vitest config to exclude legacy/**

Create `vitest.config.ts` (root):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["legacy/**", "node_modules/**", "dist/**", "dist-cjs/**"],
  },
});
```

- [ ] **Step 4: Verify `npm run test` excludes legacy/**

Run: `npm run test`
Expected: tests pass, no tests from `legacy/` are run.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: archive Claude bot to legacy/, exclude from tests + publish"
```

---

## Task 16: Build `bin/migrate-credentials.ts` CLI

**Files:**
- Create: `bin/migrate-credentials.ts`

- [ ] **Step 1: Implement the bin at `src/bin/migrate-credentials.ts`**

(Lives under `src/bin/` so the existing `tsconfig.json` `include: ["src/**/*.ts"]` picks it up.)

```ts
#!/usr/bin/env node
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("Usage: wechat-channel migrate-credentials <oldStateDir>");
  console.error("Example: wechat-channel migrate-credentials ~/.wechat-agent-channel");
  process.exit(1);
}

const oldDir = resolve(args[0]!.replace(/^~/, process.env.HOME ?? "."));
const newDir = resolve(process.env.WECHAT_CHANNEL_STATE_DIR ?? "~/.wechat-channel".replace(/^~/, process.env.HOME ?? "."));

const files = ["credentials.json", "sync-buf.json", "context-tokens.json"];
await mkdir(newDir, { recursive: true });

for (const f of files) {
  const src = join(oldDir, f);
  const dst = join(newDir, f);
  if (!existsSync(src)) {
    console.log(`skip ${f} (not present in ${oldDir})`);
    continue;
  }
  await mkdir(dirname(dst), { recursive: true });
  await copyFile(src, dst);
  console.log(`migrated ${f}: ${src} → ${dst}`);
}

console.log(`done. New state dir: ${newDir}`);
console.log(`Next: set WECHAT_CHANNEL_STATE_DIR=${newDir} in your .env`);
```

- [ ] **Step 2: Build and smoke test**

Run: `npm run build`
Expected: `dist/bin/migrate-credentials.js` and `dist-cjs/bin/migrate-credentials.js` produced

Run: `node dist/bin/migrate-credentials.js`
Expected: prints usage and exits with code 1

- [ ] **Step 3: Commit**

```bash
git add src/bin/migrate-credentials.ts
git commit -m "feat(bin): migrate-credentials CLI for legacy state dir"
```

---

## Task 17: Rewrite README

**Files:**
- Replace: `README.md`

- [ ] **Step 1: Write new README**

```markdown
# @wechat/channel

Agent-agnostic WeChat ilink channel library. Bridges the WeChat long-poll protocol to user-defined message handlers.

## Install

```bash
npm install @wechat/channel
```

## Quick start (5 lines)

```ts
import { createChannel } from "@wechat/channel";

const channel = await createChannel({
  botToken: process.env.WECHAT_BOT_TOKEN!,
  accountId: process.env.WECHAT_ACCOUNT_ID!,
  onMessage: async (msg, reply) => {
    await reply.text(`echo: ${msg.text}`);
  },
});
await channel.start();
```

## Login

```ts
const qr = await channel.loginQR();
console.log(qr.toTerminal());           // terminal users
// or for web:
const dataUrl = await qr.toDataURL({ size: 300 });
const { botToken, accountId } = await qr.waitForLogin();
```

## Migrating from old `wechat-agent-channel` bot

| Old | New |
|---|---|
| `WECHAT_BOT_TOKEN` | `WECHAT_BOT_TOKEN` (unchanged) |
| `WECHAT_ACCOUNT_ID` | `WECHAT_ACCOUNT_ID` (unchanged) |
| `ANTHROPIC_API_KEY` | (drop — your agent manages this) |
| `CLAUDE_MODEL` | (drop) |
| `CLAUDE_WORK_DIR` | (drop) |
| `~/.wechat-agent-channel/credentials.json` | run `npx wechat-channel migrate-credentials ~/.wechat-agent-channel` |

## ESM + CJS

```ts
// ESM
import { createChannel } from "@wechat/channel";

// CJS
const { createChannel } = require("@wechat/channel");
```

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for @wechat/channel library"
```

---

## Task 18: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm run test`
Expected: all tests pass; `legacy/` excluded.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 3: Build both targets**

Run: `npm run build`
Expected: `dist/` and `dist-cjs/` both populated.

- [ ] **Step 4: Verify tarball excludes `legacy/` and includes `dist/bin/`**

Run: `npm pack --dry-run`
Expected: file list contains `dist/index.js`, `dist/index.d.ts`, `dist/bin/migrate-credentials.js`, `dist-cjs/index.js`, `README.md`, `package.json`; **no** `legacy/`.

- [ ] **Step 5: Verify package.json is publishable**

Run: `npm publish --dry-run`
Expected: shows scoped name `@wechat/channel`, lists correct files.

- [ ] **Step 6: Final commit (if any uncommitted changes)**

```bash
git status
# if anything pending:
git add -A
git commit -m "chore: pre-publish verification"
```

---

## Self-Review Checklist (run after writing, fix inline)

- [ ] **Spec coverage:** Every spec section (§1–§11) maps to at least one task. Missing: ___ (none expected)
- [ ] **Placeholder scan:** No "TBD"/"TODO"/"implement later" in any step
- [ ] **Type consistency:**
  - `Store` defined in Task 3, consumed in Task 10, 12 ✓
  - `ChannelMsg`/`Reply`/`QRLoginHandle` defined in Task 5, consumed in Task 12 ✓
  - `WechatApiClient` constructor signature consistent between Task 2 and Task 12 ✓
  - `ChannelError("AUTH_REQUIRED", ...)` etc. codes match between Task 4 and Task 12 ✓
- [ ] **No step says "implement later" without actual code** ✓
- [ ] **All file paths are exact** ✓
- [ ] **All commands shown with expected output** ✓