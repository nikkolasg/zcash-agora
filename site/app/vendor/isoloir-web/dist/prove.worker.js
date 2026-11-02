// The prover's Web Worker: executes and proves off the page's thread.
// Messages: WorkerRequest in, WorkerResponse out (prover.ts).
import { backendFor, proveHere } from './prover.js';
const scope = globalThis;
scope.onmessage = (ev) => {
    const req = ev.data;
    const artifact = () => Promise.resolve(req.artifact);
    const run = async () => {
        if (req.op === 'warm') {
            await backendFor(req.circuit, artifact);
            return { id: req.id, ok: true };
        }
        const r = await proveHere(req.circuit, req.inputs, artifact);
        return { id: req.id, ok: true, proof: r.proof, publicInputs: r.publicInputs };
    };
    run().then((r) => scope.postMessage(r), (e) => scope.postMessage({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) }));
};
//# sourceMappingURL=prove.worker.js.map