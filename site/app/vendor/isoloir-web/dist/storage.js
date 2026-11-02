// Where the session keeps the voter's key and what it posted: one small
// synchronous key-value interface, localStorage by default. The app may
// give its own (an encrypted store, IndexedDB behind a cache). The secret
// lives here and nowhere else: never in logs, never in events.
export class MemoryStore {
    m = new Map();
    get(key) {
        return this.m.get(key) ?? null;
    }
    set(key, value) {
        this.m.set(key, value);
    }
    remove(key) {
        this.m.delete(key);
    }
    async persist() {
        return 'memory';
    }
}
/** The browser's localStorage, or memory where there is none. */
export function defaultStore() {
    try {
        const ls = globalThis.localStorage;
        if (ls) {
            const probe = '__isoloir_probe__';
            ls.setItem(probe, '1');
            ls.removeItem(probe);
            return {
                get: (k) => ls.getItem(k),
                set: (k, v) => ls.setItem(k, v),
                remove: (k) => ls.removeItem(k),
                persist: async () => {
                    try {
                        const st = globalThis.navigator?.storage;
                        if (!st?.persist)
                            return 'best-effort';
                        if (st.persisted && (await st.persisted()))
                            return 'persistent';
                        return (await st.persist()) ? 'persistent' : 'best-effort';
                    }
                    catch {
                        return 'best-effort';
                    }
                }
            };
        }
    }
    catch {
        // Storage blocked (a private window, a policy): memory only.
    }
    return new MemoryStore();
}
export function readJSON(store, key) {
    const raw = store.get(key);
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function writeJSON(store, key, value) {
    if (value === null || value === undefined)
        store.remove(key);
    else
        store.set(key, JSON.stringify(value));
}
//# sourceMappingURL=storage.js.map