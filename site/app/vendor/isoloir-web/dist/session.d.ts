import { Mirror, type Fetcher, type MirrorSource } from './mirror.js';
import { type PasskeyOptions } from './passkey.js';
import type { Prover } from './prover.js';
import { type ChannelFactory, type PostProgress } from './channel.js';
import { type KeyValueStore, type StorageMode } from './storage.js';
import type { Channel, Checkpoint, Choice, KindInfo, LedgerSetup, NostrEvent, PassportProof, PollSetup, RegistrationRequest, RegistrySetup, TallyVerdict } from './types.js';
import { Core, type IsoloirWasm } from './wasm.js';
export interface SessionConfig {
    /** The wasm core: the module (loadWasm()) or a Core. */
    core: Core | IsoloirWasm;
    /** The ledger's origin (SPEC §4). */
    origin: string;
    /** The pinned C2SP verifier key of the ledger's log key: every checkpoint is checked under it. */
    verifierKey: string;
    registry: number;
    poll?: number;
    /** Mirror sources, or the base URL of a directory. */
    mirror: MirrorSource[] | string;
    fetch?: Fetcher;
    store?: KeyValueStore;
    /**
     * How a channel of the ledger is reached. The session builds its
     * channels from the ledger setup on the mirror; the default factory
     * (WebSockets for relays, fetch for the direct endpoint) is what an app
     * wants: this is for tests and fakes.
     */
    channels?: ChannelFactory;
    prover?: Prover;
    /** WebAuthn options; the names shown default to the registry's name. */
    passkey?: PasskeyOptions;
    /** The word list of the 12 words: 'en' (default) or 'fr'. */
    wordsLang?: string;
    /** How long an ack is awaited on a channel before the next one (SPEC §11.1: 60 s). */
    ackTimeoutMs?: number;
    publishTimeoutMs?: number;
    /** How often the direct endpoint is asked for a pending ack (default 2 s). */
    directPollMs?: number;
    /** How long a mirror file may take (default 15 s). */
    mirrorTimeoutMs?: number;
    /** The oldest checkpoint a ballot is drafted against, by the local clock (default 30 min). */
    maxCheckpointAgeMs?: number;
    /** How often the mirror is read (0: never; the app calls refresh()). */
    refreshMs?: number;
    /** Follow the ingest's checkpoint events on a relay, when the ledger has one (default true). */
    watchRelays?: boolean;
    /** The local clock, ms (tests). */
    now?: () => number;
    /** Diagnostics: never given a secret. */
    log?: (level: 'debug' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>) => void;
}
export type PostState = 'kept' | 'sent' | 'acked' | 'verified' | 'missing' | 'rejected';
/** A message as the device keeps it: the body (resent in fresh envelopes), the ack, the receipt. */
export interface PostRecord {
    /** The body as signed and logged. */
    body: string;
    hash: string;
    state: PostState;
    /** The last envelope posted, and every envelope a channel took (their acks may come later). */
    event: NostrEvent;
    envelopes?: NostrEvent[];
    /** The channel (its URL) that took it, then the one that acked it. */
    channel?: string;
    sentAt?: number;
    /** The newest checkpoint when it was first posted: its receipt is looked for after it. */
    since?: number;
    ack?: {
        event: NostrEvent;
        checkpoint: number | null;
    };
    reason?: string;
    /** Where the body was found: its log seq and checkpoint. */
    logSeq?: number;
    foundIn?: number;
    /** Found under a later checkpoint than the ack named. */
    late?: boolean;
    complaints?: string[];
}
export interface RegistrationRecord extends PostRecord {
    proofDate: number;
    /** A registration that replaced an earlier one of the same key (a stale proof scanned again). */
    replaced?: boolean;
}
export interface BallotRecord extends PostRecord {
    choice: Choice;
    root: string;
    /** Linked and none: the ballot's seq. */
    ballotSeq?: number;
    /** Delta: the ballot's number in the chain and its ballot tree leaf. */
    i?: number;
    leaf?: string;
}
export interface DeltaRecord {
    next: number;
    previous?: {
        choice: Choice;
        leaf?: string;
        index?: number;
    };
}
export interface PollRecord {
    /** Linked: the last seq acked. */
    seq?: number;
    /** Delta: the chain, with the previous ballot's choice (needed to correct it). */
    delta?: DeltaRecord;
    ballot?: BallotRecord;
}
export type KeySource = 'passkey' | 'words' | 'link';
export interface StoredKey {
    v: 1;
    secret: string;
    source: KeySource;
    words?: string;
    credentialId?: string;
    /**
     * What copies of the key exist: confirmed words, a synced passkey,
     * devices that confirmed a link; or the voter's explicit choice to
     * keep the key on this device alone (declined), which stands for a
     * backup where one is required.
     */
    backups: {
        words: boolean;
        passkey: boolean;
        linked: number;
        declined?: boolean;
    };
    leaf: string;
    position: number;
    regSecret?: string;
    registration?: RegistrationRecord;
    polls: Record<string, PollRecord>;
}
export type Phase = 'loading' | 'no-key' | 'unregistered' | 'registering' | 'joining' | 'ready' | 'error';
export interface RegistrationView {
    state: 'none' | 'scanned' | 'posting' | 'sent' | 'acked' | 'verified' | 'missing' | 'rejected' | 'failed';
    progress?: PostProgress;
    checkpoint?: number | null;
    reason?: string;
    detail?: string;
    /** The proof is too old to post: scan again (the same registration key). */
    stale?: boolean;
}
export interface BallotView {
    state: 'idle' | 'drafting' | 'proving' | 'posting' | 'sent' | 'acked' | 'verified' | 'missing' | 'rejected' | 'failed';
    choice?: Choice;
    progress?: PostProgress;
    checkpoint?: number | null;
    hash?: string;
    reason?: string;
    detail?: string;
    late?: boolean;
    complaints?: string[];
    /** A proven ballot waits for an ack: resendBallot() posts it again. */
    kept?: boolean;
}
/** The answer to a check of the words: `wrong` the 1-based positions that do not match. */
export interface WordsConfirmation {
    ok: boolean;
    wrong: number[];
}
export interface SessionState {
    phase: Phase;
    error: {
        code: string;
        detail: string;
    } | null;
    ledger: LedgerSetup | null;
    registry: RegistrySetup | null;
    poll: PollSetup | null;
    kind: KindInfo | null;
    pollStatus: 'none' | 'upcoming' | 'open' | 'closed';
    checkpoint: Checkpoint | null;
    /** How old the newest checkpoint is by the local clock, seconds; past 30 minutes no ballot is drafted (stale_mirror). */
    checkpointAge: number | null;
    key: {
        leaf: string;
        source: KeySource;
        backedUp: boolean;
        hasWords: boolean;
        position: number | null;
    } | null;
    registration: RegistrationView;
    ballot: BallotView;
    /** The poll's last ballot from this device, as remembered (linked: its seq; delta: the chain). */
    revote: {
        seq: number | null;
        next: number | null;
        previousChoice: Choice | null;
    };
    /** The last tally that verified (never replaced by one that does not). */
    tally: TallyVerdict | null;
    /** A newer tally that did not verify, or could not be proven in the log, and why. */
    tallyUnverified: {
        verdict: TallyVerdict | null;
        error: string;
    } | null;
    prover: 'idle' | 'loading' | 'ready' | 'failed';
    /** The ledger's active channels. */
    channels: Channel[];
    /** Whether a device link can be made (it needs a Nostr relay among the channels). */
    linkAvailable: boolean;
    /** How the key is kept by the browser. */
    storage: StorageMode;
}
export interface SessionEvents {
    state: SessionState;
    checkpoint: Checkpoint;
    receipt: {
        what: 'registration' | 'ballot';
        checkpoint: number;
        logSeq: number;
        late: boolean;
    };
    complaint: {
        what: 'registration' | 'ballot';
        checkpoint: number | null;
        events: string[];
    };
    'link-offer': {
        code: string;
    };
    tally: TallyVerdict;
}
/** A device waiting for a key (SPEC §14): show `publicKey` (as a QR code), confirm the code, `answer`. */
export interface LinkReceiver {
    publicKey: string;
    /** The six digits of the payload that arrived, once one did. */
    offer(): string | null;
    answer(ok: boolean): void;
    stop(): void;
    done: Promise<void>;
}
/** A key sent to another device: the code to show, and whether the receiver adopted it. */
export interface LinkSender {
    code: string;
    /** True once the receiver confirmed (the link then counts as a backup); false after 15 minutes or stop(). */
    confirmed: Promise<boolean>;
    stop(): void;
}
export declare class Session {
    private readonly config;
    readonly core: Core;
    readonly mirror: Mirror;
    private readonly events;
    private readonly store;
    private readonly channelFactory;
    private channels;
    private readonly clock;
    private readonly local;
    private readonly keyName;
    private readonly scanName;
    private readonly cursorName;
    private readonly ackTimeoutMs;
    private ledger;
    private registry;
    private poll;
    private kind;
    private cp;
    private phaseOverride;
    private error;
    private registration;
    private ballot;
    private tally;
    private tallyUnverified;
    private proverState;
    private storageMode;
    private member;
    private seqFloor;
    private dupRetried;
    private timer;
    private stopWatch;
    private refreshing;
    private queued;
    constructor(config: SessionConfig);
    on<K extends keyof SessionEvents>(event: K, fn: (v: SessionEvents[K]) => void): () => void;
    /** Calls fn with the state now and at every change. */
    subscribe(fn: (s: SessionState) => void): () => void;
    state(): SessionState;
    /** The server's time, ms (from the checkpoints): the proof date of a scan is this. */
    serverNow(): number;
    /** Reads the setups (each proven in the log) and the latest checkpoint, then resumes whatever this device left pending. */
    init(): Promise<void>;
    /** Stops the timers and subscriptions. */
    destroy(): void;
    /** Removes this device's key (the vote stays counted). */
    forgetKey(): void;
    /**
     * What the passport request must bind (SPEC §6, step 1): the custom
     * data of a registration key drawn now, before any voter key exists,
     * and kept until the registration is posted.
     */
    registrationRequest(): RegistrationRequest;
    /**
     * The scan: `obtain` runs the passport app (ZKPassport's SDK is the
     * app's business) for the request and returns the proof, which the
     * session keeps until the key exists and the registration is posted.
     */
    scanPassport(obtain: (req: RegistrationRequest) => Promise<PassportProof>): Promise<void>;
    /** Whether a scanned proof is waiting and still fresh enough to post. */
    scanReady(): boolean;
    /** A new key from 12 fresh words; returns them (show them, then confirmWords). */
    createKeyFromWords(): string;
    /** The words of this key, to show again. */
    words(): string | null;
    /** Three (or n) distinct random 1-based positions to ask the voter for. */
    wordChallenge(n?: number): number[];
    /**
     * The voter typed the words back: all twelve, or the words at the
     * 1-based positions asked (wordChallenge). Case and accents do not
     * matter. The backup is confirmed when every one matches.
     */
    confirmWords(words: string): WordsConfirmation;
    confirmWords(positions: number[], answers: string[]): WordsConfirmation;
    /**
     * The voter declines a backup, in so many words: the key stays on this
     * device alone, and the registration may go. The app owns the warning
     * (a lost device means the last ballot stays counted and cannot be
     * changed); the choice is recorded with the key, and the words of a
     * words key remain readable (words()) for a backup made later.
     */
    declineBackup(): void;
    /**
     * A new key from a new passkey's PRF output. Only a synced passkey
     * (backup state set) is a backup: otherwise nothing is kept and
     * passkey_not_backed_up asks for the words instead.
     */
    createKeyWithPasskey(): Promise<void>;
    /**
     * Signs and posts the registration with the scanned proof (SPEC §6,
     * step 3), once the key is backed up. The body is kept before it is
     * posted: a missed ack is a resend (resendRegistration), never a burnt
     * passport. A kept registration whose proof went stale is replaced by
     * one of a fresh scan of the same registration key.
     */
    submitRegistration(): Promise<void>;
    /**
     * The scan, the key, its backup and the post in one call. A words key
     * needs `confirm`: it is given the words and the positions to ask, and
     * returns the voter's answers. Returns the words of a words key.
     */
    register(opts: {
        obtainProof: (req: RegistrationRequest) => Promise<PassportProof>;
        key: 'passkey' | 'words';
        confirm?: (c: {
            words: string;
            positions: number[];
        }) => Promise<string[]>;
    }): Promise<{
        words?: string;
    }>;
    /**
     * Posts the kept registration again (the same body, a fresh envelope)
     * while its proof is fresh; with a stale proof and a fresh scan of the
     * same registration key, a new registration replaces it.
     */
    resendRegistration(): Promise<void>;
    /** The key of 12 words, found again: registered, it votes from this device. */
    restoreFromWords(words: string): Promise<void>;
    /** The key of a passkey of this site (any device of the ecosystem). */
    restoreWithPasskey(): Promise<void>;
    /**
     * Waits for a key from another device (SPEC §14): show `publicKey`;
     * when a payload arrives, its six digits come as a 'link-offer' event;
     * the voter compares them with the sender's and `answer(true)` adopts
     * the key, then confirms it to the sender. Ends after 15 minutes.
     * Needs a Nostr relay among the ledger's channels (link_unavailable).
     */
    receiveLink(): LinkReceiver;
    /**
     * Sends this device's key to a device that shows `receiverPublic`
     * (33-byte compressed key, hex). Show `code` for the voter to compare;
     * `confirmed` resolves true once the receiver adopted the key: only
     * then does the link count as a backup.
     */
    sendKeyTo(receiverPublic: string): Promise<LinkSender>;
    /**
     * Casts a choice: drafts it with the wasm core against the latest
     * checkpoint (at most 30 minutes old), proves it, keeps it, posts it
     * and waits for the ack. A re-vote continues the key's chain (linked:
     * the next seq; delta: the correction of the previous ballot).
     */
    cast(choice: Choice): Promise<void>;
    /** Posts the kept ballot again (the same body in a fresh envelope: the ingest answers a body once). */
    resendBallot(): Promise<void>;
    /** Drops a kept ballot no channel acknowledged (to cast another choice). */
    discardKeptBallot(): void;
    /**
     * Reads the mirror: the latest checkpoint, then whatever waits on it
     * (a registration's position, a ballot's receipt, a complaint), then
     * the latest tally.
     */
    refresh(): Promise<void>;
    private readMirror;
    /**
     * The latest tally of the poll, proven in the log and verified by the
     * wasm core. The state keeps the last one that verified; a newer one
     * that does not (or a tlock tally, whose openings only an auditor can
     * check) goes to `tallyUnverified`.
     */
    refreshTally(): Promise<TallyVerdict | null>;
    private log;
    private emit;
    private lang;
    private key;
    private saveKey;
    private requireKey;
    private requireNoKey;
    private requireRegistry;
    private requirePoll;
    private requireCheckpoint;
    private token;
    private phase;
    private pollStatus;
    private backedUp;
    private pollRecord;
    private newKey;
    /** The active Nostr relays (live reads, device links). */
    private relays;
    /**
     * The key's order of the channels it posts to (SPEC §11.1):
     * relay_ranking over their URLs. The relays when the ledger has some
     * (the direct endpoint shows the operator the voter's address), the
     * direct endpoints when it has none.
     */
    private ranking;
    /** Ballots go to the key's channels after the first, never to the registration's, unless there is only one. */
    private ballotChannels;
    /** The relay that serves live checkpoints: neither the registration's nor the ballots' when there are three or more. */
    private watchRelays;
    private ingest;
    /** An envelope of a fresh throwaway key, dated to the minute on the server's clock. */
    private signEvent;
    private proofFresh;
    private takeCheckpoint;
    private refreshCheckpoint;
    /** Sets the views from the records a previous visit left. */
    private resume;
    private ballotView;
    private start;
    /** Follows the ingest's checkpoint events on a relay; a relay that fails gives way to the next. */
    private watchCheckpoints;
    /** Keeps a posted envelope with its record. */
    private keepEnvelope;
    private recordRegistration;
    private postRegistration;
    /** Keeps a registration's ack and acts on its outcome. */
    private applyRegistrationAck;
    /**
     * Messages a previous visit posted and never saw acked: their acks are
     * asked of the channel that took them only (a relay's stored events,
     * the direct endpoint's GET), so a closed tab does not leave them
     * waiting and no other channel learns of them.
     */
    private recoverAcks;
    private submitBallot;
    /** Keeps an accepted ballot's ack and moves the key's chain on. */
    private applyBallotAck;
    /** The key's place in the registry tree at a checkpoint, rebuilt from the mirror's leaves. */
    private memberPath;
    /** Where the ballot stands in the key's chain (SPEC §7.4). */
    private revoting;
    /** Whether a record still looks for its receipt. */
    private waiting;
    private cursor;
    /**
     * Reads the entries of every checkpoint since the last one read, in
     * order, while a registration or a ballot waits for its receipt: the
     * same files whatever the ack said, so what is fetched reveals nothing
     * about which checkpoint holds the voter's message. A registration's
     * position comes from the entries too (the registry's size at its
     * checkpoint, its rank among the registrations there).
     */
    private readReceipts;
    private registrationFound;
    private ballotFound;
    /**
     * The ack named a checkpoint whose entries lack the body (SPEC §11.3):
     * the complaint, the signed ack and the body, goes to every active
     * relay, where anyone can read it, and the message itself is posted
     * there again; on a ledger without relays, to the direct endpoints. It
     * stays with the device too (the record's complaints and ack).
     */
    private complain;
    private adopt;
    private adoptLinked;
    /** Tells the sender the key was adopted (sealed for its reply key). */
    private confirmLink;
}
