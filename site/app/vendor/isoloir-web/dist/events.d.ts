export type Listener<T> = (value: T) => void;
export declare class Emitter<E extends object> {
    private readonly listeners;
    on<K extends keyof E>(event: K, fn: Listener<E[K]>): () => void;
    emit<K extends keyof E>(event: K, value: E[K]): void;
}
/** The server's clock, learned from checkpoints (SPEC §4: each carries the ingest's time). */
export declare class ServerClock {
    private readonly local;
    private bound;
    private live;
    constructor(local: () => number);
    /**
     * A checkpoint is read after it was signed, never before: its time minus
     * the local time is a lower bound of the offset (it corrects a clock
     * that is behind). One that arrived live on a relay is the offset.
     */
    note(unixSeconds: number, isLive?: boolean): void;
    /** The server's now, in milliseconds. */
    now(): number;
}
