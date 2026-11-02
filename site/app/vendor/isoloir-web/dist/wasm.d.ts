import type { Ack, Checkpoint, Choice, Draft, KindInfo, NostrEvent, PollSetup, TallyVerdict, Results } from './types.js';
export interface IsoloirWasm {
    protocol(): string;
    kinds(): string;
    canonical(json: string): string;
    body_hash(body: string): string;
    decode_body(kind: string, text: string): string;
    leaf(registry: number, s: string): string;
    nullifier(poll: number, s: string): string;
    ident(poll: number, s: string, i: number): string;
    delta_leaf(ident: string, cmt: string): string;
    secret_from_prf(prf_hex: string): string;
    new_words(lang: string): string;
    normalize_words(words: string, lang: string): string;
    secret_from_words(words: string, lang: string): string;
    check_words(words: string, lang: string): string;
    canonical_word(word: string, lang: string): string;
    verify_logged(seq: number, kind: string, body: string, path_json: string, size: number, root_b64: string): boolean;
    relay_ranking(s: string, urls_json: string): string;
    new_reg_secret(): string;
    reg_pubkey(sk_hex: string): string;
    registration_binding(registry: number, pubkey_hex: string): string;
    register_body(req_json: string): string;
    verify_register(body: string): string;
    kind_info(poll_json: string): string;
    choice_values(poll_json: string, choice_json: string): string;
    draft_ballot(req_json: string): string;
    finish_ballot(draft_body_json: string, proof: Uint8Array): string;
    public_inputs(body: string, poll_json: string): string;
    delta_recover(poll_json: string, s: string, leaves_json: string): string;
    tree_root(depth: number, leaves_json: string): string;
    tree_path(depth: number, leaves_json: string, position: number): string;
    root_of(leaf: string, position: number, path_json: string): string;
    verify_note(note: string, verifier_key: string): string;
    sign_event(sk_hex: string, created_at: number, kind: number, tags_json: string, content: string): string;
    verify_event(event_json: string): boolean;
    decode_ack(content: string): string;
    read_ack(event_json: string, ingest_pubkey: string): string;
    complaint_body(ack_event_json: string, body: string): string;
    verify_tally(poll_json: string, tally: string): string;
    tally_results(poll_json: string, values_json: string, counted: number): string;
    aggregate(cts_json: string): string;
    link_receiver(): string;
    link_seal(receiver_public: string, payload: string): string;
    link_open(receiver_secret: string, sealed: string): string;
    audit_start(log_key: string, verdicts_json: string, allow_dev: boolean): number;
    audit_checkpoint(id: number, note: string, entries_json: string): string;
    audit_finish(id: number): string;
    audit_relays(id: number, events_json: string): string;
    audit_drop(id: number): void;
}
/** The Nostr kinds of SPEC §11.1. */
export interface Kinds {
    register: number;
    ballot: number;
    ack: number;
    checkpoint: number;
    link: number;
    tally: number;
    complaint: number;
}
export interface TreePath {
    root: string;
    leaf: string;
    index: number;
    path: string[];
}
export interface DeltaChain {
    /** The number of the next ballot of the chain. */
    next: number;
    /** The last ballot found: its number, choice and position in the ballot tree. */
    previous: {
        i: number;
        choice: Choice;
        index: number;
    } | null;
}
export interface WordsCheck {
    ok: boolean;
    count: number;
    /** 1-based positions of the words not on the list. */
    unknown: number[];
    checksum: boolean;
    /** The phrase in the list's spelling, when every word is on it. */
    words: string | null;
}
/** The message of whatever wasm threw. */
export declare function messageOf(e: unknown): string;
/**
 * Loads the browser build (wasm-pack --target web) shipped in this
 * package. By default the .wasm file is fetched next to the module
 * (bundlers that handle `new URL(..., import.meta.url)` serve it); an app
 * that serves it elsewhere passes its URL, a Response or its bytes.
 */
export declare function loadWasm(input?: URL | string | Response | BufferSource): Promise<IsoloirWasm>;
/** The wasm core with typed results. */
export declare class Core {
    readonly w: IsoloirWasm;
    readonly kinds: Kinds;
    constructor(w: IsoloirWasm);
    canonical(v: unknown): string;
    bodyHash(body: string): string;
    decodeBody<T>(kind: string, text: string): T;
    leaf(registry: number, s: string): string;
    nullifier(poll: number, s: string): string;
    deltaLeaf(ident: string, cmt: string): string;
    secretFromPrf(prf: Uint8Array): string;
    newWords(lang: string): string;
    normalizeWords(words: string, lang: string): string;
    secretFromWords(words: string, lang: string): string;
    /** What is wrong with a phrase (1-based positions of the words not on the list). */
    checkWords(words: string, lang: string): WordsCheck;
    /** A word in the list's spelling (case and accents folded), or null. */
    canonicalWord(word: string, lang: string): string | null;
    verifyLogged(seq: number, kind: string, body: string, path: string[], size: number, root: string): boolean;
    relayRanking(s: string, urls: string[]): string[];
    newRegSecret(): string;
    regPubkey(sk: string): string;
    registrationBinding(registry: number, pubkey: string): string;
    registerBody(req: {
        registry: number;
        s: string;
        uid: string;
        proof: unknown;
        proof_date: number;
        reg_secret: string;
    }): string;
    kindInfo(poll: PollSetup): KindInfo;
    choiceValues(poll: PollSetup, choice: Choice): number[];
    draftBallot(req: unknown): Draft;
    finishBallot(body: Record<string, unknown>, proof: Uint8Array): string;
    publicInputs(body: string, poll: PollSetup): string[];
    deltaRecover(poll: PollSetup, s: string, leaves: string[]): DeltaChain;
    treeRoot(depth: number, leaves: string[]): string;
    treePath(depth: number, leaves: string[], position: number): TreePath;
    verifyNote(note: string, verifierKey: string): Checkpoint;
    signEvent(sk: string, createdAt: number, kind: number, tags: string[][], content: string): NostrEvent;
    verifyEvent(e: NostrEvent): boolean;
    readAck(e: NostrEvent, ingest: string): Ack;
    complaintBody(ack: NostrEvent, body: string): string;
    verifyTally(poll: PollSetup, tally: string): TallyVerdict;
    tallyResults(poll: PollSetup, values: number[], counted: number): Results;
    linkReceiver(): {
        secret: string;
        public: string;
    };
    linkSeal(receiverPublic: string, payload: string): {
        sealed: string;
        code: string;
    };
    linkOpen(receiverSecret: string, sealed: string): {
        payload: string;
        code: string;
    };
}
export declare function toHex(b: Uint8Array): string;
