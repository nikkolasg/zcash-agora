// The voting page: a plain renderer over @isoloir/web's Session. No framework.
import {
  Session, loadWasm, WorkerProver, jsDelivrSource, dirSource,
  IsoloirError, type SessionState, type MirrorSource, type Choice
} from '@isoloir/web';
import QRCode from 'qrcode';
import { config } from './config.js';
import { zkpassportScan, devScan } from './zkpassport.js';
import { mountAudit } from './audit.js';

const app = document.getElementById('app')!;
const h = (html: string) => { app.innerHTML = html; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const when = (t: number) => new Date(t * 1000).toUTCString().replace(/ GMT$/, ' UTC');

/** The mirror's base URL, for links and raw files. */
function mirrorBase(): string {
  const m = config.mirror;
  return 'url' in m ? m.url : `https://cdn.jsdelivr.net/gh/${m.repo}@${m.branch}`;
}
/** A mirror file as a page a person can open (GitHub for the repository mirror). */
function mirrorPage(path: string): string {
  const m = config.mirror;
  return 'url' in m ? `${m.url}/${path}` : `https://github.com/${m.repo}/blob/${m.branch}/${path}`;
}

function mirrorSources(): MirrorSource[] | string {
  const m = config.mirror;
  return 'url' in m ? m.url : [jsDelivrSource(m.repo, m.branch)];
}

function header(s: SessionState): string {
  const p = s.poll;
  const title = p ? esc(p.title) : config.name;
  const status = s.pollStatus === 'open' ? `open until ${when(p!.closes)}` :
    s.pollStatus === 'upcoming' ? `opens ${when(p!.opens)}` :
    s.pollStatus === 'closed' ? `closed ${when(p!.closes)}` : '';
  return `<h1>${title}</h1><p class="muted">${status}${s.checkpoint ? ` · log checkpoint ${s.checkpoint.index}, ${s.checkpoint.registries[0]?.size ?? 0} registered` : ''}</p>
  <div class="card warn"><strong>This is a test poll.</strong> It is a trial of the technology on a sample question; its result decides nothing. The question behind it is whether you would use a tool like this to be counted as a person in Zcash. <a href="../why/">Why</a>.</div>`;
}

function notOpenYet(): void {
  h(`<h1>Vote</h1>
  <div class="card warn"><strong>The ledger has not started yet.</strong> The first poll opens on 16 November 2026. Until then there is nothing to register in: the ledger's keys are made at genesis and this page pins them. Read <a href="../how-it-works/">how it works</a> meanwhile.</div>`);
  loadWasm().then((w) => mountAudit(document.getElementById('audit-root')!, w, false)).catch(() => {});
}

function errorBox(e: unknown): string {
  const code = e instanceof IsoloirError ? e.code : 'error';
  const detail = e instanceof Error ? e.message : String(e);
  const hints: Record<string, string> = {
    uid_used: 'This passport is already registered. One passport, one registration: restore your key with your 12 words or your passkey instead.',
    revote_off: 'A ballot of yours is already in the log. This poll takes one ballot per voter.',
    passkey_not_backed_up: 'Your platform did not confirm the passkey is synced. Use the 12 words instead.',
    passkey_noprf: 'This browser cannot derive a key from a passkey. Use the 12 words instead.',
    bad_words: 'Some words do not match. Check them and try again.',
    backup_required: 'Save the 12 words (or decline the backup) before registering.',
    no_ack: 'No relay answered with the ledger\'s receipt. Your message is kept on this device: post it again in a moment.',
    too_soon: 'The ledger takes one ballot per voter in this poll; a ballot of yours is already on its way.',
    pow: 'The proof of work for the envelope could not be made. Reload the page and try again.',
    pin_mismatch: 'A proving file from the network did not match its pinned hash. Reload and try again; if it persists, tell us.',
    stale_mirror: 'The log mirror is more than 30 minutes old; the ledger may be paused. Try again in a few minutes.'
  };
  return `<p class="err"><strong>${esc(code)}</strong>: ${esc(hints[code] ?? detail)}</p>`;
}

async function main() {
  if (!config.verifierKey) return notOpenYet();
  h(`<h1>Vote</h1><p class="muted">Loading the voting booth…</p>`);

  const wasm = await loadWasm();
  let pollClosed = false;
  const renderAudit = mountAudit(document.getElementById('audit-root')!, wasm, true, () => pollClosed);
  const prover = new WorkerProver(
    () => new Worker(new URL('@isoloir/web/prove.worker', import.meta.url), { type: 'module' }) as unknown as import('@isoloir/web').WorkerLike,
    async (circuit) => {
      const r = await fetch(`${mirrorBase()}/circuits/${circuit}/artifact.json`);
      if (!r.ok) throw new Error(`circuit ${circuit}: ${r.status}`);
      return r.text();
    }
  );
  const session = new Session({
    core: wasm,
    origin: config.origin,
    verifierKey: config.verifierKey,
    registry: config.registry,
    poll: config.poll,
    mirror: mirrorSources(),
    prover,
    wordsLang: 'en',
    passkey: { rpName: config.name } as never
  });

  let pending: { kind: 'scan'; url?: string; text: string } | { kind: 'words'; words: string } | { kind: 'confirm'; words: string; positions: number[] } | null = null;
  let lastError: unknown = null;
  let busy = false;
  let showWords = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  // Where the ballot sits in the public log: the snapshot, the entry number, the pseudonym. Looked up from the mirror once.
  let place: { hash: string; checkpoint: number; seq: number; nullifier: string } | null = null;
  // The entries of a checkpoint are readable once a later note covers its commit: not found yet is tried again, not before 10 s.
  let placeNext = 0;
  const findPlace = async (hash: string, from: number) => {
    placeNext = Date.now() + 10_000;
    for (let i = from; i < from + 4; i++) {
      try {
        const r = await fetch(`${mirrorBase()}/entries/${i}.json`, { cache: 'no-store' });
        if (!r.ok) break;
        const entries = (await r.json()) as { kind: string; seq: number; body: string }[];
        const mine = entries.find((e) => e.kind === 'ballot' && wasm.body_hash(e.body) === hash);
        if (mine) { place = { hash, checkpoint: i, seq: mine.seq, nullifier: String(JSON.parse(mine.body).nullifier ?? '') }; render(); return; }
      } catch { break; }
    }
  };

  const render = () => {
    const s = session.state();
    if ((s.pollStatus === 'closed') !== pollClosed) { pollClosed = s.pollStatus === 'closed'; renderAudit(); }
    // The close is a moment, not an event: re-render then, so the page and the audit follow it.
    if (s.poll && s.pollStatus === 'open' && !closeTimer) closeTimer = setTimeout(() => { closeTimer = null; render(); }, Math.max(0, s.poll.closes * 1000 - session.serverNow()) + 1500);
    let body = (config.dev ? `<div class="card warn"><strong>Test mode.</strong> This ledger runs on your machine with isoloir's <em>dev</em> registry: you register by typing an identifier, no passport. A production ingest refuses such a registry; the real poll takes ZKPassport proofs only.</div>` : '') + header(s);
    if (s.error) body += `<p class="err">${esc(s.error.code)}: ${esc(s.error.detail)}</p>`;
    if (lastError) body += errorBox(lastError);

    let booth = '';
    if (s.phase === 'loading') booth += `<p class="muted">Reading the ledger's setup from the mirror and checking it against the pinned key…</p>`;

    // 1. No key: register (scan) or restore.
    if (s.phase === 'no-key' || s.phase === 'unregistered' || s.phase === 'registering') {
      if (pending?.kind === 'scan') {
        booth += `<div class="phase"><h2>Prove you are one person</h2><p>${esc(pending.text)}</p>
          <div class="qr"><canvas id="qr"></canvas></div>
          ${pending.url ? `<p class="muted"><a href="${esc(pending.url)}">On this phone? Open the request in the ZKPassport app.</a></p>` : ''}</div>`;
      } else if (pending?.kind === 'words') {
        booth += `<div class="phase"><h2>Your recovery code: write these 12 words down</h2>
          <p>They are the only way to vote from another device in a later poll, and the only thing that could ever link you to your ballot. Keep them private.</p>
          <ol class="words">${pending.words.split(' ').map((w) => `<li>${esc(w)}</li>`).join('')}</ol>
          <div class="row"><button class="btn" id="wrote">I wrote them down</button></div></div>`;
      } else if (pending?.kind === 'confirm') {
        booth += `<div class="phase"><h2>Check the words</h2><p>Type words ${pending.positions.join(', ')}:</p>
          <div class="row">${pending.positions.map((p) => `<input type="text" autocomplete="off" autocapitalize="none" data-pos="${p}" placeholder="word ${p}">`).join('')}</div>
          <div class="row"><button class="btn" id="confirm">Confirm and register</button>
          <button class="btn danger" id="skip">Skip the check</button></div>
          <p class="muted">Skipping means the words are not confirmed: you can still vote from this browser, and from nowhere else. Clearing this browser's storage loses the key for good.</p></div>`;
      } else if (s.registration.state === 'posting' || s.registration.state === 'sent') {
        booth += `<div class="phase"><h2>Registering…</h2><p class="muted">Posting the proof through the relays and waiting for the ledger's signed receipt (up to a minute per relay).</p></div>`;
      } else if (s.registration.state === 'acked') {
        booth += `<div class="phase"><h2>Registration confirmed</h2><p>The ledger signed a receipt for it. It is being published in the public log: the vote opens here by itself in a minute or two, no reload needed.</p></div>`;
      } else if (s.registration.state === 'rejected') {
        booth += `<div class="phase"><h2>Refused</h2><p class="err">${esc(s.registration.reason ?? '')} ${esc(s.registration.detail ?? '')}</p></div>`;
      } else if (s.key && !s.key.backedUp) {
        booth += `<div class="phase"><h2>Your key is not confirmed yet</h2>
          <p>A key was made on this device but its 12 words were not confirmed. Confirm them to register, or start over.</p>
          <div class="row"><button class="btn" id="words" ${busy ? 'disabled' : ''}>Show my 12 words</button>
          <button class="btn secondary" id="forget">Start over</button></div></div>`;
      } else if (s.key && s.registration.state === 'failed') {
        booth += `<div class="phase"><h2>Registration did not get through</h2><p class="err">${esc(s.registration.reason ?? '')}${s.registration.stale ? ' (the passport proof is too old: scan again)' : ''}</p>
          <div class="row"><button class="btn" id="scan" ${busy ? 'disabled' : ''}>${s.registration.stale ? 'Scan again and register' : 'Post the registration again'}</button>
          <button class="btn secondary" id="forget">Start over</button></div></div>`;
      } else if (s.key) {
        booth += `<div class="phase"><h2>Register this key</h2><p>Your key is confirmed. ${session.scanReady() ? 'The passport proof is ready: post the registration.' : 'Scan your passport, then the registration is posted.'}</p>
          <div class="row"><button class="btn" id="scan" ${busy ? 'disabled' : ''}>${session.scanReady() ? 'Register' : (config.dev ? 'Register (trial: type an identifier)' : 'Scan my passport')}</button>
          <button class="btn secondary" id="forget">Start over</button></div></div>`;
      } else {
        booth += `<div class="phase"><h2>Register once, vote in every poll</h2>
          <p>Scan your passport with the <a href="https://zkpassport.id">ZKPassport</a> app. The proof is made on your phone; this page only receives a number unique to the document.</p>
          <div class="row"><button class="btn" id="scan" ${busy ? 'disabled' : ''}>${config.dev ? 'Register (trial: type an identifier)' : 'Scan my passport'}</button>
          <button class="btn secondary" id="restore" ${busy ? 'disabled' : ''}>I already registered: restore my 12 words</button></div>
          <details><summary>What this page learns, and does not</summary><p>Learns: that someone with a valid passport registered, under a random-looking identifier. The identifier is derived from your document inside the proof and salted by ZKPassport's threshold OPRF, so neither this ledger nor the state that issued the passport can recompute it from your passport number; it only lets the ledger refuse a second registration with the same document. Does not learn: your passport number, name, nationality, age, photo, or how you will vote. <a href="../eligibility/">Details</a>.</p></details></div>`;
      }
    }

    // 2. Ready: vote, or show the receipt / the result.
    if (s.phase === 'ready' || s.phase === 'joining') {
      const b = s.ballot;
      if (s.phase === 'joining') booth += `<div class="phase"><h2>Registration confirmed</h2><p class="muted">It is being published in the public log: the ballot form appears here by itself in a minute or two, no reload needed.</p></div>`;
      if (s.phase === 'joining') {
        // Not in the tree yet: no ballot can prove membership.
      } else if (b.state === 'idle' && s.pollStatus === 'open' && s.kind && s.poll) {
        const opts = s.poll.kind.options;
        booth += `<div class="phase"><h2>Cast your ballot</h2>
          <form id="ballot"><div class="options">
          ${opts.map((o, i) => `<label><input type="radio" name="pick" value="${i}" required>${esc(o)}</label>`).join('')}
          ${s.poll.kind.blank ? `<label><input type="radio" name="pick" value="${opts.length}">Blank: I take part and abstain</label>` : ''}
          </div>
          <p class="muted">One ballot, no changes. Sealed until ${when(s.poll.closes)} with the drand beacon; then public under your anonymous pseudonym.</p>
          <div class="row"><button class="btn" type="submit" ${busy ? 'disabled' : ''}>Seal and cast</button></div></form>
          <p class="muted">Prover: ${s.prover}${s.storage !== 'persistent' ? ` · storage: ${s.storage} (your key may not survive a browser cleanup; keep the words)` : ''}</p></div>`;
      } else if (b.state === 'idle' && s.pollStatus === 'upcoming') {
        booth += `<p>You are registered. The poll opens ${when(s.poll!.opens)}.</p>`;
      } else if (b.state === 'drafting' || b.state === 'proving') {
        booth += `<div class="phase"><h2>Proving…</h2><p class="muted">Your browser is proving, in zero knowledge, that you are in the registry, and sealing your choice. Ten seconds to a minute depending on the device.</p><div class="progress"><span style="width:50%"></span></div></div>`;
      } else if (b.state === 'posting' || b.state === 'sent') {
        booth += `<div class="phase"><h2>Posting…</h2><p class="muted">Sending the sealed ballot through the relays and waiting for the signed receipt.</p></div>`;
      } else if (b.state === 'acked' || b.state === 'verified' || b.state === 'missing' || b.state === 'rejected' || b.state === 'failed') {
        // The receipt, in plain words: what the ledger said, and what this browser checked.
        const ok = b.state === 'verified' || b.state === 'acked';
        const cp = b.checkpoint ?? null;
        const at = place && place.hash === b.hash ? place : null;
        if (b.state === 'verified' && b.hash && cp != null && !at && Date.now() >= placeNext) void findPlace(b.hash, cp);
        const title = b.state === 'verified' ? 'Your ballot is in the public log' :
          b.state === 'acked' ? 'The ledger accepted your ballot' :
          b.state === 'missing' ? 'The ledger dropped your ballot' :
          b.state === 'rejected' ? 'The ledger refused your ballot' : 'Your ballot did not get through';
        const text = b.state === 'verified' ? `Its proof was valid: the ledger accepted it and published it, signed, in the log. This browser read the log from the mirror and found your ballot in it. It stays sealed until the close.` :
          b.state === 'acked' ? `It signed a receipt for it. The ballot appears in the next published snapshot of the log; this page checks that by itself.` :
          b.state === 'missing' ? `It signed a receipt for it, but snapshot ${cp} does not hold it. A complaint with the signed receipt was posted to the relays: the auditors will see it.` :
          b.state === 'rejected' ? esc(b.reason ?? '') : esc(b.detail ?? '');
        booth += `<div class="verdict ${ok ? 'ok' : 'ko'} receipt">
          ${ok ? `<svg viewBox="0 0 52 52" class="seal" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>` : ''}
          <h2>${title}</h2><p>${text}</p>
          <dl class="kv">
          ${at ? `<dt>Pseudonym</dt><dd><code>${esc(at.nullifier)}</code><br><span class="muted">The name your ballot carries in the log. Nothing in the log links it to you.</span></dd>
          <dt>Where</dt><dd>Entry ${at.seq} of the log, in snapshot ${at.checkpoint}: <a href="${esc(mirrorPage(`entries/${at.checkpoint}.json`))}">the entries of snapshot ${at.checkpoint}</a> hold it under that pseudonym, and <a href="${esc(mirrorPage(`checkpoints/${at.checkpoint}.txt`))}">the snapshot's head</a> carries the ledger's signature over them.</dd>` :
          cp != null ? `<dt>Where</dt><dd>Snapshot ${cp} of the log${b.state === 'verified' ? ' · locating the entry…' : ''}</dd>` : ''}
          <dt>Ballot hash</dt><dd><code>${esc(b.hash ?? '')}</code><br><span class="muted">This browser's own fingerprint of the ballot, the one it looks for in the log.</span></dd></dl>
          ${b.kept ? `<div class="row"><button class="btn" id="resend">No receipt arrived: post again</button></div>` : ''}
          <p class="muted">Keep this device or your recovery code: after the close your ballot is readable in the log under its pseudonym.</p></div>`;
      }
    }

    // The booth: one box, a status, the steps, the recovery code on demand.
    const done = s.ballot.state === 'acked' || s.ballot.state === 'verified' || s.ballot.state === 'missing';
    const step = s.phase === 'loading' ? 0 :
      done ? 5 :
      (s.phase === 'ready' || s.phase === 'joining') ? 4 :
      (pending?.kind === 'words' || pending?.kind === 'confirm' || (s.key && !s.key.backedUp)) ? 2 :
      s.key ? 3 : 1;
    const steps = ['Passport', 'Recovery code', 'Registration', 'Ballot'];
    const wordsNow = s.key?.hasWords ? session.words() : null;
    body += '<!--result-->';
    body += `<section class="booth">
      <div class="booth-head"><span class="booth-title">Voting booth</span>
        ${wordsNow ? `<button class="btn secondary small" id="showwords">${showWords ? 'Hide the recovery code' : 'My recovery code'}</button>` : ''}</div>
      <ol class="bsteps">${steps.map((n, i) => `<li class="${i + 1 < step ? 'done' : i + 1 === step ? 'now' : ''}"><span>${i + 1 < step ? '✓' : i + 1}</span>${n}</li>`).join('')}</ol>
      ${showWords && wordsNow ? `<div class="wordsbox"><p><strong>Your recovery code.</strong> These 12 words restore your key on another device. Anyone who has them can vote in your place and see which ballots are yours. Keep them private.</p>
        <ol class="words">${wordsNow.split(' ').map((w) => `<li>${esc(w)}</li>`).join('')}</ol></div>` : ''}
      ${booth}</section>`;

    // The result, first: the headline of a closed poll.
    const t = s.tally ?? s.tallyUnverified?.verdict ?? null;
    let result = '';
    if (t && t.results.type === 'choice' && s.poll) {
      const r = t.results;
      const max = Math.max(1, ...r.slots.map((x) => x.count));
      const pct = (n: number) => (r.counted ? Math.round((1000 * n) / r.counted) / 10 : 0);
      const top = r.slots.filter((x) => !x.blank).reduce((best, x) => (x.count > (best?.count ?? -1) ? x : best), null as typeof r.slots[number] | null);
      result = `<section class="result-hero">
        <p class="rtag">${t.tally.final ? 'Final result' : 'Provisional result'}</p>
        ${top && r.counted ? `<p class="headline"><span class="big">${pct(top.count)}%</span> ${esc(top.label ?? '')}</p>` : ''}
        <div class="slots">${r.slots.map((x) => `<div class="slot${x.blank ? ' blank' : ''}"><div class="line"><span class="label">${esc(x.label ?? (x.blank ? 'Blank' : `slot ${x.slot}`))}</span><span class="n">${x.count} · ${pct(x.count)}%</span></div><div class="bar"><span style="width:${(100 * x.count) / max}%"></span></div></div>`).join('')}</div>
        <p class="muted">${r.counted} ${r.counted === 1 ? 'person' : 'persons'} voted${t.tally.void?.length ? `, ${t.tally.void.length} void ballot${t.tally.void.length === 1 ? '' : 's'}` : ''}. One passport, one voice; the poll closed ${when(s.poll.closes)}. ${t.checked === 'beacon' ? (t.beacon_ok ? 'The drand beacon that opened the ballots verified in this browser.' : 'The beacon did not verify.') : ''}</p>
        <p class="center"><a class="btn" href="#audit">Audit the vote in this browser</a></p></section>`;
    } else if (s.pollStatus === 'closed' && s.poll) {
      result = `<section class="result-hero wait"><p class="rtag">Closed</p><p class="muted">The poll closed ${when(s.poll.closes)}. The result appears here once the drand round is published and the ballots opened.</p></section>`;
    }
    body = body.replace('<!--result-->', result);

    // A state event re-renders the page: keep what the voter typed or picked.
    const typed = new Map<string, string>();
    app.querySelectorAll<HTMLInputElement>('input[data-pos]').forEach((i) => typed.set(i.dataset.pos!, i.value));
    const picked = app.querySelector<HTMLInputElement>('input[name=pick]:checked')?.value ?? null;
    h(body);
    app.querySelectorAll<HTMLInputElement>('input[data-pos]').forEach((i) => { const v = typed.get(i.dataset.pos!); if (v) i.value = v; });
    if (picked !== null) { const r = app.querySelector<HTMLInputElement>(`input[name=pick][value="${picked}"]`); if (r) r.checked = true; }
    if (pending?.kind === 'scan' && pending.url) {
      QRCode.toCanvas(document.getElementById('qr') as HTMLCanvasElement, pending.url, { width: 260, margin: 1 }).catch(() => {});
    }
    wire();
  };

  const run = async (f: () => Promise<void>) => {
    busy = true; lastError = null; render();
    try { await f(); } catch (e) { lastError = e; console.error(e); }
    busy = false; render();
  };

  const scanUi = {
    showRequest: (url: string) => { pending = { kind: 'scan', url, text: 'Scan the code with the ZKPassport app.' }; render(); },
    status: (text: string) => { if (pending?.kind === 'scan') { pending.text = text; render(); } }
  };
  const obtainProof = config.dev
    ? devScan(async () => window.prompt('Trial registry (dev provider): type any identifier, e.g. alice') ?? '')
    : zkpassportScan(config.zkpassport, scanUi);

  const wire = () => {
    document.getElementById('scan')?.addEventListener('click', () => run(async () => {
      void session.startWork().catch(() => {});
      if (!session.scanReady()) {
        if (!config.dev) pending = { kind: 'scan', text: 'Opening the request…' };
        await session.scanPassport((req) => obtainProof(req, session));
      }
      const k = session.state().key;
      if (!k) {
        pending = { kind: 'words', words: session.createKeyFromWords() };
      } else if (!k.backedUp && session.words()) {
        // A key from before a refresh, never confirmed: show its words again.
        pending = { kind: 'words', words: session.words()! };
      } else if (session.state().registration.state === 'failed' && !session.state().registration.stale) {
        pending = null;
        await session.resendRegistration();
      } else {
        pending = null;
        await session.submitRegistration();
      }
    }));
    document.getElementById('words')?.addEventListener('click', () => {
      const w = session.words();
      if (!w) return;
      pending = { kind: 'words', words: w }; lastError = null; render();
    });
    document.getElementById('showwords')?.addEventListener('click', () => { showWords = !showWords; render(); });
    document.getElementById('forget')?.addEventListener('click', () => {
      if (!window.confirm('Forget this key and start over? If it was registered, that registration stays in the log and this passport cannot register again.')) return;
      pending = null; lastError = null; session.forgetKey(); render();
    });
    document.getElementById('wrote')?.addEventListener('click', () => {
      const words = session.words()!;
      pending = { kind: 'confirm', words, positions: session.wordChallenge() };
      render();
    });
    document.getElementById('confirm')?.addEventListener('click', () => run(async () => {
      if (pending?.kind !== 'confirm') return;
      const positions = pending.positions;
      const answers = positions.map((p) => (document.querySelector(`input[data-pos="${p}"]`) as HTMLInputElement).value);
      const c = session.confirmWords(positions, answers);
      if (!c.ok) throw new IsoloirError('bad_words', `positions ${c.wrong.join(', ')} do not match`);
      pending = null;
      if (!session.scanReady()) {
        if (!config.dev) pending = { kind: 'scan', text: 'Opening the request…' };
        await session.scanPassport((req) => obtainProof(req, session));
        pending = null;
      }
      await session.submitRegistration();
    }));
    document.getElementById('skip')?.addEventListener('click', () => run(async () => {
      if (!window.confirm('Register without confirming the words? You will be able to vote from this browser only, in this poll and the next ones, and a cleared browser loses the key.')) return;
      pending = null;
      session.declineBackup();
      if (!session.scanReady()) {
        if (!config.dev) pending = { kind: 'scan', text: 'Opening the request…' };
        await session.scanPassport((req) => obtainProof(req, session));
        pending = null;
      }
      await session.submitRegistration();
    }));
    document.getElementById('restore')?.addEventListener('click', () => run(async () => {
      const words = window.prompt('Your 12 words, separated by spaces:');
      if (!words) return;
      await session.restoreFromWords(words);
    }));
    document.getElementById('ballot')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = (new FormData(ev.target as HTMLFormElement).get('pick') as string | null);
      if (v === null) return;
      const choice: Choice = { pick: Number(v) };
      run(async () => {
        // A ballot proven before and never acknowledged waits on this device: the same choice is sent again, another one replaces it.
        const b = session.state().ballot;
        if (b.kept) {
          if (b.choice && 'pick' in b.choice && b.choice.pick === choice.pick) { await session.resendBallot(); return; }
          session.discardKeptBallot();
        }
        await session.cast(choice);
      });
    });
    document.getElementById('resend')?.addEventListener('click', () => run(() => session.resendBallot()));
  };

  session.subscribe(() => render());
  await session.init();
  render();
  if (session.state().poll) prover.warm(session.state().poll!.circuit.name).catch(() => {});
}

main().catch((e) => { h(`<h1>Vote</h1>${errorBox(e)}<p class="muted">Reload the page; if it persists, the mirror or the relays may be unreachable from your network.</p>`); console.error(e); });
