// The audit in the browser (SPEC §16): anyone recounts the ledger from
// its mirror with the same Rust judge the CLI runs (crates/wasm/src/
// audit.rs). The log is read twice: the first pass collects the proofs
// the judge asks for, the page verifies them (ballots with bb.js against
// the mirror's verification keys, passports with the ZKPassport SDK), and
// the second pass replays the log with the verdicts. A check that could
// not run is a problem, never a pass.
//
// Mirrors of every version read alike: the entries of earlier logs hold
// `reject` and `rejects` entries (counted, not judged, by the judge), and
// an entry's body may be a string or its JSON. Channels keep no copies
// (SPEC §11.1): there is no comparison with the relays. The newest note
// may be ahead of the files the mirror holds (SPEC §15): the checkpoints
// after the last one whose files are there are reported as not read yet,
// never as missing.
/** Audits the ledger a mirror serves. */
export async function audit(wasm, opts) {
    const latest = await opts.text('checkpoint.txt');
    if (latest === null)
        throw new Error('the mirror has no checkpoint');
    const newest = Number(/^index (\d+)$/m.exec(latest)?.[1] ?? NaN);
    if (!Number.isFinite(newest))
        throw new Error('checkpoint.txt: no index');
    // `mirror <commit>:<index>`: the files of the checkpoints after <index> may not be there yet.
    const mi = /^mirror [^\s:]+[: ](\d+)$/m.exec(latest);
    const coveredTo = mi ? Math.min(Number(mi[1]), newest) : newest;
    let last = newest;
    const verdicts = {};
    const progress = { phase: 'download', checkpoint: 0, checkpoints: last, verified: 0, asked: 0, report: null };
    const tell = () => opts.onProgress?.({ ...progress });
    const proofs = { checked: 0, failed: 0 };
    const passports = { checked: 0, failed: 0 };
    // The proofs are verified while the first pass reads on.
    const queue = [];
    let draining = null;
    const drain = async () => {
        while (queue.length) {
            opts.signal?.throwIfAborted();
            const r = queue.shift();
            try {
                if (r.type === 'proof') {
                    const ok = await opts.verifyProof(r);
                    verdicts[r.key] = { type: 'proof', ok };
                    proofs.checked++;
                    if (!ok)
                        proofs.failed++;
                }
                else {
                    const uid = await opts.verifyPassport(r);
                    verdicts[r.key] = { type: 'passport', uid };
                    passports.checked++;
                    if (uid === null)
                        passports.failed++;
                }
            }
            catch (e) {
                verdicts[r.key] = { type: r.type, error: e instanceof Error ? e.message : String(e) };
            }
            progress.verified++;
            tell();
        }
    };
    const ask = (rs) => {
        for (const r of rs) {
            if (r.key in verdicts || queue.some((q) => q.key === r.key))
                continue;
            queue.push(r);
            progress.asked++;
        }
        if (!draining)
            draining = drain().finally(() => (draining = null));
    };
    const pass = async (onCheckpoint) => {
        const id = wasm.audit_start(opts.logKey, JSON.stringify(verdicts), opts.allowDev === true);
        try {
            for (let i = 1; i <= last; i++) {
                opts.signal?.throwIfAborted();
                const [note, entries] = await Promise.all([opts.text(`checkpoints/${i}.txt`), opts.text(`entries/${i}.json`)]);
                if (note === null || entries === null) {
                    // Past the checkpoint the note's commit covers, the files may not be pushed yet.
                    if (i > coveredTo) {
                        last = i - 1;
                        progress.checkpoints = last;
                        break;
                    }
                    throw new Error(note === null ? `checkpoint ${i} is missing on the mirror` : `the entries of checkpoint ${i} are missing on the mirror`);
                }
                const out = JSON.parse(wasm.audit_checkpoint(id, note, normalizeEntries(entries)));
                progress.checkpoint = i;
                progress.report = out.report;
                onCheckpoint(out);
                tell();
            }
            return id;
        }
        catch (e) {
            wasm.audit_drop(id);
            throw e;
        }
    };
    // 1. Read the log, collect the proofs and verify them as they come.
    const first = await pass((out) => ask(out.requests));
    wasm.audit_drop(first);
    progress.phase = 'proofs';
    tell();
    while (draining)
        await draining;
    // 2. Replay with the verdicts.
    progress.phase = 'replay';
    progress.checkpoint = 0;
    tell();
    const second = await pass((out) => {
        // A proof first asked now (it should not happen): verified later, reported meanwhile.
        if (out.requests.length)
            ask(out.requests);
    });
    try {
        const fin = JSON.parse(wasm.audit_finish(second));
        if (last < newest)
            fin.warnings.push(`checkpoints ${last + 1} to ${newest}: their files are not on the mirror yet`);
        progress.phase = 'done';
        progress.report = fin;
        tell();
        return { ...fin, proofs, passports, upto: last, latest: newest, ok: fin.problems.length === 0 };
    }
    finally {
        wasm.audit_drop(second);
    }
}
/** An entries file with every body as its text (a mirror may write a body as JSON). */
export function normalizeEntries(text) {
    const list = JSON.parse(text);
    if (!Array.isArray(list))
        throw new Error('entries: not an array');
    if (list.every((e) => typeof e.body === 'string'))
        return text;
    return JSON.stringify(list.map((e) => ({ ...e, body: typeof e.body === 'string' ? e.body : canonicalJson(e.body) })));
}
/** Canonical JSON (SPEC §3): sorted keys, no whitespace, integers only. */
function canonicalJson(v) {
    if (v === null || typeof v !== 'object')
        return JSON.stringify(v);
    if (Array.isArray(v))
        return '[' + v.map(canonicalJson).join(',') + ']';
    const o = v;
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}';
}
/**
 * Verifies ballot proofs with bb.js against the mirror's verification
 * keys (circuits/<name>/vk), each checked against the hash the poll names
 * (as the CLI does with bb). `bytes` reads a mirror file's bytes.
 */
