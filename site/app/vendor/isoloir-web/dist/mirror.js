// The mirror (SPEC §15): the static files the browser reads instead of
// asking the operator anything. Every checkpoint note is verified under
// the pinned verifier key before anything it names is trusted; files are
// read at the checkpoint's commit (its `mirror` token) where a source
// serves by commit, so a reader can prove which files it was served.
//
// A setup or a tally is used only once proven in the log: its file names
// the checkpoint c whose log holds it and the RFC 6962 inclusion proof of
// its leaf; c's note is fetched and verified under the pinned key, and
// the proof checked against c's root by the wasm core. A mirror cannot
// serve another ingest key, other channels or another poll key.
//
// File formats this reader expects (the ingest writes them):
//   checkpoint.txt, checkpoints/<i>.txt   a signed note
//   entries/<i>.json                       [{seq, kind, body}], body the logged text (or its JSON)
//   setup/ledger.json, registries/<id>.json, polls/<id>.json
//                                          {setups: [{seq, body, checkpoint, size, path}, …]}: every
//                                          version in order, the last in force
//   registries/<id>/leaves/<k>.json        ["0x…", …] leaves 1024·k … 1024·k+1023
//   registries/<id>/positions/<pp>.json    {"0x<leaf>": position}, pp the leaf's first two hex digits
//   polls/<id>/pseudonyms/<pp>.json        {"0x<nullifier>": last seq}
//   polls/<id>/ballots/<k>.json            ["0x…", …] ballot tree leaves, 1024 per file
//   polls/<id>/tallies/latest.json         {seq, body, checkpoint, size, path}
//   circuits/<name>/artifact.json          the compiled Noir circuit
import { IsoloirError } from './errors.js';
export const SHARD = 1024;
/** A fetch that gives up after `ms`: a hung request never freezes the session. */
export async function withTimeout(ms, run) {
    const ctl = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            ctl.abort();
            reject(new Error(`timeout after ${ms} ms`));
        }, ms);
    });
    try {
        return await Promise.race([run(ctl.signal), timeout]);
    }
    finally {
        clearTimeout(timer);
    }
}
/** A directory of the latest files (a static host). */
export function dirSource(base) {
    const b = base.replace(/\/$/, '');
    return { url: (path) => `${b}/${path}`, byCommit: false };
}
/** A GitHub repository read through jsDelivr by commit. */
export function jsDelivrSource(repo, branch = 'main') {
    return { url: (path, token) => `https://cdn.jsdelivr.net/gh/${repo}@${token || branch}/${path}`, byCommit: true };
}
export class Mirror {
    core;
    sources;
    verifierKey;
    timeoutMs;
    fetcher;
    notes = new Map();
    constructor(core, sources, verifierKey, fetcher, timeoutMs = 15_000) {
        this.core = core;
        this.sources = sources;
        this.verifierKey = verifierKey;
        this.timeoutMs = timeoutMs;
        if (sources.length === 0)
            throw new IsoloirError('no_setup', 'no mirror source');
        this.fetcher = fetcher ?? ((url, init) => fetch(url, init));
    }
    attempts(token) {
        const out = [];
        if (token)
            for (const source of this.sources)
                if (source.byCommit)
                    out.push({ source, token });
        for (const source of this.sources)
            out.push({ source, token: '' });
        return out;
    }
    /** A file's text, or null when no source has it; throws mirror when every source failed. */
    async text(path, token = '') {
        let lastErr = null;
        let missing = false;
        for (const a of this.attempts(token)) {
            try {
                const got = await withTimeout(this.timeoutMs, async (signal) => {
                    const res = await this.fetcher(a.source.url(path, a.token), { credentials: 'omit', cache: a.token ? 'force-cache' : 'no-cache', signal });
                    if (res.status === 404)
                        return null;
                    if (!res.ok)
                        throw new Error(`HTTP ${res.status}`);
                    return await res.text();
                });
                if (got === null) {
                    missing = true;
                    continue;
                }
                return got;
            }
            catch (e) {
                lastErr = e;
            }
        }
        if (missing || !lastErr)
            return null;
        throw new IsoloirError('mirror', `${path}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
    }
    async json(path, token = '') {
        const t = await this.text(path, token);
        if (t === null)
            return null;
        try {
            return JSON.parse(t);
        }
        catch {
            throw new IsoloirError('mirror', `${path}: not JSON`);
        }
    }
    /** Verifies a note under the pinned key; throws log_key when it does not hold. */
    verify(note) {
        let c;
        try {
            c = this.core.verifyNote(note, this.verifierKey);
        }
        catch (e) {
            throw new IsoloirError('log_key', e instanceof Error ? e.message : String(e));
        }
        this.notes.set(c.index, c);
        return c;
    }
    /** The newest checkpoint, verified. */
    async latest() {
        const note = await this.text('checkpoint.txt');
        return note === null ? null : this.verify(note);
    }
    /** Checkpoint i, verified (kept once read). */
    async checkpoint(index, token = '') {
        const held = this.notes.get(index);
        if (held)
            return held;
        const note = await this.text(`checkpoints/${index}.txt`, token);
        if (note === null)
            return null;
        const c = this.verify(note);
        if (c.index !== index)
            throw new IsoloirError('mirror', `checkpoints/${index}.txt holds checkpoint ${c.index}`);
        return c;
    }
    /** The entries of checkpoint i, null while the mirror has none. */
    async entries(index, token = '') {
        const list = await this.json(`entries/${index}.json`, token);
        if (list === null)
            return null;
        return list.map((e) => ({ seq: e.seq, kind: e.kind, body: typeof e.body === 'string' ? e.body : this.core.canonical(e.body) }));
    }
    /**
     * Proves an entry in the log: checkpoint c's note (verified under the
     * pinned key) has the size the proof is for, and the proof leads from
     * the entry's leaf to its root. Throws unproven otherwise.
     */
    async prove(rec, kind, what) {
        if (!Number.isInteger(rec.seq) || !Number.isInteger(rec.checkpoint) || !Number.isInteger(rec.size) || !Array.isArray(rec.path) || typeof rec.body !== 'string') {
            throw new IsoloirError('unproven', `${what}: no inclusion proof`);
        }
        const cp = await this.checkpoint(rec.checkpoint);
        if (!cp)
            throw new IsoloirError('unproven', `${what}: checkpoint ${rec.checkpoint} is not on the mirror`);
        if (cp.size !== rec.size)
            throw new IsoloirError('unproven', `${what}: a proof for ${rec.size} entries, checkpoint ${rec.checkpoint} has ${cp.size}`);
        let ok = false;
        try {
            ok = this.core.verifyLogged(rec.seq, kind, rec.body, rec.path, rec.size, cp.root);
        }
        catch (e) {
            throw new IsoloirError('unproven', `${what}: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (!ok)
            throw new IsoloirError('unproven', `${what}: the inclusion proof does not hold`);
        return cp;
    }
    /** A setup file (SPEC §15): its last version, proven in the log, decoded by the wasm core. */
    async setup(path, kind, token = '') {
        const raw = await this.json(path, token);
        if (raw === null)
            return null;
        const last = Array.isArray(raw.setups) ? raw.setups[raw.setups.length - 1] : undefined;
        if (!last)
            throw new IsoloirError('no_setup', `${path}: no setup`);
        await this.prove(last, kind, path);
        let body;
        try {
            body = this.core.decodeBody(kind, last.body);
        }
        catch (e) {
            throw new IsoloirError('no_setup', `${path}: ${e instanceof Error ? e.message : String(e)}`);
        }
        return { seq: last.seq, body, text: last.body, checkpoint: last.checkpoint };
    }
    /** The first `size` leaves of a sharded tree file set. */
    async leaves(dir, size, token = '') {
        const out = [];
        for (let k = 0; k * SHARD < size; k++) {
            const shard = await this.json(`${dir}/${k}.json`, token);
            if (!shard)
                throw new IsoloirError('no_path', `${dir}/${k}.json missing`);
            out.push(...shard);
        }
        if (out.length < size)
            throw new IsoloirError('no_path', `${dir}: ${out.length} leaves, the checkpoint names ${size}`);
        return out.slice(0, size);
    }
    /** A leaf's position in a registry, from its shard. */
    async position(registry, leaf, token = '') {
        const shard = await this.json(`registries/${registry}/positions/${leaf.slice(2, 4)}.json`, token);
        return shard?.[leaf] ?? null;
    }
    /** The last seq a pseudonym cast in a linked poll. */
    async pseudonymSeq(poll, nullifier, token = '') {
        const shard = await this.json(`polls/${poll}/pseudonyms/${nullifier.slice(2, 4)}.json`, token);
        return shard?.[nullifier] ?? null;
    }
    /** The latest tally: its body text and seq, proven in the log. */
    async latestTally(poll, token = '') {
        const path = `polls/${poll}/tallies/latest.json`;
        const rec = await this.json(path, token);
        if (rec === null)
            return null;
        await this.prove(rec, 'tally', path);
        return { seq: rec.seq, body: rec.body, checkpoint: rec.checkpoint };
    }
}
//# sourceMappingURL=mirror.js.map