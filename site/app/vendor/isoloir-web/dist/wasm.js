// The wasm core (crates/wasm): every protocol rule the browser applies.
// `IsoloirWasm` is the raw module (strings in, strings out, throws on a
// refusal); `Core` parses its JSON into typed values. The module is
// given to the session by the app (loadWasm in a browser, the nodejs
// build in tests), so this package never guesses how wasm is served.
/** The message of whatever wasm threw. */
export function messageOf(e) {
    if (e instanceof Error)
        return e.message;
    if (e && typeof e === 'object' && 'message' in e)
        return String(e.message);
    return String(e);
}
/**
 * Loads the browser build (wasm-pack --target web) shipped in this
 * package. By default the .wasm file is fetched next to the module
 * (bundlers that handle `new URL(..., import.meta.url)` serve it); an app
 * that serves it elsewhere passes its URL, a Response or its bytes.
 */
export async function loadWasm(input) {
    const m = await import('../wasm/web/isoloir_wasm.js');
    await m.default(input === undefined ? undefined : { module_or_path: input });
    return m;
}
const json = JSON.stringify;
/** The wasm core with typed results. */
export class Core {
    w;
    kinds;
    constructor(w) {
        this.w = w;
        this.kinds = JSON.parse(w.kinds());
    }
    canonical(v) {
        return this.w.canonical(json(v));
    }
    bodyHash(body) {
        return this.w.body_hash(body);
    }
    decodeBody(kind, text) {
        return JSON.parse(this.w.decode_body(kind, text));
    }
    leaf(registry, s) {
        return this.w.leaf(registry, s);
    }
    nullifier(poll, s) {
        return this.w.nullifier(poll, s);
    }
    deltaLeaf(ident, cmt) {
        return this.w.delta_leaf(ident, cmt);
    }
    secretFromPrf(prf) {
        return this.w.secret_from_prf(toHex(prf));
    }
    newWords(lang) {
        return this.w.new_words(lang);
    }
    normalizeWords(words, lang) {
        return this.w.normalize_words(words, lang);
    }
    secretFromWords(words, lang) {
        return this.w.secret_from_words(words, lang);
    }
    /** What is wrong with a phrase (1-based positions of the words not on the list). */
    checkWords(words, lang) {
        return JSON.parse(this.w.check_words(words, lang));
    }
    /** A word in the list's spelling (case and accents folded), or null. */
    canonicalWord(word, lang) {
        return this.w.canonical_word(word, lang) || null;
    }
    verifyLogged(seq, kind, body, path, size, root) {
        return this.w.verify_logged(seq, kind, body, json(path), size, root);
    }
    relayRanking(s, urls) {
        return JSON.parse(this.w.relay_ranking(s, json(urls)));
    }
    newRegSecret() {
        return this.w.new_reg_secret();
    }
    regPubkey(sk) {
        return this.w.reg_pubkey(sk);
    }
    registrationBinding(registry, pubkey) {
        return this.w.registration_binding(registry, pubkey);
    }
    registerBody(req) {
        return this.w.register_body(json(req));
    }
    kindInfo(poll) {
        return JSON.parse(this.w.kind_info(json(poll)));
    }
    choiceValues(poll, choice) {
        return JSON.parse(this.w.choice_values(json(poll), json(choice)));
    }
    draftBallot(req) {
        return JSON.parse(this.w.draft_ballot(json(req)));
    }
    finishBallot(body, proof) {
        return this.w.finish_ballot(json(body), proof);
    }
    publicInputs(body, poll) {
        return JSON.parse(this.w.public_inputs(body, json(poll)));
    }
    deltaRecover(poll, s, leaves) {
        return JSON.parse(this.w.delta_recover(json(poll), s, json(leaves)));
    }
    treeRoot(depth, leaves) {
        return this.w.tree_root(depth, json(leaves));
    }
    treePath(depth, leaves, position) {
        return JSON.parse(this.w.tree_path(depth, json(leaves), position));
    }
    verifyNote(note, verifierKey) {
        return JSON.parse(this.w.verify_note(note, verifierKey));
    }
    signEvent(sk, createdAt, kind, tags, content) {
        return JSON.parse(this.w.sign_event(sk, createdAt, kind, json(tags), content));
    }
    verifyEvent(e) {
        return this.w.verify_event(json(e));
    }
    readAck(e, ingest) {
        return JSON.parse(this.w.read_ack(json(e), ingest));
    }
    complaintBody(ack, body) {
        return this.w.complaint_body(json(ack), body);
    }
    verifyTally(poll, tally) {
        return JSON.parse(this.w.verify_tally(json(poll), tally));
    }
    tallyResults(poll, values, counted) {
        return JSON.parse(this.w.tally_results(json(poll), json(values), counted));
    }
    linkReceiver() {
        return JSON.parse(this.w.link_receiver());
    }
    linkSeal(receiverPublic, payload) {
        return JSON.parse(this.w.link_seal(receiverPublic, payload));
    }
    linkOpen(receiverSecret, sealed) {
        return JSON.parse(this.w.link_open(receiverSecret, sealed));
    }
    /** Reads a complaint, its signed event or its body (SPEC §11.3); throws when its form does not hold. */
    readComplaint(text, ingestKeys = []) {
        return JSON.parse(this.w.read_complaint(text, json(ingestKeys)));
    }
    /** The first nonce in start … start + count − 1 that does the work, or null (SPEC §11.1). */
    powMine(origin, pubkey, t, bits, start, count) {
        return this.w.pow_mine(origin, pubkey, t, bits, start, count) || null;
    }
    powCheck(origin, pubkey, t, nonce, bits) {
        return this.w.pow_check(origin, pubkey, t, nonce, bits);
    }
}
export function toHex(b) {
    let s = '';
    for (const x of b)
        s += x.toString(16).padStart(2, '0');
    return s;
}
//# sourceMappingURL=wasm.js.map