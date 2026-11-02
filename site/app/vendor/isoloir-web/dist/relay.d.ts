import type { NostrEvent } from './types.js';
export interface Filter {
    ids?: string[];
    kinds?: number[];
    authors?: string[];
    since?: number;
    limit?: number;
    '#e'?: string[];
    '#t'?: string[];
}
export interface SubscribeOptions {
    /** The relay sent its stored events (EOSE). */
    onEose?: () => void;
    /** The relay failed three times in a row or refused the subscription. */
    onDown?: () => void;
}
export interface RelayTransport {
    /** Posts an event; resolves when the relay accepted it (OK true). */
    publish(url: string, event: NostrEvent, timeoutMs: number): Promise<void>;
    /** Reads events, stored then live, until the returned stop is called. */
    subscribe(url: string, filter: Filter, onEvent: (e: NostrEvent) => void, opts?: SubscribeOptions): () => void;
}
/** The subset of WebSocket the transport uses. */
export interface SocketLike {
    onopen: ((ev: unknown) => void) | null;
    onmessage: ((ev: {
        data: unknown;
    }) => void) | null;
    onerror: ((ev: unknown) => void) | null;
    onclose: ((ev: unknown) => void) | null;
    send(data: string): void;
    close(): void;
}
export type SocketFactory = (url: string) => SocketLike;
/** Nostr over WebSockets: one socket per publish, one per subscription. */
export declare class WebSocketTransport implements RelayTransport {
    private readonly socket;
    constructor(socket?: SocketFactory);
    publish(url: string, event: NostrEvent, timeoutMs: number): Promise<void>;
    subscribe(url: string, filter: Filter, onEvent: (e: NostrEvent) => void, opts?: SubscribeOptions): () => void;
}
