// The prover's Web Worker: executes and proves off the page's thread.
// Messages: WorkerRequest in, WorkerResponse out (prover.ts).
import { backendFor, proveHere, workerFailure } from './prover.js';
const scope = globalThis;
scope.onmessage = (ev) => {
    const req = ev.data;
    const artifact = () => Promise.resolve(req.artifact);
    const run = async () => {
        if (req.op === 'warm') {
            await backendFor(req.circuit, artifact, req.options);
            return { id: req.id, ok: true };
        }
        const r = await proveHere(req.circuit, req.inputs, artifact, req.options);
        return { id: req.id, ok: true, proof: r.proof, publicInputs: r.publicInputs };
    };
    run().then((r) => scope.postMessage(r), (e) => scope.postMessage(workerFailure(req.id, e)));
};
//# sourceMappingURL=prove.worker.js.map