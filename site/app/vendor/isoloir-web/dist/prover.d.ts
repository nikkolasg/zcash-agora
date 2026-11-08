export interface ProofResult {
    proof: Uint8Array;
    /** The public inputs bb.js reports, checked against the body's. */
    publicInputs?: string[];
}
export interface Prover {
    /** Loads the circuit and the proving key ahead of the vote (optional). */
    warm?(circuit: string): Promise<void>;
    prove(circuit: string, inputs: Record<string, unknown>): Promise<ProofResult>;
}
/** Gives the compiled circuit's JSON (circuits/<name>/artifact.json on the mirror). */
export type ArtifactLoader = (circuit: string) => Promise<string>;
export interface CompiledCircuit {
    bytecode: string;
    abi: unknown;
}
/** A file fetched whole (no Range) and used only if its SHA-256 is this one. */
export interface PinnedFile {
    url: string;
    /** SHA-256 of the file's bytes, 64 hex digits. */
    sha256: string;
}
/**
 * The SRS as files, in bb.js 5.0.0's formats (Aztec's ceremony, the
 * heads of crs.aztec-cdn.foundation's files):
 *   g1        BN254 G1 points, compressed (32 B a point), in whole blocks
 *             of 2^17 points (bb.js refuses anything else): the first
 *             4,194,304 B of g1_compressed.dat hold 2^17 points, enough
 *             for every ballot circuit
 *   g2        the BN254 G2 point, g2.dat (128 B)
 *   grumpkin  Grumpkin G1 points (64 B a point), the head of
 *             grumpkin_g1_v2.dat (bb.js's own loader takes 2^16 points,
 *             4,194,304 B). UltraHonk ballots do not use them: without
 *             the file, none is loaded
 */
export interface SrsFiles {
    g1: PinnedFile;
    g2: PinnedFile;
    grumpkin?: PinnedFile;
}
/**
 * bb.js's wasm, as bb.js reads it (gzipped or not). `threads` is the build
 * with shared memory, used when the page is cross-origin isolated (the
 * npm package ships it as dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz);
 * `single` the build without, used otherwise. Without the variant the
 * page needs, bb.js loads its own from the app's bundle. Browsers only:
 * in Node bb.js reads its wasm from its package.
 */
export interface BbWasmFiles {
    threads: PinnedFile;
    single?: PinnedFile;
}
/** Where the prover takes what bb.js would otherwise fetch itself. Plain data: it crosses to the worker. */
export interface ProverOptions {
    srs?: SrsFiles;
    wasm?: BbWasmFiles;
}
interface Backend {
    noir: {
        execute(inputs: unknown): Promise<{
            witness: Uint8Array;
        }>;
    };
    backend: {
        getVerificationKey(o: {
            verifierTarget: 'noir-recursive';
        }): Promise<Uint8Array>;
        generateProof(w: Uint8Array, o: {
            verifierTarget: 'noir-recursive';
        }): Promise<{
            proof: Uint8Array;
            publicInputs: string[];
        }>;
    };
}
/** How many threads bb.js may use: the cores up to 8 when cross-origin isolated, else one. */
export declare function proverThreads(): number;
/**
 * Fetches a pinned file whole and checks its SHA-256 (WebCrypto): another
 * file is refused with `pin_mismatch`, an unreachable one with `prover`.
 */
export declare function fetchPinned(file: PinnedFile, fetcher?: typeof fetch): Promise<Uint8Array>;
/** bb.js takes compressed G1 points in blocks of 2^17 (32 B each). */
export declare const SRS_BLOCK_BYTES: number;
/** Checks the SRS files' sizes against bb.js's formats and gives the points each holds. */
export declare function srsPoints(g1: Uint8Array, g2: Uint8Array, grumpkin?: Uint8Array): {
    g1: number;
    grumpkin: number;
};
/** Loads noir_js and bb.js for a circuit once; the first call fetches the SRS and sets up the key. */
export declare function backendFor(circuit: string, artifact: ArtifactLoader, options?: ProverOptions): Promise<Backend>;
/** Proves in the current thread (what the worker runs; usable directly in tests or tools). */
export declare function proveHere(circuit: string, inputs: Record<string, unknown>, artifact: ArtifactLoader, options?: ProverOptions): Promise<ProofResult>;
/** In-thread prover. */
export declare class LocalProver implements Prover {
    private readonly artifact;
    private readonly options;
    constructor(artifact: ArtifactLoader, options?: ProverOptions);
    warm(circuit: string): Promise<void>;
    prove(circuit: string, inputs: Record<string, unknown>): Promise<ProofResult>;
}
/** The messages between the page and the worker. */
export type WorkerRequest = {
    id: number;
    op: 'warm';
    circuit: string;
    artifact: string;
    options?: ProverOptions;
} | {
    id: number;
    op: 'prove';
    circuit: string;
    artifact: string;
    inputs: Record<string, unknown>;
    options?: ProverOptions;
};
/** A failure carries its IsoloirError code (and data) when it has one. */
export type WorkerResponse = {
    id: number;
    ok: true;
    proof?: Uint8Array;
    publicInputs?: string[];
} | {
    id: number;
    ok: false;
    error: string;
    code?: string;
    data?: Record<string, unknown>;
};
/** The failure of a worker response, as the worker raised it. */
export declare function workerError(r: Extract<WorkerResponse, {
    ok: false;
}>): Error;
/** A thrown value as a worker's failure response. */
export declare function workerFailure(id: number, e: unknown): Extract<WorkerResponse, {
    ok: false;
}>;
/** The subset of Worker the prover uses. */
export interface WorkerLike {
    postMessage(m: WorkerRequest): void;
    onmessage: ((ev: {
        data: WorkerResponse;
    }) => void) | null;
    onerror: ((ev: unknown) => void) | null;
    terminate(): void;
}
/**
 * Proves in a Web Worker (prove.worker.js of this package). The artifact
 * is fetched on the page (from the mirror) and handed to the worker.
 *
 *   new WorkerProver(() => new Worker(new URL('@isoloir/web/prove.worker', import.meta.url), { type: 'module' }), loader, options)
 */
export declare class WorkerProver implements Prover {
    private readonly spawn;
    private readonly artifact;
    private readonly options;
    private worker;
    private next;
    private readonly waiting;
    private readonly artifacts;
    constructor(spawn: () => WorkerLike, artifact: ArtifactLoader, options?: ProverOptions);
    private get w();
    private load;
    private call;
    warm(circuit: string): Promise<void>;
    prove(circuit: string, inputs: Record<string, unknown>): Promise<ProofResult>;
    terminate(): void;
}
export {};
