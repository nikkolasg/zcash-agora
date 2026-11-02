/** The subset of navigator.credentials the session uses (tests stub it). */
export interface CredentialsApi {
    create(options: CredentialCreationOptions): Promise<Credential | null>;
    get(options: CredentialRequestOptions): Promise<Credential | null>;
}
export interface PasskeyOptions {
    /** The relying party: the page's host by default. */
    rpId?: string;
    /** The names the platform shows: the registry's name by default. */
    rpName?: string;
    userName?: string;
    credentials?: CredentialsApi;
    /** Whether the platform supports PRF (default: PublicKeyCredential.getClientCapabilities; unknown with injected credentials). */
    prfCapability?: () => Promise<boolean | null>;
    random?: (n: number) => Uint8Array;
}
export declare function prfInput(origin: string, registry: number): Uint8Array;
/**
 * The backup state (BS, flag bit 4) of authenticator data: whether the
 * passkey is synced off the device. Null when the platform does not give
 * the data.
 */
export declare function backupState(authData: ArrayBuffer | ArrayBufferView | null | undefined): boolean | null;
/** Whether the platform says it supports the PRF extension (null: it cannot tell). */
export declare function prfCapability(): Promise<boolean | null>;
/**
 * Asks a passkey for its PRF output on the input; with no credential id,
 * any passkey of this relying party (a restore).
 */
export declare function assertPrf(input: Uint8Array, opts?: PasskeyOptions, credentialId?: string): Promise<Uint8Array>;
/**
 * Creates a passkey and reads its PRF output (one prompt where the
 * platform evaluates PRF at creation, else a second for an assertion).
 * Throws passkey_noprf when the platform gives none: the words are then
 * the way. `backedUp` is the passkey's backup state (synced or not; null
 * when the platform does not say).
 */
export declare function createPrf(input: Uint8Array, opts?: PasskeyOptions): Promise<{
    prf: Uint8Array;
    credentialId: string;
    backedUp: boolean | null;
}>;
