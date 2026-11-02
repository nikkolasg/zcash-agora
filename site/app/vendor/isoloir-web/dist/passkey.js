// The voter secret from a passkey (SPEC §14): the WebAuthn PRF extension
// evaluated on `isoloir/1/<origin>/<registry>` gives 32 bytes, and the
// wasm core derives `s = H(T_prf, lo, hi)`. The same passkey on another
// device of the same ecosystem gives the same secret: nothing to back up.
import { IsoloirError } from './errors.js';
export function prfInput(origin, registry) {
    return new TextEncoder().encode(`isoloir/1/${origin}/${registry}`);
}
function rnd(opts, n) {
    return opts.random ? opts.random(n) : crypto.getRandomValues(new Uint8Array(n));
}
function credentials(opts) {
    if (opts.credentials)
        return opts.credentials;
    const c = globalThis.navigator?.credentials;
    if (!c)
        throw new IsoloirError('passkey_unsupported');
    return c;
}
function rpId(opts) {
    return opts.rpId ?? globalThis.location?.hostname ?? 'localhost';
}
function passkeyError(e) {
    const name = e && typeof e === 'object' && 'name' in e ? String(e.name) : '';
    if (name === 'NotAllowedError' || name === 'AbortError')
        return new IsoloirError('passkey_cancelled');
    if (name === 'NotSupportedError' || name === 'SecurityError')
        return new IsoloirError('passkey_unsupported', name);
    return new IsoloirError('passkey_failed', e instanceof Error ? e.message : String(e));
}
/**
 * The backup state (BS, flag bit 4) of authenticator data: whether the
 * passkey is synced off the device. Null when the platform does not give
 * the data.
 */
export function backupState(authData) {
    if (!authData)
        return null;
    const b = bytesOf(authData);
    if (b.length < 33)
        return null;
    return (b[32] & 0x10) !== 0;
}
function authDataOf(cred) {
    const r = cred.response;
    try {
        return r?.getAuthenticatorData?.() ?? r?.authenticatorData ?? null;
    }
    catch {
        return null;
    }
}
function bytesOf(b) {
    return b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}
function b64url(b) {
    let s = '';
    for (const x of b)
        s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
/** Whether the platform says it supports the PRF extension (null: it cannot tell). */
export async function prfCapability() {
    const pkc = globalThis.PublicKeyCredential;
    if (!pkc)
        return false;
    if (typeof pkc.getClientCapabilities !== 'function')
        return null;
    try {
        const caps = await pkc.getClientCapabilities();
        return typeof caps['extension:prf'] === 'boolean' ? caps['extension:prf'] : null;
    }
    catch {
        return null;
    }
}
/**
 * Asks a passkey for its PRF output on the input; with no credential id,
 * any passkey of this relying party (a restore).
 */
export async function assertPrf(input, opts = {}, credentialId) {
    return (await assertPrfWithState(input, opts, credentialId)).prf;
}
async function assertPrfWithState(input, opts, credentialId) {
    let cred;
    try {
        cred = await credentials(opts).get({
            publicKey: {
                challenge: rnd(opts, 32),
                rpId: rpId(opts),
                userVerification: 'required',
                allowCredentials: credentialId ? [{ type: 'public-key', id: b64urlDecode(credentialId) }] : [],
                extensions: { prf: { eval: { first: input } } }
            }
        });
    }
    catch (e) {
        throw passkeyError(e);
    }
    if (!cred)
        throw new IsoloirError('passkey_cancelled');
    const ext = cred.getClientExtensionResults();
    const first = ext.prf?.results?.first;
    if (!first)
        throw new IsoloirError('passkey_noprf');
    return { prf: bytesOf(first), backedUp: backupState(authDataOf(cred)) };
}
/**
 * Creates a passkey and reads its PRF output (one prompt where the
 * platform evaluates PRF at creation, else a second for an assertion).
 * Throws passkey_noprf when the platform gives none: the words are then
 * the way. `backedUp` is the passkey's backup state (synced or not; null
 * when the platform does not say).
 */
export async function createPrf(input, opts = {}) {
    // A platform that says it has no PRF gets no passkey (it would be an orphan).
    if ((await (opts.prfCapability ?? (opts.credentials ? async () => null : prfCapability))()) === false)
        throw new IsoloirError('passkey_noprf');
    let cred;
    try {
        cred = await credentials(opts).create({
            publicKey: {
                challenge: rnd(opts, 32),
                rp: { name: opts.rpName ?? 'isoloir', id: rpId(opts) },
                user: { id: rnd(opts, 16), name: opts.userName ?? 'isoloir', displayName: opts.userName ?? 'isoloir' },
                pubKeyCredParams: [
                    { type: 'public-key', alg: -7 },
                    { type: 'public-key', alg: -257 }
                ],
                authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
                extensions: { prf: { eval: { first: input } } }
            }
        });
    }
    catch (e) {
        throw passkeyError(e);
    }
    if (!cred)
        throw new IsoloirError('passkey_cancelled');
    const pk = cred;
    const ext = pk.getClientExtensionResults();
    if (!ext.prf?.enabled && !ext.prf?.results?.first)
        throw new IsoloirError('passkey_noprf');
    const credentialId = b64url(new Uint8Array(pk.rawId));
    const first = ext.prf?.results?.first;
    const created = backupState(authDataOf(pk));
    if (first)
        return { prf: bytesOf(first), credentialId, backedUp: created };
    const asserted = await assertPrfWithState(input, opts, credentialId);
    return { prf: asserted.prf, credentialId, backedUp: asserted.backedUp ?? created };
}
//# sourceMappingURL=passkey.js.map