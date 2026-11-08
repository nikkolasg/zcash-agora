import { type AuditRequest } from './audit.js';
import { Mirror, type Fetcher, type MirrorSource } from './mirror.js';
import type { ComplaintClaim, NostrEvent } from './types.js';
import { Core, type IsoloirWasm } from './wasm.js';
/** The base64url (no padding) of a complaint event's JSON: what a link fragment (`#c=…`) or a file carries. */
export declare function encodeComplaint(event: NostrEvent): string;
/** A complaint event from its base64url (a link's `#c=` value, with or without `#c=`), or its JSON text. */
export declare function decodeComplaint(text: string): NostrEvent;
/**
 * Reads a complaint: an event, its base64url or its JSON. Checks the
 * event's signature, the complaint's form, the ack's signature (by one of
 * `ingestKeys` when given) and that the ack names the body. Throws
 * bad_complaint otherwise. Judges nothing against the log: judgeComplaint.
 */
export declare function readComplaint(core: Core | IsoloirWasm, input: NostrEvent | string, ingestKeys?: string[]): ComplaintClaim;
export type ComplaintVerdictCode = 
/** The claim holds: the ingest dropped an accepted message, or refused a valid one. */
'holds'
/** The claim fails: the body is in the checkpoint its ack named, or the judge refuses it too. */
 | 'fails'
/** The mirror does not cover the checkpoint the ack names yet: judge again later. */
 | 'pending'
/** Judged again, the refusal depends on the second within the ack's minute or on the messages pending then. */
 | 'uncertain'
/** A proof the judge needs could not be checked (no verifier, or it failed to run). */
 | 'unchecked'
/** Not a complaint of this ledger: its form, a signature, or an ack not signed by the ledger's ingest. */
 | 'invalid';
export interface ComplaintVerdict {
    verdict: ComplaintVerdictCode;
    /** What the verdict rests on, in a sentence. */
    detail: string;
    /** What the complaint claims (absent when it could not be read). */
    claim?: ComplaintClaim;
    /** dropped: where the body is in the log, when it is (late: after the checkpoint the ack named). */
    found?: {
        checkpoint: number;
        seq: number;
        late: boolean;
    } | null;
    /** wrong_refusal: the judge's answers, at the first and the last second of the ack's minute, without and with the next checkpoint's entries pending. */
    rejudged?: {
        time: number;
        pending: boolean;
        outcome: 'accepted' | 'rejected' | 'deferred';
        reason: string | null;
    }[];
    /** The newest checkpoint the mirror covers when judged. */
    upto?: number;
}
export interface JudgeComplaintOptions {
    /** The ledger's mirror: sources, a directory URL, or a Mirror. */
    mirror: MirrorSource[] | string | Mirror;
    /** The ledger's pinned log key (the app's configuration, never the mirror's). */
    verifierKey: string;
    fetch?: Fetcher;
    /** A refusal judged again may need a ballot proof checked (bbVerifier). */
    verifyProof?(req: Extract<AuditRequest, {
        type: 'proof';
    }>): Promise<boolean>;
    /** …or a passport proof (zkPassportVerifier). */
    verifyPassport?(req: Extract<AuditRequest, {
        type: 'passport';
    }>): Promise<string | null>;
    /** Accepts the dev passport provider (a local trial). */
    allowDev?: boolean;
    /** How many checkpoints after the named one a dropped body is looked for (default 16). */
    lateSearch?: number;
    signal?: AbortSignal;
    /** A refusal judged again replays the log: checkpoints read so far, of how many. */
    onProgress?(p: {
        checkpoint: number;
        checkpoints: number;
    }): void;
}
/** Judges a complaint against the ledger's mirror (SPEC §11.3). */
export declare function judgeComplaint(core: Core | IsoloirWasm, input: NostrEvent | string, opts: JudgeComplaintOptions): Promise<ComplaintVerdict>;
