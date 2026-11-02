/* tslint:disable */
/* eslint-disable */

export function aggregate(cts_json: string): string;

/**
 * Feeds one checkpoint (its signed note, its entries file).
 */
export function audit_checkpoint(id: number, note: string, entries_json: string): string;

/**
 * Forgets a pass.
 */
export function audit_drop(id: number): void;

/**
 * Ends the pass: the report.
 */
export function audit_finish(id: number): string;

/**
 * The relays' events against the finished pass: the problems.
 */
export function audit_relays(id: number, events_json: string): string;

/**
 * Starts an audit pass; `log_key` "" for the key the log names;
 * `allow_dev` accepts the dev passport provider (local trials). Returns its id.
 */
export function audit_start(log_key: string, verdicts_json: string, allow_dev: boolean): number;

export function body_hash(body: string): string;

export function canonical(json: string): string;

/**
 * One word in the list's spelling, or an empty string when it is not on the list.
 */
export function canonical_word(word: string, lang: string): string;

export function check_words(words: string, lang: string): string;

export function choice_values(poll_json: string, choice_json: string): string;

export function complaint_body(ack_event_json: string, body: string): string;

export function decode_ack(content: string): string;

export function decode_body(kind: string, text: string): string;

export function delta_leaf(ident: string, cmt: string): string;

export function delta_recover(poll_json: string, s: string, leaves_json: string): string;

export function draft_ballot(req_json: string): string;

export function finish_ballot(draft_body_json: string, proof: Uint8Array | number[]): string;

export function ident(poll: number, s: string, i: number): string;

export function kind_info(poll_json: string): string;

/**
 * The Nostr kinds: `{register, ballot, ack, checkpoint, link, tally, complaint}`.
 */
export function kinds(): string;

export function leaf(registry: number, s: string): string;

export function link_open(receiver_secret: string, sealed: string): string;

export function link_receiver(): string;

export function link_seal(receiver_public: string, payload: string): string;

export function new_reg_secret(): string;

export function new_words(lang: string): string;

export function normalize_words(words: string, lang: string): string;

export function nullifier(poll: number, s: string): string;

export function protocol(): string;

export function public_inputs(body: string, poll_json: string): string;

export function read_ack(event_json: string, ingest_pubkey: string): string;

export function reg_pubkey(sk_hex: string): string;

export function register_body(req_json: string): string;

export function registration_binding(registry: number, pubkey_hex: string): string;

export function relay_ranking(s: string, urls_json: string): string;

export function root_of(leaf: string, position: number, path_json: string): string;

export function secret_from_prf(prf_hex: string): string;

export function secret_from_words(words: string, lang: string): string;

export function sign_event(sk_hex: string, created_at: number, kind: number, tags_json: string, content: string): string;

export function tally_results(poll_json: string, values_json: string, counted: number): string;

export function tree_path(depth: number, leaves_json: string, position: number): string;

export function tree_root(depth: number, leaves_json: string): string;

export function verify_event(event_json: string): boolean;

export function verify_logged(seq: number, kind: string, body: string, path_json: string, size: number, root_b64: string): boolean;

export function verify_note(note: string, verifier_key: string): string;

export function verify_register(body: string): string;

export function verify_tally(poll_json: string, tally: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly aggregate: (a: number, b: number) => [number, number, number, number];
    readonly audit_checkpoint: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly audit_drop: (a: number) => void;
    readonly audit_finish: (a: number) => [number, number, number, number];
    readonly audit_relays: (a: number, b: number, c: number) => [number, number, number, number];
    readonly audit_start: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly body_hash: (a: number, b: number) => [number, number];
    readonly canonical: (a: number, b: number) => [number, number, number, number];
    readonly canonical_word: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly check_words: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly choice_values: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly complaint_body: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly decode_ack: (a: number, b: number) => [number, number, number, number];
    readonly decode_body: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly delta_leaf: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly delta_recover: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly draft_ballot: (a: number, b: number) => [number, number, number, number];
    readonly finish_ballot: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly ident: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly kind_info: (a: number, b: number) => [number, number, number, number];
    readonly kinds: () => [number, number];
    readonly leaf: (a: number, b: number, c: number) => [number, number, number, number];
    readonly link_open: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly link_receiver: () => [number, number];
    readonly link_seal: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly new_reg_secret: () => [number, number];
    readonly new_words: (a: number, b: number) => [number, number, number, number];
    readonly normalize_words: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly nullifier: (a: number, b: number, c: number) => [number, number, number, number];
    readonly protocol: () => [number, number];
    readonly public_inputs: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly read_ack: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly reg_pubkey: (a: number, b: number) => [number, number, number, number];
    readonly register_body: (a: number, b: number) => [number, number, number, number];
    readonly registration_binding: (a: number, b: number, c: number) => [number, number, number, number];
    readonly relay_ranking: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly root_of: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly secret_from_prf: (a: number, b: number) => [number, number, number, number];
    readonly secret_from_words: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly sign_event: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly tally_results: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly tree_path: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly tree_root: (a: number, b: number, c: number) => [number, number, number, number];
    readonly verify_event: (a: number, b: number) => number;
    readonly verify_logged: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
    readonly verify_note: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly verify_register: (a: number, b: number) => [number, number, number, number];
    readonly verify_tally: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
