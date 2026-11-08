// The ways to the ingest (SPEC §11.1): the ledger lists channels, each a
// Nostr relay, the ingest's iroh node (through its relay) or the ingest's
// own HTTP endpoint ("direct"). Every channel carries the same signed
// envelopes (Nostr events) and brings back the same signed acks (kind
// 27102, or 7102 for a legacy envelope; the ingest's key; tag e = the
// envelope id), so the session never cares which one it uses: it orders
// them (nostr, iroh, direct last), posts to the first, waits for the ack,
// and moves to the next in a fresh envelope when none comes. Channels are
// transport only: nothing here reads a relay's past events.
//
//   nostr   subscribe to the ack (#e), then publish the event
//   iroh    not built: a ChannelFactory may give one (one envelope per
//           message, the ack back on the same connection), nothing else
//           changes
//   direct  POST {url}/v1/messages: 200 the ack, 202 {pending} (judged
//           later); GET {url}/v1/acks/{id}: 200 the ack, 404 none yet
import { IsoloirError } from './errors.js';
import { withTimeout } from './mirror.js';
import { WebSocketTransport } from './relay.js';
// ------------------------------------------------------------ nostr
export class NostrChannel {
    url;
    transport;
    publishTimeoutMs;
    type = 'nostr';
    constructor(url, transport = new WebSocketTransport(), publishTimeoutMs = 10_000) {
        this.url = url;
        this.transport = transport;
        this.publishTimeoutMs = publishTimeoutMs;
    }
    waitAck(eventId, match) {
        let settle = () => { };
        const got = new Promise((r) => (settle = r));
        const stop = this.transport.subscribe(this.url, { kinds: match.kinds, authors: [match.ingest], '#e': [eventId] }, (e) => {
            if (match.accept(e))
                settle(e);
        }, { onDown: () => settle(null) });
        return { got, settle, stop };
    }
    async send(event, opts) {
        // Listen first: an ack may come before the relay's OK.
        const w = this.waitAck(event.id, opts.match);
        try {
            await this.transport.publish(this.url, event, this.publishTimeoutMs);
        }
        catch (e) {
            w.stop();
            throw e;
        }
        opts.onPosted?.();
        const timer = setTimeout(() => w.settle(null), opts.waitMs);
        const ack = await w.got;
        clearTimeout(timer);
        w.stop();
        return ack;
    }
    publish(event) {
        return this.transport.publish(this.url, event, this.publishTimeoutMs);
    }
    subscribe(filter, onEvent, opts) {
        return this.transport.subscribe(this.url, filter, onEvent, opts);
    }
}
const defaultFetch = (url, init) => fetch(url, init);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class DirectChannel {
    url;
    http;
    type = 'direct';
    base;
    pollMs;
    publishTimeoutMs;
    requestTimeoutMs;
    constructor(url, http = defaultFetch, opts = {}) {
        this.url = url;
        this.http = http;
        this.base = url.replace(/\/$/, '');
        this.pollMs = opts.pollMs ?? 2000;
        this.publishTimeoutMs = opts.publishTimeoutMs ?? 10_000;
        this.requestTimeoutMs = opts.requestTimeoutMs ?? 10_000;
    }
    /** POST /v1/messages; the endpoint holds it up to 55 s while the ingest judges. */
    post(event, timeoutMs) {
        return withTimeout(timeoutMs, async (signal) => {
            const r = await this.http(`${this.base}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event), credentials: 'omit', signal });
            return { status: r.status, text: await r.text().catch(() => '') };
        });
    }
    /** GET /v1/acks/{id}: the ack, or null (404). */
    get(eventId) {
        return withTimeout(this.requestTimeoutMs, async (signal) => {
            const r = await this.http(`${this.base}/v1/acks/${eventId}`, { credentials: 'omit', cache: 'no-store', signal });
            if (r.status === 404)
                return null;
            if (r.status !== 200)
                throw new Error(`${this.url}: HTTP ${r.status}`);
            return JSON.parse(await r.text());
        });
    }
    async getMatching(eventId, match) {
        try {
            const a = await this.get(eventId);
            return a && match.accept(a) ? a : null;
        }
        catch {
            return null;
        }
    }
    async send(event, opts) {
        const deadline = Date.now() + opts.waitMs;
        let res;
        try {
            res = await this.post(event, opts.waitMs + this.requestTimeoutMs);
        }
        catch (e) {
            // The response was lost, not necessarily the message: ask for its ack.
            const ack = await this.getMatching(event.id, opts.match);
            if (ack) {
                opts.onPosted?.();
                return ack;
            }
            throw new Error(`${this.url}: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (res.status === 200) {
            opts.onPosted?.();
            try {
                const ack = JSON.parse(res.text);
                if (opts.match.accept(ack))
                    return ack;
            }
            catch {
                // not an ack: ask again below
            }
        }
        else if (res.status === 202) {
            // Judged later (a deferred check): the ack comes by GET.
            opts.onPosted?.();
        }
        else {
            throw new Error(`${this.url} refused: HTTP ${res.status} ${res.text}`.trim());
        }
        while (Date.now() < deadline) {
            await sleep(Math.max(0, Math.min(this.pollMs, deadline - Date.now())));
            const ack = await this.getMatching(event.id, opts.match);
            if (ack)
                return ack;
        }
        return null;
    }
    ackOf(eventId, opts) {
        return this.getMatching(eventId, opts.match);
    }
    async publish(event) {
        // The endpoint holds a request it does not acknowledge (a complaint)
        // for up to a minute: once sent, the message is there.
        let timer;
        const sent = this.post(event, 60_000 + this.requestTimeoutMs).then((r) => {
            if (r.status !== 200 && r.status !== 202)
                throw new Error(`${this.url} refused: HTTP ${r.status}`);
        });
        sent.catch(() => undefined);
        const waited = new Promise((r) => (timer = setTimeout(r, this.publishTimeoutMs)));
        try {
            await Promise.race([sent, waited]);
        }
        finally {
            clearTimeout(timer);
        }
    }
}
/**
 * The default channels: WebSockets for relays, fetch for the direct
 * endpoint; none for iroh (not built: an app that has an iroh transport
 * gives its own factory, the rest is unchanged).
 */
export function defaultChannelFactory(opts = {}) {
    const transport = opts.transport ?? new WebSocketTransport();
    return (c) => {
        if (c.type === 'nostr')
            return new NostrChannel(c.url, transport, opts.publishTimeoutMs);
        if (c.type === 'direct')
            return new DirectChannel(c.url, opts.http ?? defaultFetch, { pollMs: opts.directPollMs, publishTimeoutMs: opts.publishTimeoutMs });
        return null;
    };
}
/** The order of the channel types (SPEC §11.1): relays first, the direct endpoint (the voter's address shown to the operator) last. */
export const CHANNEL_ORDER = ['nostr', 'iroh', 'direct'];
/** The match of an envelope's ack: the ingest's signature, the envelope id, the body's hash. */
export function ackMatch(core, event, ingest) {
    const hash = core.bodyHash(event.content);
    return {
        kinds: [core.kinds.ack, core.kinds.legacy.ack],
        ingest,
        accept: (e) => {
            try {
                const a = core.readAck(e, ingest);
                return a.of === event.id && a.hash === hash;
            }
            catch {
                return false;
            }
        }
    };
}
/**
 * Posts a body to the channels in turn and waits for the ingest's ack on
 * each (SPEC §11.1, §11.2): `ackTimeoutMs` (60 s) on one, then the next.
 * Every attempt wraps the body in a fresh envelope (the time of the
 * attempt, so a new id); the ingest answers the same body under any
 * envelope with the same outcome. Acks are matched by the envelope's id
 * and the body's hash. Throws no_relay when no channel took it, no_ack
 * when some did and none answered.
 */
export async function postWithAck(core, channels, envelope, ingest, opts) {
    let posted = 0;
    let lastErr = 'no channel';
    let n = 0;
    for (const ch of channels) {
        n++;
        const at = { channel: ch.url, type: ch.type, n, of: channels.length };
        opts.onProgress?.({ ...at, stage: 'posting' });
        const event = await envelope();
        const match = ackMatch(core, event, ingest);
        let ack;
        try {
            ack = await ch.send(event, {
                waitMs: opts.ackTimeoutMs,
                match,
                onPosted: () => {
                    posted++;
                    opts.onPosted?.(ch.url, event);
                    opts.onProgress?.({ ...at, stage: 'waiting' });
                }
            });
        }
        catch (e) {
            lastErr = e instanceof Error ? e.message : String(e);
            continue;
        }
        if (ack)
            return { channel: ch.url, ack: core.readAck(ack, ingest), ackEvent: ack, envelope: event };
        lastErr = `${ch.url}: no acknowledgement`;
    }
    throw new IsoloirError(posted > 0 ? 'no_ack' : 'no_relay', lastErr);
}
/** The ack of an envelope posted before, asked of the channel that took it (when it keeps acks: direct). */
export async function findAck(core, channel, events, ingest, waitMs) {
    if (!channel.ackOf)
        return null;
    for (const event of events) {
        const ack = await channel.ackOf(event.id, { waitMs, match: ackMatch(core, event, ingest) }).catch(() => null);
        if (ack)
            return { channel: channel.url, ack: core.readAck(ack, ingest), ackEvent: ack, envelope: event };
    }
    return null;
}
//# sourceMappingURL=channel.js.map