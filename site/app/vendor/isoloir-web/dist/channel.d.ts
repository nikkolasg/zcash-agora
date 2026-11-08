import { type Filter, type RelayTransport, type SubscribeOptions } from './relay.js';
import type { Ack, Channel, NostrEvent } from './types.js';
import type { Core } from './wasm.js';
/** What an ack must be to count: signed by the ingest, naming the envelope and its body hash. */
export interface AckMatch {
    /** The ack kinds: 27102, and 7102 (the answer to a legacy envelope). */
    kinds: number[];
    /** The ingest's key. */
    ingest: string;
    /** Whether an event is this envelope's ack (the signature checked). */
    accept(e: NostrEvent): boolean;
}
export interface SendOptions {
    /** How long the ack is awaited once the channel took the envelope. */
    waitMs: number;
    match: AckMatch;
    /** The channel took the envelope (the ack may still come). */
    onPosted?: () => void;
}
/** One way to the ingest. */
export interface IngestChannel {
    readonly type: Channel['type'];
    readonly url: string;
    /**
     * Posts an envelope and waits for its ack: the ack event, or null when
     * the channel took the envelope and no ack came in time. Throws when the
     * channel did not take it.
     */
    send(event: NostrEvent, opts: SendOptions): Promise<NostrEvent | null>;
    /**
     * The ack of an envelope posted before (a missed ack, a reload), or
     * null: only a channel whose endpoint keeps acks (direct). Relays keep
     * nothing (ephemeral kinds), so a relay channel has none.
     */
    ackOf?(eventId: string, opts: {
        waitMs: number;
        match: AckMatch;
    }): Promise<NostrEvent | null>;
    /** Posts without waiting for an ack (complaints, device links). */
    publish(event: NostrEvent): Promise<void>;
    /** Reads live events (relays only). */
    subscribe?(filter: Filter, onEvent: (e: NostrEvent) => void, opts?: SubscribeOptions): () => void;
}
/**
 * Builds the channel of a ledger entry (the default: WebSockets and
 * fetch), or null for a type it cannot reach (iroh, until built): the
 * session then leaves that channel out.
 */
export type ChannelFactory = (c: Channel) => IngestChannel | null;
export declare class NostrChannel implements IngestChannel {
    readonly url: string;
    private readonly transport;
    private readonly publishTimeoutMs;
    readonly type: "nostr";
    constructor(url: string, transport?: RelayTransport, publishTimeoutMs?: number);
    private waitAck;
    send(event: NostrEvent, opts: SendOptions): Promise<NostrEvent | null>;
    publish(event: NostrEvent): Promise<void>;
    subscribe(filter: Filter, onEvent: (e: NostrEvent) => void, opts?: SubscribeOptions): () => void;
}
export interface HttpResponse {
    status: number;
    ok: boolean;
    text(): Promise<string>;
}
export type HttpFetch = (url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    credentials?: string;
    cache?: string;
    signal?: AbortSignal;
}) => Promise<HttpResponse>;
export interface DirectOptions {
    /** How often a pending envelope's ack is asked for (GET). */
    pollMs?: number;
    /** How long a publish (no ack awaited) waits for the response. */
    publishTimeoutMs?: number;
    /** How long a GET may take (default 10 s); a POST may take the ack wait plus this. */
    requestTimeoutMs?: number;
}
export declare class DirectChannel implements IngestChannel {
    readonly url: string;
    private readonly http;
    readonly type: "direct";
    private readonly base;
    private readonly pollMs;
    private readonly publishTimeoutMs;
    private readonly requestTimeoutMs;
    constructor(url: string, http?: HttpFetch, opts?: DirectOptions);
    /** POST /v1/messages; the endpoint holds it up to 55 s while the ingest judges. */
    private post;
    /** GET /v1/acks/{id}: the ack, or null (404). */
    private get;
    private getMatching;
    send(event: NostrEvent, opts: SendOptions): Promise<NostrEvent | null>;
    ackOf(eventId: string, opts: {
        waitMs: number;
        match: AckMatch;
    }): Promise<NostrEvent | null>;
    publish(event: NostrEvent): Promise<void>;
}
/**
 * The default channels: WebSockets for relays, fetch for the direct
 * endpoint; none for iroh (not built: an app that has an iroh transport
 * gives its own factory, the rest is unchanged).
 */
export declare function defaultChannelFactory(opts?: {
    transport?: RelayTransport;
    http?: HttpFetch;
    publishTimeoutMs?: number;
    directPollMs?: number;
}): ChannelFactory;
/** The order of the channel types (SPEC §11.1): relays first, the direct endpoint (the voter's address shown to the operator) last. */
export declare const CHANNEL_ORDER: readonly Channel['type'][];
/** Where a post stands, for the page. */
export interface PostProgress {
    channel: string;
    type: Channel['type'];
    n: number;
    of: number;
    stage: 'posting' | 'waiting';
}
export interface PostOptions {
    ackTimeoutMs: number;
    /** A channel took this envelope (keep it: its ack may come later). */
    onPosted?: (channel: string, envelope: NostrEvent) => void;
    onProgress?: (p: PostProgress) => void;
}
export interface Acked {
    channel: string;
    ack: Ack;
    ackEvent: NostrEvent;
    /** The envelope the ack names. */
    envelope: NostrEvent;
}
/** Makes an envelope of a body for an attempt: the body's throwaway key (and its work), the time of the attempt. */
export type Envelope = () => NostrEvent | Promise<NostrEvent>;
/** The match of an envelope's ack: the ingest's signature, the envelope id, the body's hash. */
export declare function ackMatch(core: Core, event: NostrEvent, ingest: string): AckMatch;
/**
 * Posts a body to the channels in turn and waits for the ingest's ack on
 * each (SPEC §11.1, §11.2): `ackTimeoutMs` (60 s) on one, then the next.
 * Every attempt wraps the body in a fresh envelope (the time of the
 * attempt, so a new id); the ingest answers the same body under any
 * envelope with the same outcome. Acks are matched by the envelope's id
 * and the body's hash. Throws no_relay when no channel took it, no_ack
 * when some did and none answered.
 */
export declare function postWithAck(core: Core, channels: IngestChannel[], envelope: Envelope, ingest: string, opts: PostOptions): Promise<Acked>;
/** The ack of an envelope posted before, asked of the channel that took it (when it keeps acks: direct). */
export declare function findAck(core: Core, channel: IngestChannel, events: NostrEvent[], ingest: string, waitMs: number): Promise<Acked | null>;