export function bbVerifier(bytes, target = 'noir-recursive') {
    const keys = new Map();
    let verifier = null;
    const vk = (name, hash) => {
        let k = keys.get(hash);
        if (k)
            return k;
        k = (async () => {
            if (/[/.]/.test(name))
                throw new Error(`circuit name ${name}`);
            const b = await bytes(`circuits/${name}/vk`);
            if (!b)
                throw new Error(`circuits/${name}/vk is missing on the mirror`);
            const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', b));
            const got = '0x' + Array.from(digest, (x) => x.toString(16).padStart(2, '0')).join('');
            if (got !== hash.toLowerCase())
                throw new Error(`circuits/${name}/vk: its hash is not the poll's`);
            return b;
        })();
        k.catch(() => keys.delete(hash));
        keys.set(hash, k);
        return k;
    };
    return async (req) => {
        if (!verifier) {
            verifier = (async () => {
                const { Barretenberg, UltraHonkVerifierBackend } = (await import('@aztec/bb.js'));
                const api = await Barretenberg.new({ threads: 1 });
                return new UltraHonkVerifierBackend(api);
            })();
            verifier.catch(() => (verifier = null));
        }
        const [v, key] = await Promise.all([verifier, vk(req.circuit, req.vk_hash)]);
        const proof = Uint8Array.from(atob(req.proof), (c) => c.charCodeAt(0));
        return v.verifyProof({ proof, publicInputs: req.inputs, verificationKey: key }, { verifierTarget: target });
    };
}
// The OPRF keys the registries pin, by id: the SDK asks the OPRF nodes for
// the key a salted proof used (`<node>/oprf_pub/<id>`) and gets the
// registry's, so the audit holds when the nodes are down or serve another
// key. Every other request goes through.
const pinnedOprf = new Map();
let oprfFetchPinned = false;
function pinOprfKey(key) {
    const known = pinnedOprf.get(key.id);
    if (known && (known.x !== key.x || known.y !== key.y))
        throw new Error(`two registries pin OPRF key ${key.id} differently`);
    pinnedOprf.set(key.id, key);
    if (oprfFetchPinned)
        return;
    oprfFetchPinned = true;
    const real = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const m = /\/oprf_pub\/([^/?#]+)$/.exec(url);
        if (!m)
            return real(input, init);
        const k = pinnedOprf.get(decodeURIComponent(m[1]));
        if (!k)
            return new Response('not a registry key', { status: 404 });
        return new Response(JSON.stringify({ key: [k.x, k.y] }), { status: 200, headers: { 'content-type': 'application/json' } });
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
export function zkPassportVerifier(sdk, rpcUrl) {
    return async (req) => {
        const e = req.eligibility;
        if (e.provider !== 'zkpassport')
            throw new Error(`provider ${e.provider}: no verifier in the page`);
        const proofs = req.proof.proofs;
        if (!Array.isArray(proofs) || proofs.length === 0)
            return null;
        const zk = new sdk.ZKPassport(e.domain);
        let b = zk.createQuery();
        if (e.min_age)
            b = b.gte('age', e.min_age);
        if (e.nationality?.length)
            b = b.in('nationality', e.nationality);
        if (e.document_type)
            b = b.eq('document_type', e.document_type);
        const result = (req.proof.result ?? {});
        if (e.require_expiry) {
            const expected = result.expiry_date?.gte?.expected;
            if (!expected)
                return null;
            const date = new Date(expected);
            const day = 86_400_000;
            const ref = req.proof_date * 1000;
            if (!(date.getTime() >= ref - 2 * day && date.getTime() <= ref + day))
                return null;
            b = b.gte('expiry_date', date);
        }
        // A salted identifier comes with the strict face match (verify.mjs).
        if (e.oprf_key)
            b = b.facematch('strict');
        b = b.bind('custom_data', req.custom_data);
        const { query } = b.done();
        // The one identifier type the registry names (verify.mjs).
        if (e.oprf_key)
            pinOprfKey(e.oprf_key);
        const r = await zk.verify({
            proofs,
            originalQuery: query,
            queryResult: req.proof.result,
            scope: e.scope,
            devMode: false,
            uniqueIdentifierType: e.oprf_key ? sdk.NullifierType.SALTED : sdk.NullifierType.NON_SALTED,
            oprfKeyId: e.oprf_key?.id,
            validity: 10 * 365 * 86_400,
            verifierMode: 'local',
            config: { rpcUrl }
        });
        return r.verified && r.uniqueIdentifier ? r.uniqueIdentifier : null;
    };
}
//# sourceMappingURL=audit.js.map