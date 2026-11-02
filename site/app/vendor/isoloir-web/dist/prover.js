// The prover (SPEC §9.1): noir_js executes the circuit on the inputs the
// wasm core drafted, bb.js proves it (UltraHonk, the noir-recursive
// target the ingest verifies with bb). In a Web Worker, so the page stays
// responsive for the tens of seconds a phone takes. The session only
// needs the Prover interface: the proof bytes are opaque to it.
// bb.js takes the SRS in blocks of 2^17 points; the ballot circuits fit.
const SRS_POINTS = 1 << 17;
const backends = new Map();
/** How many threads bb.js may use: the cores up to 8 when cross-origin isolated, else one. */
export function proverThreads() {
    const g = globalThis;
    if (!g.crossOriginIsolated)
        return 1;
    return Math.min(g.navigator?.hardwareConcurrency || 1, 8);
}
/** Loads noir_js and bb.js for a circuit once; the first call fetches the SRS and sets up the key. */
export function backendFor(circuit, artifact) {
    let b = backends.get(circuit);
    if (b)
        return b;
    b = (async () => {
        const compiled = JSON.parse(await artifact(circuit));
        const [{ Noir }, { Barretenberg, UltraHonkBackend }] = await Promise.all([import('@noir-lang/noir_js'), import('@aztec/bb.js')]);
        const noir = new Noir(compiled);
        const api = await Barretenberg.new({ threads: proverThreads(), srsSize: SRS_POINTS });
        const backend = new UltraHonkBackend(compiled.bytecode, api);
        await backend.getVerificationKey({ verifierTarget: 'noir-recursive' });
        return { noir: noir, backend: backend };
    })();
    b.catch(() => backends.delete(circuit));
    backends.set(circuit, b);
    return b;
}
/** Proves in the current thread (what the worker runs; usable directly in tests or tools). */
export async function proveHere(circuit, inputs, artifact) {
    const { noir, backend } = await backendFor(circuit, artifact);
    const { witness } = await noir.execute(inputs);
    const p = await backend.generateProof(witness, { verifierTarget: 'noir-recursive' });
    return { proof: p.proof, publicInputs: p.publicInputs };
}
/** In-thread prover. */
export class LocalProver {
    artifact;
    constructor(artifact) {
        this.artifact = artifact;
    }
    async warm(circuit) {
        await backendFor(circuit, this.artifact);
    }
    prove(circuit, inputs) {
        return proveHere(circuit, inputs, this.artifact);
    }
}
/**
 * Proves in a Web Worker (prove.worker.js of this package). The artifact
 * is fetched on the page (from the mirror) and handed to the worker.
 *
 *   new WorkerProver(() => new Worker(new URL('@isoloir/web/prove.worker', import.meta.url), { type: 'module' }), loader)
 */
export class WorkerProver {
    spawn;
    artifact;
    worker = null;
    next = 1;
    waiting = new Map();
    artifacts = new Map();
    constructor(spawn, artifact) {
        this.spawn = spawn;
        this.artifact = artifact;
    }
    get w() {
        if (this.worker)
            return this.worker;
        const w = this.spawn();
        w.onmessage = (ev) => {
            const p = this.waiting.get(ev.data.id);
            if (!p)
                return;
            this.waiting.delete(ev.data.id);
            p.resolve(ev.data);
        };
        w.onerror = (ev) => {
            const msg = ev && typeof ev === 'object' && 'message' in ev ? String(ev.message) : 'worker failed';
            for (const p of this.waiting.values())
                p.reject(new Error(msg));
            this.waiting.clear();
            this.worker = null;
            w.terminate();
        };
        this.worker = w;
        return w;
    }
    load(circuit) {
        let a = this.artifacts.get(circuit);
        if (!a) {
            a = this.artifact(circuit);
            a.catch(() => this.artifacts.delete(circuit));
            this.artifacts.set(circuit, a);
        }
        return a;
    }
    call(req) {
        const id = this.next++;
        return new Promise((resolve, reject) => {
            this.waiting.set(id, { resolve, reject });
            this.w.postMessage({ ...req, id });
        });
    }
    async warm(circuit) {
        const r = await this.call({ op: 'warm', circuit, artifact: await this.load(circuit) });
        if (!r.ok)
            throw new Error(r.error);
    }
    async prove(circuit, inputs) {
        const r = await this.call({ op: 'prove', circuit, artifact: await this.load(circuit), inputs });
        if (!r.ok)
            throw new Error(r.error);
        if (!r.proof)
            throw new Error('the worker returned no proof');
        return { proof: r.proof, publicInputs: r.publicInputs };
    }
    terminate() {
        this.worker?.terminate();
        this.worker = null;
    }
}
//# sourceMappingURL=prover.js.map