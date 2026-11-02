// The audit of the vote in the visitor's browser (@isoloir/web audit): the
// whole log read from the mirror, every ballot proof checked with bb.js,
// every passport proof with the ZKPassport SDK, every tally recomputed, and
// the relays' copies compared with the log.
import { audit, bbVerifier, zkPassportVerifier, WebSocketTransport, type AuditProgress, type AuditResult, type AuditWasm, type ZkPassportSdk, type IsoloirWasm } from '@isoloir/web';
import { config } from './config.js';

// Public Ethereum endpoints, tried in order: the passport check only reads the certificate registry's roots.
const ETH_RPCS = ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth'];

export function mirrorBase(): string {
  const m = config.mirror;
  return 'url' in m ? m.url : `https://cdn.jsdelivr.net/gh/${m.repo}@${m.branch}`;
}

async function fromMirror<T>(path: string, read: (r: Response) => Promise<T>): Promise<T | null> {
  const r = await fetch(`${mirrorBase()}/${path}`, { credentials: 'omit', cache: 'no-cache' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return read(r);
}

export type { AuditProgress, AuditResult };

export async function runAudit(wasm: IsoloirWasm, onProgress: (p: AuditProgress) => void, signal?: AbortSignal): Promise<AuditResult> {
  const sdk = (await import('@zkpassport/sdk')) as unknown as ZkPassportSdk;
  const passports = ETH_RPCS.map((rpc) => zkPassportVerifier(sdk, rpc));
  return audit(wasm as IsoloirWasm & AuditWasm, {
    text: (p) => fromMirror(p, (r) => r.text()),
    logKey: config.verifierKey,
    verifyProof: bbVerifier((p) => fromMirror(p, async (r) => new Uint8Array(await r.arrayBuffer()))),
    verifyPassport: async (req) => {
      // A local trial: the dev provider's bundle names the identifier and proves nothing (the ingest ran with --dev).
      if (config.dev && req.eligibility.provider === 'dev') return typeof req.proof.uid === 'string' ? req.proof.uid : null;
      let last: unknown = null;
      for (const v of passports) {
        try { return await v(req); } catch (e) { last = e; }
      }
      throw last;
    },
    relays: new WebSocketTransport(),
    onProgress,
    signal
  });
}

// ---------------------------------------------------------------- the view

type StepKey = 'log' | 'registrations' | 'ballots' | 'tallies' | 'relays';
const STEPS: StepKey[] = ['log', 'registrations', 'ballots', 'tallies', 'relays'];
const STEP_TEXT: Record<StepKey, string> = {
  log: 'Log signed and intact',
  registrations: 'One passport, one registration',
  ballots: 'Valid ballots, proofs re-verified',
  tallies: 'Result recounted from the opened ballots',
  relays: 'Every ballot sent is in the log'
};
const NODES = ['Voters', 'Relays', 'Ledger', 'Log', 'Results'];
const NODE_ICONS = [
  'M12 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20c0-3.6 3.1-6 7-6s7 2.4 7 6',
  'M12 11v9M8.5 7.5a5 5 0 0 1 7 0M5.5 4.5a9 9 0 0 1 13 0M12 11.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  'M5 4h14v7H5zM5 13h14v7H5zM8 7.5h.01M8 16.5h.01',
  'M6 4h10a3 3 0 0 1 3 3v13H9a3 3 0 0 1-3-3zM6 17a3 3 0 0 1 3-3h10M10 8h5',
  'M6 20v-7M12 20V5M18 20v-10'
];
// Which node each phase lights: download reads voters+relays+ledger, proofs = ledger, replay = log, relays = relays, done = results.
const PHASE_NODE: Record<string, number> = { download: 2, proofs: 2, replay: 3, relays: 1, done: 4 };

function stepOf(p: string): StepKey {
  if (/\(register\)|registr/i.test(p)) return 'registrations';
  if (/\(ballot\)/.test(p)) return 'ballots';
  if (/tally|close/.test(p)) return 'tallies';
  if (/relay|event |acknowledged/.test(p)) return 'relays';
  return 'log';
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function mountAudit(container: HTMLElement, wasm: IsoloirWasm, enabled: boolean): void {
  let progress: AuditProgress | null = null;
  let result: AuditResult | null = null;
  let failure: string | null = null;
  let running = false;
  let shown = 0;
  let ctl: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const count = (k: StepKey): string => {
    const r = result; if (!r) return '';
    switch (k) {
      case 'log': return plural(r.checkpoints, 'checkpoint');
      case 'registrations': return `${plural(r.registrations, 'registration')}, ${plural(r.passports.checked, 'passport proof')} checked`;
      case 'ballots': return `${plural(r.ballots, 'ballot')}, ${plural(r.proofs.checked, 'proof')} verified`;
      case 'tallies': return plural(r.tallies, 'result');
      case 'relays': return r.relays ? `${plural(r.relays.events, 'message')} compared` : 'no relay read';
    }
  };
  const live = (): string => {
    const p = progress; if (!p) return 'Starting…';
    if (p.phase === 'download') return `Reading the log · ${p.checkpoint}/${p.checkpoints}`;
    if (p.phase === 'proofs') return `Checking the proofs · ${p.verified}/${p.asked}`;
    if (p.phase === 'replay') return `Recounting · ${p.checkpoint}/${p.checkpoints}`;
    if (p.phase === 'relays') return 'Reading the relays';
    return 'Done';
  };
  const pct = (): number => {
    const p = progress; if (!p) return 0;
    if (p.phase === 'download') return (p.checkpoint / Math.max(1, p.checkpoints)) * 45;
    if (p.phase === 'proofs') return 45 + (p.verified / Math.max(1, p.asked)) * 15;
    if (p.phase === 'replay') return 60 + (p.checkpoint / Math.max(1, p.checkpoints)) * 30;
    if (p.phase === 'relays') return 92;
    return 100;
  };

  const render = () => {
    const failed = new Set((result?.problems ?? []).map(stepOf));
    const told = STEPS.slice(0, Math.min(shown, STEPS.length));
    const done = !!result && shown > STEPS.length;
    const cur = running && progress ? PHASE_NODE[progress.phase] ?? 0 : -1;
    const nodeClass = (i: number) => {
      if (running) return i < cur ? '' : i === cur ? 'run' : 'wait';
      if (done || (result && !running)) return failed.size && (i === 0 && failed.has('registrations') || i === 1 && failed.has('relays') || i === 3 && failed.has('log') || i === 4 && failed.has('tallies') || i === 2 && failed.has('ballots')) ? 'ko' : '';
      return 'wait';
    };
    container.innerHTML = `
      <h2 id="audit">Audit the vote</h2>
      <p class="muted">Your browser redoes every check, from the public log: the signatures, every passport proof, every ballot proof, the opened ballots, the relays. The same checks the command-line auditor runs.</p>
      ${enabled ? '' : '<div class="card warn">The audit opens with the ledger.</div>'}
      <div class="pipe" aria-hidden="true">
        ${NODES.map((n, i) => `${i ? `<span class="link ${running && i > cur ? 'wait' : ''}"></span>` : ''}<span class="node ${nodeClass(i)}"><span class="disc"><svg viewBox="0 0 24 24"><path d="${NODE_ICONS[i]}"/></svg>${!running && result && nodeClass(i) === '' ? '<span class="tick">✓</span>' : ''}</span><span class="name">${n}</span></span>`).join('')}
      </div>
      ${running ? `<div class="live"><span class="spin"></span><span>${esc(live())}</span><span class="bar"><span style="width:${pct()}%"></span></span><button class="btn secondary" id="audit-stop">Stop</button></div>` : ''}
      <ol class="stack">${told.map((k) => `<li class="${failed.has(k) ? 'ko' : ''}"><span class="icon"><svg viewBox="0 0 24 24"><path d="${failed.has(k) ? 'M7 7l10 10M17 7L7 17' : 'M5 12.5l4.5 4.5L19 7.5'}"/></svg></span><span class="text"><strong>${STEP_TEXT[k]}</strong><span class="count">${esc(count(k))}</span></span></li>`).join('')}</ol>
      ${!running && done && result ? (result.ok
        ? `<div class="verdict ok" role="status"><svg viewBox="0 0 52 52" class="seal" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg><h2>Everything checks out</h2><p class="muted">${result.polls.map((p) => `${esc(p.title)}: ${plural(p.ballots, 'ballot')}`).join(' · ')}${result.warnings.length ? `<br>${result.warnings.map(esc).join('<br>')}` : ''}</p></div>`
        : `<div class="verdict ko" role="alert"><h2>${plural(result.problems.length, 'problem')}</h2><ul>${result.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul><a class="btn secondary" href="https://github.com/lanterne-labs/zcash-agora/issues/new">Report it</a></div>`) : ''}
      ${!running && failure ? `<div class="verdict ko" role="alert"><h2>The check stopped</h2><p>${esc(failure)}</p></div>` : ''}
      ${!running && (!result || done) && enabled ? `<p><button class="btn" id="audit-start">${result || failure ? 'Audit again' : 'Audit the vote'}</button></p>` : ''}
      <p class="cite">The code of the check: <a href="https://github.com/tartuffeme/isoloir/blob/main/js/src/audit.ts">@isoloir/web audit</a>, the same judge as <code>isoloir audit</code>. To run it outside a browser, with circuits you built yourself: <a href="https://github.com/lanterne-labs/zcash-agora/blob/main/scripts/audit.sh">scripts/audit.sh</a>.</p>`;
    container.querySelector('#audit-start')?.addEventListener('click', start);
    container.querySelector('#audit-stop')?.addEventListener('click', () => ctl?.abort());
  };

  async function start() {
    running = true; result = null; failure = null; progress = null; shown = 0;
    if (timer) clearInterval(timer);
    ctl = new AbortController();
    render();
    try {
      result = await runAudit(wasm, (p) => { progress = p; render(); }, ctl.signal);
      running = false;
      timer = setInterval(() => { shown++; render(); if (shown > STEPS.length && timer) clearInterval(timer); }, 650);
    } catch (e) {
      if (!ctl.signal.aborted) failure = e instanceof Error ? e.message : String(e);
      console.error('audit failed', e);
      running = false;
    }
    render();
  }
  render();
  if (location.hash === '#audit') container.scrollIntoView();
}
