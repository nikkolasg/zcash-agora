// The ZKPassport adapter (isoloir js/README.md, "The ZKPassport adapter"): the
// browser must ask for exactly the query the ingest's verifier rebuilds from
// the registry's eligibility and the registration binding, or the proof
// fails on the server. Nothing about the passport reaches this page but the
// proofs, the query result and the document's unique identifier.
import { ZKPassport, NullifierType } from '@zkpassport/sdk';
import type { PassportProof, RegistrationRequest, Session } from '@isoloir/web';

export interface ScanUi {
  /** Show the request's URL as a QR code (and as a link on phones). */
  showRequest(url: string): void;
  status(text: string): void;
}

export interface ZkpBranding {
  name: string;
  purpose: string;
  logo?: string;
}

export function zkpassportScan(brand: ZkpBranding, ui: ScanUi) {
  return async (req: RegistrationRequest, session: Session): Promise<PassportProof> => {
    const e = req.eligibility;
    // The expiry check is against the proof's day on the server's clock (±1 day on the verifier).
    const day = new Date(session.serverNow());
    const zk = new ZKPassport(e.domain);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // The registry's identifier type: salted under its pinned OPRF key (the app then requires a face match), or the document's own.
    const salted = !!e.oprf_key;
    let q: any = await zk.request({
      name: brand.name,
      logo: brand.logo,
      purpose: brand.purpose,
      scope: e.scope,
      mode: 'compressed',
      validity: req.validity,
      uniqueIdentifierType: salted ? NullifierType.SALTED : NullifierType.NON_SALTED,
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
    ui.showRequest(r.url);
    ui.status('Scan the code with the ZKPassport app, then scan your passport.');
    const proofs: unknown[] = [];
    return new Promise<PassportProof>((resolve, reject) => {
      r.onRequestReceived(() => ui.status('Request received on the phone. Accept it, then hold the passport to the phone.'));
      r.onGeneratingProof(() => ui.status('The phone is generating the proof (10 to 60 seconds)…'));
      r.onProofGenerated((p: unknown) => proofs.push(p));
      r.onResult(({ uniqueIdentifier, uniqueIdentifierType, result }: { uniqueIdentifier?: string; uniqueIdentifierType?: NullifierType; result: unknown }) => {
        if (!uniqueIdentifier) return reject(new Error('the app sent no unique identifier'));
        const want = salted ? NullifierType.SALTED : NullifierType.NON_SALTED;
        if (uniqueIdentifierType !== want) return reject(new Error(`the identifier is not of the registry's type (${salted ? 'salted' : 'non-salted'})`));
        // The ingest verifies the proofs itself (zkverifier/verify.mjs); the "verified" flag of the app is not used.
        resolve({ uid: uniqueIdentifier, proof: { proofs, result }, proofDate: Math.floor(session.serverNow() / 1000) });
      });
      r.onReject(() => reject(new Error('rejected on the phone')));
      r.onError((err: string) => reject(new Error(err)));
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
