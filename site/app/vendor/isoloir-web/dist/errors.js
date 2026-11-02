// What went wrong, named: every failure the session meets carries a code
// the app translates, a detail for the curious (never a secret), and for
// some codes structured data (the positions of wrong words).
export class IsoloirError extends Error {
    code;
    detail;
    data;
    constructor(code, detail = '', data) {
        super(detail ? `${code}: ${detail}` : code);
        this.code = code;
        this.detail = detail;
        this.data = data;
        this.name = 'IsoloirError';
    }
}
export function toIsoloirError(e, fallback = 'unknown') {
    if (e instanceof IsoloirError)
        return e;
    const msg = e instanceof Error ? e.message : String(e);
    return new IsoloirError(fallback, msg);
}
const REASONS = ['malformed', 'version', 'unknown', 'not_open', 'closed', 'bad_sig', 'stale_date', 'uid_used', 'id_used', 'full', 'bad_proof', 'old_root', 'revote_off', 'stale_seq', 'seq_gap', 'duplicate', 'not_due', 'bad_tally', 'bad_setup', 'rejected'];
/** An ack's reason as a code (an unknown one is 'rejected'). */
export function reasonOf(r) {
    return (r && REASONS.includes(r) ? r : 'rejected');
}
//# sourceMappingURL=errors.js.map