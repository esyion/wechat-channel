"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryStore = void 0;
/**
 * In-process `Map`-backed `Store`. Useful for tests and ephemeral bots.
 *
 * Data does not survive process restart. `flush()` is a no-op since all
 * writes are synchronous.
 */
class MemoryStore {
    map = new Map();
    async get(key) {
        return this.map.get(key);
    }
    async set(key, value) {
        this.map.set(key, value);
    }
    async delete(key) {
        this.map.delete(key);
    }
    async flush() {
        // No-op: all writes are synchronous.
    }
}
exports.MemoryStore = MemoryStore;
//# sourceMappingURL=memory.js.map