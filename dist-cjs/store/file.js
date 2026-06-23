"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonFileStore = void 0;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
/**
 * JSON-file-backed `Store`. Atomic-ish writes via a `.tmp` swap, with a
 * coalesced write queue so concurrent `set()` / `delete()` calls are serialized.
 *
 * On first access, loads the entire file into memory; subsequent reads are
 * served from the in-memory map. Writes are kept in memory and flushed to
 * disk via `set()`'s awaited promise chain (or eagerly via `flush()`).
 *
 * Tolerant of ENOENT (returns empty store on first run).
 */
class JsonFileStore {
    filePath;
    state = { data: {} };
    loaded = false;
    writing = Promise.resolve();
    constructor(filePath) {
        this.filePath = filePath;
    }
    load() {
        if (this.loaded)
            return Promise.resolve();
        if (this.loading)
            return this.loading;
        this.loading = this.doLoad();
        return this.loading;
    }
    loading;
    async doLoad() {
        try {
            const raw = await (0, promises_1.readFile)(this.filePath, "utf-8");
            const parsed = JSON.parse(raw);
            this.state = { data: { ...(parsed.data ?? {}) } };
        }
        catch (err) {
            if (err.code !== "ENOENT")
                throw err;
            this.state = { data: {} };
        }
        this.loaded = true;
    }
    serialize() {
        return JSON.stringify(this.state);
    }
    async get(key) {
        await this.load();
        return this.state.data[key];
    }
    async set(key, value) {
        await this.load();
        this.state.data[key] = value;
        this.writing = this.writing.then(() => this.persist());
        await this.writing;
    }
    async delete(key) {
        await this.load();
        delete this.state.data[key];
        this.writing = this.writing.then(() => this.persist());
        await this.writing;
    }
    async flush() {
        await this.writing;
    }
    async persist() {
        await (0, promises_1.mkdir)((0, node_path_1.dirname)(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        await (0, promises_1.writeFile)(tmp, this.serialize(), "utf-8");
        await (0, promises_1.writeFile)(this.filePath, this.serialize(), "utf-8");
    }
}
exports.JsonFileStore = JsonFileStore;
//# sourceMappingURL=file.js.map