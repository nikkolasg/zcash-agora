import type { Checkpoint, Entry, Logged, Setup } from './types.js';
import type { Core } from './wasm.js';
export declare const SHARD = 1024;
/**
 * The newest checkpoint whose files a note's commit holds (SPEC §15): the
 * index its `mirror` line names, the note's own index for a note of an
 * earlier version or one without a commit (a directory of the latest
 * files).
 */
export declare function covered(cp: Checkpoint): number;
export interface FetchResponse {
    status: number;
    ok: boolean;
    text(): Promise<string>;
}
export type Fetcher = (url: string, init?: {
    cache?: string;
    credentials?: string;
    signal?: AbortSignal;
}) => Promise<FetchResponse>;
/** A fetch that gives up after `ms`: a hung request never freezes the session. */
export declare function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T>;
export interface MirrorSource {
    /** The address of a path at a commit token ('' for the latest files). */
    url(path: string, token: string): string;
    /** Whether the source honours tokens (a git repository read by commit). */
    byCommit: boolean;
}
/** A URL with a query no cache has seen, for a file that changes. */
export declare function fresh(url: string): string;
/** A directory of the latest files (a static host). */
export declare function dirSource(base: string): MirrorSource;
/** A GitHub repository read through jsDelivr by commit. */
export declare function jsDelivrSource(repo: string, branch?: string): MirrorSource;
export declare class Mirror {
    private readonly core;
    private readonly sources;
    private readonly verifierKey;
    private readonly timeoutMs;
    private readonly fetcher;
    private readonly notes;
    constructor(core: Core, sources: MirrorSource[], verifierKey: string, fetcher?: Fetcher, timeoutMs?: number);
    private attempts;
    /** A file's text, or null when no source has it; throws mirror when every source failed. */
    text(path: string, token?: string): Promise<string | null>;
    json<T>(path: string, token?: string): Promise<T | null>;
    /** Verifies a note under the pinned key; throws log_key when it does not hold. */
    verify(note: string): Checkpoint;
    /** The newest checkpoint, verified. */
    latest(): Promise<Checkpoint | null>;
    /** Checkpoint i, verified (kept once read). */
    checkpoint(index: number, token?: string): Promise<Checkpoint | null>;
    /** The entries of checkpoint i, null while the mirror has none. */
    entries(index: number, token?: string): Promise<Entry[] | null>;
    /**
     * Proves an entry in the log: checkpoint c's note (verified under the
     * pinned key) has the size the proof is for, and the proof leads from
     * the entry's leaf to its root. Throws unproven otherwise.
     */
    prove(rec: Logged, kind: string, what: string): Promise<Checkpoint>;
    /** A setup file (SPEC §15): its last version, proven in the log, decoded by the wasm core. */
    setup<T>(path: string, kind: string, token?: string): Promise<Setup<T> | null>;
    /** Every version of a setup file, each proven in the log, in order (a ledger's ingest keys over time). */
    setupHistory<T>(path: string, kind: string, token?: string): Promise<Setup<T>[]>;
    /** The first `size` leaves of a sharded tree file set. */
    leaves(dir: string, size: number, token?: string): Promise<string[]>;
    /** The latest tally: its body text and seq, proven in the log. */
    latestTally(poll: number, token?: string): Promise<{
        seq: number;
        body: string;
        checkpoint: number;
    } | null>;
}
