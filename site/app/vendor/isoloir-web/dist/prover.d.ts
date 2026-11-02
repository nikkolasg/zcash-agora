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
/** Loads noir_js and bb.js for a circuit once; the first call fetches the SRS and sets up the key. */
export declare function backendFor(circuit: string, artifact: ArtifactLoader): Promise<Backend>;
/** Proves in the current thread (what the worker runs; usable directly in tests or tools). */
export declare function proveHere(circuit: string, inputs: Record<string, unknown>, artifact: ArtifactLoader): Promise<ProofResult>;
/** In-thread prover. */
export declare class LocalProver implements Prover {
    private readonly artifact;
    constructor(artifact: ArtifactLoader);
    warm(circuit: string): Promise<void>;
    prove(circuit: string, inputs: Record<string, unknown>): Promise<ProofResult>;
}
/** The messages between the page and the worker. */
export type WorkerRequest = {
    id: number;
    op: 'warm';
    circuit: string;
    artifact: string;
} | {
    id: number;
    op: 'prove';
    circuit: string;
    artifact: string;
    inputs: Record<string, unknown>;
};
export type WorkerResponse = {
    id: number;
    ok: true;
    proof?: Uint8Array;
    publicInputs?: string[];
} | {
    id: number;
    ok: false;
    error: string;
};
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
 *   new WorkerProver(() => new Worker(new URL('@isoloir/web/prove.worker', import.meta.url), { type: 'module' }), loader)
 */
export declare class WorkerProver implements Prover {
    private readonly spawn;
    private readonly artifact;
    private worker;
    private next;
    private readonly waiting;
    private readonly artifacts;
    constructor(spawn: () => WorkerLike, artifact: ArtifactLoader);
    private get w();
    private load;
    private call;
    warm(circuit: string): Promise<void>;
    prove(circuit: string, inputs: Record<string, unknown>): Promise<ProofResult>;
    terminate(): void;
}
export {};
