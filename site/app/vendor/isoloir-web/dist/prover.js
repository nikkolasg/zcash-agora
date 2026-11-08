// The prover (SPEC §9.1): noir_js executes the circuit on the inputs the
// wasm core drafted, bb.js proves it (UltraHonk, the noir-recursive
// target the ingest verifies with bb). In a Web Worker, so the page stays
// responsive for the tens of seconds a phone takes. The session only
// needs the Prover interface: the proof bytes are opaque to it.
//
// By default bb.js fetches the SRS from Aztec's CDN and its wasm from the
// app's own bundle. ProverOptions pins both to URLs the app chooses
// (a CDN copy), each file accepted only with its SHA-256.
import { IsoloirError } from './errors.js';
// bb.js takes the SRS in blocks of 2^17 points; the ballot circuits fit
// (the largest, rankedm16_single_linked_d20, is 46,800 gates, 2^16 once
// rounded up).
const SRS_POINTS = 1 << 17;
const backends = new Map();
/** How many threads bb.js may use: the cores up to 8 when cross-origin isolated, else one. */
export function proverThreads() {
    const g = globalThis;
    if (!g.crossOriginIsolated)
        return 1;
    return Math.min(g.navigator?.hardwareConcurrency || 1, 8);
}
function hex(b) {
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
/**
 * Fetches a pinned file whole and checks its SHA-256 (WebCrypto): another
 * file is refused with `pin_mismatch`, an unreachable one with `prover`.
 */
export async function fetchPinned(file, fetcher = globalThis.fetch.bind(globalThis)) {
    const expected = file.sha256.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected))
        throw new IsoloirError('prover', `${file.url}: the pinned SHA-256 is not 64 hex digits`);
    let res;
    try {
        res = await fetcher(file.url, { credentials: 'omit' });
    }
    catch (e) {
        throw new IsoloirError('prover', `${file.url}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok)
        throw new IsoloirError('prover', `${file.url}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const actual = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    if (actual !== expected)
        throw new IsoloirError('pin_mismatch', `${file.url} is not the file pinned`, { url: file.url, expected, actual });
    return bytes;
}
// One fetch per pinned file, whatever the circuits.
const pinned = new Map();
function loadPinned(file) {
    const key = `${file.sha256.toLowerCase()} ${file.url}`;
    let p = pinned.get(key);
    if (!p) {
        p = fetchPinned(file);
        p.catch(() => pinned.delete(key));
        pinned.set(key, p);
    }
    return p;
}
/** bb.js takes compressed G1 points in blocks of 2^17 (32 B each). */
export const SRS_BLOCK_BYTES = SRS_POINTS * 32;
/** Checks the SRS files' sizes against bb.js's formats and gives the points each holds. */
export function srsPoints(g1, g2, grumpkin) {
    if (g1.length === 0 || g1.length % SRS_BLOCK_BYTES !== 0)
        throw new IsoloirError('prover', `the G1 SRS file has ${g1.length} bytes, not whole blocks of 2^17 compressed points (${SRS_BLOCK_BYTES} B)`);
    if (g2.length !== 128)
        throw new IsoloirError('prover', `the G2 SRS file has ${g2.length} bytes, not 128`);
    if (grumpkin && (grumpkin.length === 0 || grumpkin.length % 64 !== 0))
        throw new IsoloirError('prover', `the Grumpkin SRS file has ${grumpkin.length} bytes, not whole points (64 B)`);
    return { g1: g1.length / 32, grumpkin: grumpkin ? grumpkin.length / 64 : 0 };
}
/** Loads the pinned SRS into bb.js, as bb.js 5.0.0's initSRSChonk does with its CDN's. */
async function initSrs(api, srs) {
    const [g1, g2, grumpkin] = await Promise.all([loadPinned(srs.g1), loadPinned(srs.g2), srs.grumpkin ? loadPinned(srs.grumpkin) : undefined]);
    const n = srsPoints(g1, g2, grumpkin);
    await api.srsInitSrs({ pointsBuf: g1, numPoints: n.g1, g2Point: g2 });
    if (grumpkin)
        await api.srsInitGrumpkinSrs({ pointsBuf: grumpkin, numPoints: n.grumpkin });
}
// bb.js 5.0.0 takes no wasm bytes and no integrity, only a `wasmPath` it
// fetches itself (inserting "-threads" before the extension for the
// shared-memory build). The prover gives it a path on a reserved host
// that only this hook answers, with the bytes it fetched and checked; any
// other request goes through. Unhooked, the reserved host fails to
// resolve: a wasm is never used unchecked.
// The path names the pinned hash: two provers pinning different files never share one.
const WASM_HOST = 'https://bb-wasm.isoloir.invalid';
const wasmServed = new Map();
let wasmHooked = false;
function serveWasm(path, file) {
    wasmServed.set(path, file);
    if (wasmHooked)
        return;
    wasmHooked = true;
    const real = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const f = url.startsWith(WASM_HOST + '/') ? wasmServed.get(url) : undefined;
        if (!f)
            return real(input, init);
        return new Response((await loadPinned(f)), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    };
}
function isNode() {
    const g = globalThis;
    return !!g.process?.versions?.node && g.window === undefined;
}
/** The wasmPath to give bb.js for the pinned wasm the page will use, if any. */
function wasmPath(wasm) {
    if (!wasm || isNode())
        return undefined;
    // bb.js picks the shared-memory build exactly when this holds.
    const shared = typeof SharedArrayBuffer !== 'undefined' && !!globalThis.crossOriginIsolated;
    const file = shared ? wasm.threads : wasm.single;
    if (!file)
        return undefined;
    const dir = `${WASM_HOST}/${file.sha256.toLowerCase()}`;
    serveWasm(`${dir}/barretenberg${shared ? '-threads' : ''}.wasm.gz`, file);
    return `${dir}/barretenberg.wasm.gz`;
}
/** Loads noir_js and bb.js for a circuit once; the first call fetches the SRS and sets up the key. */
export function backendFor(circuit, artifact, options = {}) {
    const key = `${circuit} ${JSON.stringify(options)}`;
    let b = backends.get(key);
    if (b)
        return b;
    b = (async () => {
        const compiled = JSON.parse(await artifact(circuit));
        const [{ Noir }, { Barretenberg, UltraHonkBackend }] = await Promise.all([import('@noir-lang/noir_js'), import('@aztec/bb.js')]);
        const noir = new Noir(compiled);
        const api = await Barretenberg.new({ threads: proverThreads(), srsSize: SRS_POINTS, skipSrsInit: !!options.srs, wasmPath: wasmPath(options.wasm) });
        if (options.srs)
            await initSrs(api, options.srs);
        const backend = new UltraHonkBackend(compiled.bytecode, api);
        await backend.getVerificationKey({ verifierTarget: 'noir-recursive' });
        return { noir: noir, backend: backend };
    })();
    b.catch(() => backends.delete(key));
    backends.set(key, b);
    return b;
}
/** Proves in the current thread (what the worker runs; usable directly in tests or tools). */
export async function proveHere(circuit, inputs, artifact, options = {}) {
    const { noir, backend } = await backendFor(circuit, artifact, options);
    const { witness } = await noir.execute(inputs);
    const p = await backend.generateProof(witness, { verifierTarget: 'noir-recursive' });
    return { proof: p.proof, publicInputs: p.publicInputs };
}
/** In-thread prover. */
export class LocalProver {
    artifact;
    options;
    constructor(artifact, options = {}) {
        this.artifact = artifact;
        this.options = options;
    }
    async warm(circuit) {
        await backendFor(circuit, this.artifact, this.options);
    }
    prove(circuit, inputs) {
        return proveHere(circuit, inputs, this.artifact, this.options);
    }
}
/** The failure of a worker response, as the worker raised it. */
export function workerError(r) {
    if (r.code)
        return new IsoloirError(r.code, r.error, r.data);
    return new Error(r.error);
}
/** A thrown value as a worker's failure response. */
export function workerFailure(id, e) {
    if (e instanceof IsoloirError)
        return { id, ok: false, error: e.detail, code: e.code, data: e.data };
    return { id, ok: false, error: e instanceof Error ? e.message : String(e) };
}
/**
 * Proves in a Web Worker (prove.worker.js of this package). The artifact
 * is fetched on the page (from the mirror) and handed to the worker.
 *
 *   new WorkerProver(() => new Worker(new URL('@isoloir/web/prove.worker', import.meta.url), { type: 'module' }), loader, options)
 */
export class WorkerProver {
    spawn;
    artifact;
    options;
    worker = null;
    next = 1;
    waiting = new Map();
    artifacts = new Map();
    constructor(spawn, artifact, options = {}) {
        this.spawn = spawn;
        this.artifact = artifact;
        this.options = options;
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
        const r = await this.call({ op: 'warm', circuit, artifact: await this.load(circuit), options: this.options });
        if (!r.ok)
            throw workerError(r);
    }
    async prove(circuit, inputs) {
        const r = await this.call({ op: 'prove', circuit, artifact: await this.load(circuit), inputs, options: this.options });
        if (!r.ok)
            throw workerError(r);
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