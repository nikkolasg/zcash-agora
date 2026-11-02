import type { IsoloirWasm } from './wasm.js';
import type { Eligibility } from './types.js';
import type { RelayTransport } from './relay.js';
/** A proof the judge asked for. */
export type AuditRequest = {
    key: string;
    type: 'proof';
    circuit: string;
    vk_hash: string;
    proof: string;
    inputs: string[];
} | {
    key: string;
    type: 'passport';
    eligibility: Eligibility;
    proof: {
        proofs?: unknown[];
        result?: Record<string, unknown>;
    } & Record<string, unknown>;
    custom_data: string;
    proof_date: number;
};
/** The counts and findings of an audit. */
export interface AuditReport {
    problems: string[];
    warnings: string[];
    checkpoints: number;
    entries: number;
    registrations: number;
    ballots: number;
    rejects: number;
    tallies: number;
}
export interface AuditResult extends AuditReport {
    /** Ballot proofs and passport proofs checked in the page. */
    proofs: {
        checked: number;
        failed: number;
    };
    passports: {
        checked: number;
        failed: number;
    };
    /** Events read from the relays, and the relays read (null: not checked). */
    relays: {
        events: number;
        read: string[];
        failed: string[];
    } | null;
    polls: {
        id: number;
        title: string;
        ballots: number;
    }[];
    ok: boolean;
}
export type AuditPhase = 'download' | 'proofs' | 'replay' | 'relays' | 'done';
export interface AuditProgress {
    phase: AuditPhase;
    /** Checkpoints read in this pass, and how many there are. */
    checkpoint: number;
    checkpoints: number;
    /** Proofs verified so far, and asked for so far. */
    verified: number;
    asked: number;
    report: AuditReport | null;
}
export interface AuditOptions {
    /** A mirror file's text, or null when it is missing (checkpoint.txt, checkpoints/<i>.txt, entries/<i>.json). */
    text(path: string): Promise<string | null>;
    /** The ledger's log key, pinned (from the app's configuration, never from the mirror). */
    logKey: string;
    /** Verifies a ballot proof: true, false, or throws when it could not run. */
    verifyProof(req: Extract<AuditRequest, {
        type: 'proof';
    }>): Promise<boolean>;
    /** Verifies a passport proof: the document's unique identifier, null when refused, or throws. */
    verifyPassport(req: Extract<AuditRequest, {
        type: 'passport';
    }>): Promise<string | null>;
    /** Reads the relays' copies (withholding); absent, not checked. */
    relays?: RelayTransport;
    onProgress?(p: AuditProgress): void;
    /** Stops the audit (it then throws). */
    signal?: AbortSignal;
    /**
     * Accepts a registry of the dev passport provider (a local trial, where
     * anyone may register). Absent, such a registry and its registrations
     * are problems, as for the ingest and the authority.
     */
    allowDev?: boolean;
}
/** Audits the ledger a mirror serves. */
export declare function audit(wasm: IsoloirWasm & AuditWasm, opts: AuditOptions): Promise<AuditResult>;
/** The audit functions of the wasm core. */
export interface AuditWasm {
    audit_start(log_key: string, verdicts_json: string, allow_dev: boolean): number;
    audit_checkpoint(id: number, note: string, entries_json: string): string;
    audit_finish(id: number): string;
    audit_relays(id: number, events_json: string): string;
    audit_drop(id: number): void;
}
/**
 * Verifies ballot proofs with bb.js against the mirror's verification
 * keys (circuits/<name>/vk), each checked against the hash the poll names
 * (as the CLI does with bb). `bytes` reads a mirror file's bytes.
 */
export declare function bbVerifier(bytes: (path: string) => Promise<Uint8Array | null>, target?: string): (req: Extract<AuditRequest, {
    type: 'proof';
}>) => Promise<boolean>;
/** The parts of @zkpassport/sdk and @zkpassport/utils the passport verifier uses (given by the app). */
export interface ZkPassportSdk {
    ZKPassport: new (domain: string) => {
        createQuery(): unknown;
        verify(o: Record<string, unknown>): Promise<{
            verified: boolean;
            uniqueIdentifier?: string;
            queryResultErrors?: unknown;
        }>;
    };
    NullifierType: {
        NON_SALTED: unknown;
        SALTED: unknown;
    };
}
/**
 * Verifies passport proofs with the ZKPassport SDK, locally (its open
 * verifier; the certificate registry roots read on Ethereum through
 * `rpcUrl`; a salted identifier against the registry's pinned OPRF key).
 * The query is rebuilt from the registry's rules and the
 * registration's binding, as the ingest's verifier does (zkverifier/
 * verify.mjs).
 */
export declare function zkPassportVerifier(sdk: ZkPassportSdk, rpcUrl: string): (req: Extract<AuditRequest, {
    type: 'passport';
}>) => Promise<string | null>;
