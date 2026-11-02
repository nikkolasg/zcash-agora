export interface KeyValueStore {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
    /**
     * Asks that the data survive storage pressure; says how it is kept:
     * persistent (the browser granted it), best-effort (it may be evicted),
     * memory (lost with the page). A store without it is best-effort.
     */
    persist?(): Promise<StorageMode>;
}
export type StorageMode = 'persistent' | 'best-effort' | 'memory';
export declare class MemoryStore implements KeyValueStore {
    private readonly m;
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
    persist(): Promise<StorageMode>;
}
/** The browser's localStorage, or memory where there is none. */
export declare function defaultStore(): KeyValueStore;
export declare function readJSON<T>(store: KeyValueStore, key: string): T | null;
export declare function writeJSON(store: KeyValueStore, key: string, value: unknown): void;
