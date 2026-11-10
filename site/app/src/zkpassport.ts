// The ZKPassport adapter (isoloir js/README.md, "The ZKPassport adapter"): the
// browser must ask for exactly the query the ingest's verifier rebuilds from
// the registry's eligibility and the registration binding, or the proof
// fails on the server. Nothing about the passport reaches this page but the
// proofs, the query result and the document's unique identifier.
//
// The SDK's own result callback runs its verifier first (bb.js in the page,
// then ZKPassport's API) and says nothing meanwhile: a scan looked stuck on
// the code for minutes, and on Firefox the local verifier froze the page.
// This adapter takes the proofs as they come, says so, reads the identifier
// through ZKPassport's verifier API (seconds, off the page's thread), and
// gives up with a message instead of leaving the code on screen. The ingest
// verifies the proofs itself; the API's verdict is only how the identifier
// is read.
import { ZKPassport, NullifierType } from '@zkpassport/sdk';
import type { PassportProof, RegistrationRequest, Session } from '@isoloir/web';

export interface ScanUi {
  /** Show the request's URL as a QR code (and as a link on phones). */
  showRequest(url: string): void;
  status(text: string): void;
  /** The phone has the request: the code is no longer needed on screen. */
  codeTaken?(): void;
}

export interface ZkpBranding {
  name: string;
  purpose: string;
  logo?: string;
}

/** How long the phone may stay silent at each step before the page gives up. */
const APP_SILENCE_MS = 4 * 60_000;

const log = (m: string, ...a: unknown[]) => console.info(`zkpassport: ${m}`, ...a);

export function zkpassportScan(brand: ZkpBranding, ui: ScanUi) {
  return async (req: RegistrationRequest, session: Session): Promise<PassportProof> => {
    const e = req.eligibility;
    // The expiry check is against the proof's day on the server's clock (±1 day on the verifier).
    const day = new Date(session.serverNow());
    const zk = new ZKPassport(e.domain);
    // The registry's identifier type: salted under its pinned OPRF key (the app then requires a face match), or the document's own.
    const salted = !!e.oprf_key;
    const want = salted ? NullifierType.SALTED : NullifierType.NON_SALTED;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = await zk.request({
      name: brand.name,
      logo: brand.logo,
      purpose: brand.purpose,
      scope: e.scope,
      mode: 'compressed',
      validity: req.validity,
      uniqueIdentifierType: want,
      ...(salted ? { oprfKeyId: e.oprf_key!.id } : {})
    });
    // The SDK gives no salted identifier without the strict face match: the app matches the holder's face to the chip's photo, on the phone.
    if (salted) q = q.facematch('strict');
    if (e.min_age) q = q.gte('age', e.min_age);
    if (e.nationality?.length) q = q.in('nationality', e.nationality);
    if (e.document_type) q = q.eq('document_type', e.document_type);
    if (e.require_expiry) q = q.gte('expiry_date', day);
    q = q.bind('custom_data', req.customData);
    const r = q.done();
    log('request made', { domain: e.domain, scope: e.scope, url: r.url });
    ui.showRequest(r.url);
    ui.status('Scan the code with the ZKPassport app, then scan your passport.');
    const proofs: unknown[] = [];

    // Reads the identifier from the proofs through ZKPassport's verifier API (the SDK's call, 60 s timeout).
    const read = (result: unknown) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (zk as any).verify({
        proofs,
        originalQuery: r.query,
        queryResult: result,
        scope: e.scope,
        devMode: false,
        uniqueIdentifierType: want,
        oprfKeyId: e.oprf_key?.id,
        validity: req.validity,
        verifierMode: 'api'
      }) as Promise<{ uniqueIdentifier?: string; uniqueIdentifierType?: NullifierType; verified: boolean }>;

    return new Promise<PassportProof>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle = (f: () => void) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); f(); };
      const arm = (what: string, ms = APP_SILENCE_MS) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => settle(() => reject(new Error(`${what} for ${Math.round(ms / 60_000)} minutes. Scan again; your key stays the same.`))), ms);
      };
      arm('No phone took the request', 10 * 60_000);
      r.onBridgeConnect(() => log('bridge connected'));
      r.onBridgeConnectionLost(() => { log('bridge connection lost'); ui.status('The link to the phone dropped; it reconnects by itself. If nothing happens, scan again.'); });
      r.onRequestReceived(() => {
        log('request received on the phone');
        ui.codeTaken?.();
        ui.status('Request received on the phone. Accept it, then hold the passport to the phone.');
        arm('The app has not answered');
      });
      r.onGeneratingProof(() => {
        log('the phone is proving');
        ui.status('The phone is generating the proofs (10 to 60 seconds)…');
        arm('The app has been proving');
      });
      r.onProofGenerated((p: unknown) => {
        proofs.push(p);
        const n = (p as { total?: number })?.total;
        log(`proof ${proofs.length}${n ? ` of ${n}` : ''} received`);
        ui.status(`Proof ${proofs.length}${n ? ` of ${n}` : ''} received from the phone…`);
        arm('The app has not sent the rest of the proofs');
      });
      r.onSuccess(async ({ result }: { result: unknown }) => {
        log('all proofs received; reading the identifier');
        ui.status('All proofs received. Reading the document identifier (a few seconds)…');
        arm('Reading the identifier took too long', 90_000);
        let v: Awaited<ReturnType<typeof read>> | null = null;
        try { v = await read(result); log('verifier API', v); } catch (err) { log('verifier API failed', err); }
        settle(() => {
          if (!v?.uniqueIdentifier) return reject(new Error('the document identifier could not be read from the proofs (details in the browser console). Scan again.'));
          if (v.uniqueIdentifierType !== want) return reject(new Error(`the identifier is not of the registry's type (${salted ? 'salted' : 'non-salted'})`));
          // The ingest verifies the proofs itself (zkverifier/verify.mjs); the "verified" flag of the browser is not used.
          resolve({ uid: v.uniqueIdentifier, proof: { proofs, result }, proofDate: Math.floor(session.serverNow() / 1000) });
        });
      });
      r.onReject(() => { log('rejected on the phone'); settle(() => reject(new Error('rejected on the phone'))); });
      r.onError((err: string) => { log('error', err); settle(() => reject(new Error(err))); });
    });
  };
}

/** The dev provider of a local trial (scripts/trial.sh): the bundle names the identifier, nothing is proven. */
export function devScan(ask: () => Promise<string>) {
  return async (_req: RegistrationRequest, session: Session): Promise<PassportProof> => {
    const uid = (await ask()).trim();
    if (!uid) throw new Error('an identifier is needed');
    return { uid, proof: { uid }, proofDate: Math.floor(session.serverNow() / 1000) };
  };
}
