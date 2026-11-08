import type { Core } from './wasm.js';
/** How far back the ingest takes t (SPEC §11.1). */
export declare const POW_PAST = 7200;
/** How far ahead the ingest takes t. */
export declare const POW_FUTURE = 300;
/** A key's work is used up to this long before it expires: the margin for clocks and a slow post. */
export declare const POW_MARGIN = 900;
/** A throwaway key and its work. */
export interface WorkKey {
    /** The key's secret (hex): it signs the envelopes of one body. */
    secret: string;
    /** Its x-only public key, the envelopes' pubkey. */
    pubkey: string;
    /** The difficulty mined for (0: no work, no tag). */
    bits: number;
    /** The time the work is bound to (unix seconds) and the nonce; absent when bits is 0. */
    t?: number;
    nonce?: string;
}
export interface MineOptions {
    /** Hashes per slice at the start (default 2048); the slice then grows to about `sliceMs`. */
    chunk?: number;
    /** The time a slice may take before the page gets the thread back (default 8 ms). */
    sliceMs?: number;
    /** Gives the thread back between slices (default: a macrotask). */
    yieldTo?: () => Promise<void>;
    signal?: AbortSignal;
    /** How many hashes were tried, at the end (diagnostics, benchmarks). */
    onDone?: (tries: number, ms: number) => void;
}
/** A macrotask: MessageChannel where there is one (no 4 ms clamp), else setTimeout. */
export declare function nextTask(): Promise<void>;
/** Finds a nonce for a key and a time, slice by slice. */
export declare function mine(core: Core, origin: string, pubkey: string, t: number, bits: number, opts?: MineOptions): Promise<string>;
/** A fresh throwaway key with its work for `bits` at time `t` (unix seconds). */
export declare function workKey(core: Core, origin: string, bits: number, t: number, opts?: MineOptions): Promise<WorkKey>;
/** Whether a key's work is enough for `bits` and still inside the ingest's window at `now` (unix seconds). */
export declare function workUsable(k: WorkKey, bits: number, now: number): boolean;
/** The tag of a key's work, none when it did none. */
export declare function powTags(k: WorkKey): string[][];
/**
 * The keys of a session's envelopes: one mined ahead (start()), taken by
 * the next envelope, the next one mined as soon as it is taken.
 */
export declare class WorkPool {
    private readonly core;
    private readonly origin;
    /** The ledger's difficulty now. */
    private readonly bits;
    /** The server's time, unix seconds. */
    private readonly now;
    private readonly opts;
    private spare;
    private spareFor;
    constructor(core: Core, origin: string, 
    /** The ledger's difficulty now. */
    bits: () => number, 
    /** The server's time, unix seconds. */
    now: () => number, opts?: MineOptions);
    /** Mines a key ahead, unless one is being mined or ready for the current difficulty. */
    start(): Promise<WorkKey>;
    /** Whether a key is mined (or being mined) for the next body. */
    get started(): boolean;
    /**
     * The key of one envelope: the spare (waited for while it is mined),
     * and the next spare starts. Every envelope takes its own, so an
     * attempt on the next channel is a fresh envelope (a new id) and a key
     * never carries two bodies.
     */
    take(): Promise<WorkKey>;
}
