// The voting page: a plain renderer over @isoloir/web's Session. No framework.
import {
  Session, loadWasm, WorkerProver, jsDelivrSource, dirSource,
  IsoloirError, type SessionState, type MirrorSource, type Choice
} from '@isoloir/web';
import QRCode from 'qrcode';
import { config } from './config.js';
import { zkpassportScan, devScan } from './zkpassport.js';
import { mountAudit } from './audit.js';
import { ELECTION, QUESTIONS } from './questions.js';

/** Several polls: the page is one ballot, a question per poll. */
const multi = config.polls.length > 1;
const ANSWERS = ['Support', 'Oppose', 'Abstain'];

const app = document.getElementById('app')!;
const h = (html: string) => { app.innerHTML = html; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const when = (t: number) => new Date(t * 1000).toUTCString().replace(/ GMT$/, ' UTC');

/** The mirror's base URL for files that never change once written (a circuit's artifact): a CDN may keep them. */
function mirrorBase(): string {
  const m = config.mirror;
  return 'url' in m ? m.url : `https://cdn.jsdelivr.net/gh/${m.repo}@${m.branch}`;
}
/**
 * The mirror's base URL for the files that change (the head, the entries of a
 * recent checkpoint). jsDelivr keeps a branch's files for 12 hours and ignores
 * query strings, so a head read through it is hours old; GitHub's raw host
 * keeps them 5 minutes and answers with CORS.
 */
function mirrorHead(): string {
  const m = config.mirror;
  return 'url' in m ? m.url : `https://raw.githubusercontent.com/${m.repo}/${m.branch}`;
}
/** A mirror file as a page a person can open (GitHub for the repository mirror). */
function mirrorPage(path: string): string {
  const m = config.mirror;
  return 'url' in m ? `${m.url}/${path}` : `https://github.com/${m.repo}/blob/${m.branch}/${path}`;
}

function mirrorSources(): MirrorSource[] | string {
  const m = config.mirror;
  // The head files from GitHub raw (minutes old at worst), a file at a commit from jsDelivr (immutable, cached for good).
  return 'url' in m ? m.url : [dirSource(`https://raw.githubusercontent.com/${m.repo}/${m.branch}`), jsDelivrSource(m.repo, m.branch)];
}

function header(s: SessionState): string {
  const cp = s.checkpoint ? ` · log checkpoint ${s.checkpoint.index}` : '';
  if (multi) {
    const open = Date.now() / 1000 < config.closes;
    return `<h1>${esc(ELECTION.title)}</h1><p class="muted">${open ? 'open until' : 'closed'} ${when(config.closes)}${cp}</p>
    <div class="card warn"><strong>A count of people, beside the count of coins.</strong> These are the five questions of the Zcash coinholder poll of 16 to 30 November 2026, word for word. Here every person has one vote, whatever they hold. This poll is unofficial and decides nothing. The number of voters stays hidden until the close. <a href="../why/">Why</a>.</div>`;
  }
  const p = s.poll;
  const title = p ? esc(p.title) : config.name;
  const status = s.pollStatus === 'open' ? `open until ${when(p!.closes)}` :
    s.pollStatus === 'upcoming' ? `opens ${when(p!.opens)}` :
    s.pollStatus === 'closed' ? `closed ${when(p!.closes)}` : '';
  return `<h1>${title}</h1><p class="muted">${status}${cp}</p>`;
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
    stale_mirror: 'The log mirror is more than 30 minutes old; the ledger may be paused. Try again in a few minutes.',
    no_path: 'Your registration is in the log but not yet in a published snapshot of it. Wait a minute and cast again.',
    cast_retries: 'The ballot could not be sealed against the current snapshot after several tries. Reload the page and cast again.'
  };
  return `<p class="err"><strong>${esc(code)}</strong>: ${esc(hints[code] ?? detail)}</p>`;
}

async function main() {
  if (!config.verifierKey) return notOpenYet();
  h(`<h1>Vote</h1><p class="muted">Loading the voting booth…</p>`);

  const wasm = await loadWasm();
  let pollClosed = false;
  const renderAudit = mountAudit(document.getElementById('audit-root')!, wasm, true, () => pollClosed);
  const closedNow = () => Date.now() / 1000 >= config.closes;
  const prover = new WorkerProver(
    () => new Worker(new URL('@isoloir/web/prove.worker', import.meta.url), { type: 'module' }) as unknown as import('@isoloir/web').WorkerLike,
    async (circuit) => {
      const r = await fetch(`${mirrorBase()}/circuits/${circuit}/artifact.json`);
      if (!r.ok) throw new Error(`circuit ${circuit}: ${r.status}`);
      return r.text();
    }
  );
  // A proof that does not come back is reported, not waited for: the worker's
  // setup caches a pending promise (an SRS download that stalls, a worker that
  // died without an error event), so a cast could sit on "Proving…" with
  // nothing to see. Past the limit the worker is dropped; the next cast starts
  // a fresh one. Each step is logged for the browser console.
  const PROVE_LIMIT_MS = 3 * 60_000;
  const guarded: import('@isoloir/web').Prover = {
    warm: (circuit) => prover.warm(circuit),
    prove: (circuit, inputs) => {
      const t0 = performance.now();
      console.info(`isoloir: proving ${circuit}…`);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          prover.terminate();
          reject(new Error(`the proof did not finish in ${PROVE_LIMIT_MS / 60_000} minutes (the prover's files may not have downloaded). Reload the page and cast again.`));
        }, PROVE_LIMIT_MS);
      });
      return Promise.race([prover.prove(circuit, inputs), limit]).then(
        (r) => { clearTimeout(timer); console.info(`isoloir: proof done in ${Math.round(performance.now() - t0)} ms`); return r; },
        (e) => { clearTimeout(timer); console.warn('isoloir: proof failed', e); throw e; }
      );
    }
  };
  const sessionFor = (poll: number) => new Session({
    core: wasm,
    origin: config.origin,
    verifierKey: config.verifierKey,
    registry: config.registry,
    poll,
    mirror: mirrorSources(),
    prover: guarded,
    wordsLang: 'en',
    passkey: { rpName: config.name } as never
  });
  // The page's session: the key and the registration, on the first poll. With several polls each question
  // has a session of its own, opened to read its state or to cast its ballot, then closed; this one casts nothing.
  const session = sessionFor(config.polls[0]);

  type Info = { ballot: SessionState['ballot']; tally: SessionState['tally']; unverified: SessionState['tallyUnverified'] };
  const info: Record<number, Info> = {};
  const answers: Record<number, number> = {};
  let casting: number | null = null;
  /** The whole ballot is being cast (every answer, one after the other): the page shows one box for it. */
  let castingAll = false;
  /** The question the ballot shows, among those not cast yet. */
  let step = 0;
  /** What this device remembers of a ballot cast in full: the receipt shows at once, before the log is read again. */
  const CAST_KEY = `agora:cast:${config.polls.join(',')}`;
  let remembered: { picks: Record<number, number>; inLog: boolean } | null = null;
  try { remembered = JSON.parse(localStorage.getItem(CAST_KEY) ?? 'null'); } catch { /* no storage: the log is read as before */ }
  const remember = () => {
    const picks: Record<number, number> = {};
    for (const id of config.polls) {
      const c = info[id]?.ballot.choice;
      if (!isCast(id) || !c || !('pick' in c) || c.pick == null) { remembered = null; try { localStorage.removeItem(CAST_KEY); } catch { /* */ } return; }
      picks[id] = c.pick;
    }
    remembered = { picks, inLog: config.polls.every((id) => info[id]?.ballot.state === 'verified') };
    try { localStorage.setItem(CAST_KEY, JSON.stringify(remembered)); } catch { /* */ }
  };
  let swept = false;
  let sweeping = false;
  let sweepTimer: ReturnType<typeof setTimeout> | null = null;
  const take = (id: number, t: Session) => { const st = t.state(); info[id] = { ballot: st.ballot, tally: st.tally, unverified: st.tallyUnverified }; };
  const isCast = (id: number) => { const st = info[id]?.ballot.state; return st === 'acked' || st === 'verified'; };
  const isStuck = (id: number) => { const st = info[id]?.ballot.state; return st === 'missing' || st === 'rejected'; };
  /** Reads every question's state (this device's ballot, the result after the close), one after the other. */
  let sweepRun: Promise<void> | null = null;
  const sweep = (): Promise<void> => {
    if (sweeping || casting !== null) return sweepRun ?? Promise.resolve();
    sweeping = true;
    // Every question at once: each read is a handful of small files, most of them shared.
    sweepRun = Promise.all(config.polls.map(async (id) => {
      const t = sessionFor(id);
      try { await t.init(); take(id, t); } catch (e) { console.warn(`isoloir: reading poll ${id}`, e); } finally { t.destroy(); }
      render();
    })).then(() => {
      swept = true; sweeping = false; remember(); render();
      // A ballot the ledger accepted is looked for in the log until found; the result is looked for after the close.
      const again = config.polls.some((id) => info[id]?.ballot.state === 'acked') || (closedNow() && config.polls.some((id) => !info[id]?.tally));
      if (again && !sweepTimer) sweepTimer = setTimeout(() => { sweepTimer = null; void sweep(); }, 60_000);
    });
    return sweepRun;
  };
  /** Casts the answers not cast yet, one ballot per question, in order. */
  const castAll = async () => {
    // The form shows before the questions' states are read: wait for them, an answer already in the log is not cast again.
    if (sweepRun) await sweepRun;
    castingAll = true; render();
    try {
    for (const id of config.polls) {
      if (isCast(id) || isStuck(id) || answers[id] === undefined) continue;
      casting = id; render();
      const t = sessionFor(id);
      const off = t.subscribe(() => { take(id, t); render(); });
      try {
        await t.init();
        const b = t.state().ballot;
        if (b.state !== 'acked' && b.state !== 'verified') {
          const choice: Choice = { pick: answers[id] };
          // A ballot proven before and never acknowledged waits on this device: the same answer is sent again, another replaces it.
          if (b.kept && b.choice && 'pick' in b.choice && b.choice.pick === choice.pick) await t.resendBallot();
          else { if (b.kept) t.discardKeptBallot(); await t.cast(choice); }
        }
        take(id, t);
      } finally { off(); t.destroy(); casting = null; }
    }
    } finally { castingAll = false; }
    void sweep();
  };
  const resultHtml = (t: NonNullable<SessionState['tally']>, title: string | null, count = true): string => {
    if (t.results.type !== 'choice') return '';
    const r = t.results;
    const max = Math.max(1, ...r.slots.map((x) => x.count));
    const pct = (n: number) => (r.counted ? Math.round((1000 * n) / r.counted) / 10 : 0);
    return `${title ? `<h3>${esc(title)}</h3>` : ''}
      <div class="slots">${r.slots.map((x) => `<div class="slot${x.blank ? ' blank' : ''}"><div class="line"><span class="label">${esc(x.label ?? (x.blank ? 'Blank' : `slot ${x.slot}`))}</span><span class="n">${x.count} · ${pct(x.count)}%</span></div><div class="bar"><span style="width:${(100 * x.count) / max}%"></span></div></div>`).join('')}</div>
      ${count ? `<p class="muted">${r.counted} ${r.counted === 1 ? 'person' : 'persons'} voted${t.tally.void?.length ? `, ${t.tally.void.length} void ballot${t.tally.void.length === 1 ? '' : 's'}` : ''}.</p>` : ''}`;
  };
  /** The ballot of a several-poll page: every question, one submit. */
  const ballotForm = (s: SessionState): string => {
    const open = !closedNow();
    const left = config.polls.filter((id) => !isCast(id) && !isStuck(id));
    const answer = (id: number) => { const c = info[id]?.ballot.choice; return c && 'pick' in c ? ANSWERS[c.pick ?? -1] ?? '' : ANSWERS[answers[id]] ?? ''; };
    // Casting: one box for the whole ballot, whatever happens underneath.
    if (castingAll) {
      const total = config.polls.length;
      const sent = config.polls.filter((id) => isCast(id)).length;
      const st = casting !== null ? info[casting]?.ballot.state : undefined;
      const step = sent === total ? 'Checking the receipts…' :
        st === 'posting' || st === 'sent' ? 'Sending your sealed ballot and waiting for the ledger\'s receipt…' :
        'Proving, in zero knowledge, that you are registered, and sealing your answers…';
      return `<div class="phase"><h2>Casting your ballot…</h2><p class="qbusy"><span class="spin"></span> ${step}</p>
        <div class="progress"><span style="width:${Math.max(6, Math.round((100 * (sent + (st === 'posting' || st === 'sent' ? 0.6 : 0.25))) / total))}%"></span></div>
        <p class="muted">Keep this page open. It takes a few seconds, up to a minute on a slow connection.</p></div>`;
    }
    // Cast: one receipt for the whole ballot.
    const known = open && !swept && remembered !== null && s.phase === 'ready';
    if (known || (swept && left.length === 0)) {
      const inLog = known ? remembered!.inLog : config.polls.every((id) => info[id]?.ballot.state === 'verified' || isStuck(id));
      return `<div class="verdict ok receipt"><svg viewBox="0 0 52 52" class="seal" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>
        <h2>${inLog ? 'Your ballot is in the public log' : 'The ledger accepted your ballot'}</h2>
        <p>${inLog ? 'This browser read the log from the mirror and found your answers in it.' : 'It signed a receipt for it. Your answers appear in the next published snapshot of the log; this page checks that by itself.'} They stay sealed until the close, ${when(config.closes)}, under a pseudonym nothing links to you. The results appear here then.</p>
        <ol class="answers">${config.polls.map((id) => `<li><span>${esc(QUESTIONS[id]?.title ?? `Poll ${id}`)}</span><strong>${known ? esc(ANSWERS[remembered!.picks[id]] ?? '') : isStuck(id) ? 'not counted' : esc(answer(id))}</strong></li>`).join('')}</ol>
        <p class="muted">Your answers are shown from this device's memory; nobody else can read them before the close. Keep this device or your recovery code.</p></div>`;
    }
    // The poll closed on an unfinished ballot, or the ledger refused part of it: what became of each question.
    const stuck = config.polls.filter((id) => isStuck(id));
    const fate = (id: number): string => {
      const b = info[id]?.ballot;
      if (isCast(id)) return esc(answer(id));
      if (b?.state === 'missing') return 'receipt signed, never published (complaint posted)';
      if (b?.state === 'rejected') return `refused: ${esc(b.reason ?? '')}`;
      return 'not answered';
    };
    const list = `<ol class="answers">${config.polls.map((id) => `<li><span>${esc(QUESTIONS[id]?.title ?? `Poll ${id}`)}</span><strong>${fate(id)}</strong></li>`).join('')}</ol>`;
    if (!open || left.length === 0) return `<div class="phase"><h2>Your ballot</h2>${list}<p class="muted">${open ? '' : 'The poll is closed.'}</p></div>`;
    // One question at a time: Next until the last one, then Vote.
    step = Math.max(0, Math.min(step, left.length - 1));
    const id = left[step];
    const q = QUESTIONS[id];
    const last = step === left.length - 1;
    const partial = swept && left.length + stuck.length < config.polls.length && !busy
      ? `<p class="err"><strong>Your ballot is not complete.</strong> ${left.length} of your ${config.polls.length} answers did not go through. Answer the remaining ones: a ballot counts in full.</p>` : '';
    const problems = stuck.length ? `<p class="err">${stuck.length === 1 ? 'One answer' : `${stuck.length} answers`} could not be counted.</p>${list}` : '';
    return `<div class="phase"><h2>Your ballot</h2><p>${esc(ELECTION.instructions)}</p>${partial}${problems}<form id="ballots" data-poll="${id}" data-last="${last ? 1 : 0}">
      <fieldset class="q"><legend><span class="qn">${config.polls.indexOf(id) + 1}</span>${esc(q?.title ?? `Poll ${id}`)}</legend>
        <div class="progress steps"><span style="width:${Math.round((100 * (step + 1)) / left.length)}%"></span></div>
        <p class="qstep">Question ${step + 1} of ${left.length}</p>
        ${q?.summary ? `<p class="qsum">${esc(q.summary)}</p>` : ''}${q?.link ? `<p class="qlink"><a href="${q.link}" target="_blank" rel="noopener">Read the proposal and its discussion</a></p>` : ''}
        <div class="options inline">${ANSWERS.map((a, i) => `<label><input type="radio" name="pick-${id}" value="${i}" required ${answers[id] === i ? 'checked' : ''} ${busy ? 'disabled' : ''}>${a}</label>`).join('')}</div>
        <div class="row qnav">${step > 0 ? `<button class="btn secondary" type="button" id="qback" ${busy ? 'disabled' : ''}>Back</button>` : ''}<button class="btn" type="submit" ${busy ? 'disabled' : ''}>${last ? 'Vote' : 'Next'}</button></div>
      </fieldset>
      ${last ? `<p class="muted">Vote seals your ${left.length === 1 ? 'answer' : `${left.length} answers`} and casts them. No changes after that. Sealed until ${when(config.closes)} with the drand beacon; then public under your anonymous pseudonym.</p>` : ''}
      ${s.storage !== 'persistent' ? `<p class="muted">Storage: ${s.storage} (your key may not survive a browser cleanup; keep the words).</p>` : ''}</form></div>`;
  };

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
        const r = await fetch(`${mirrorHead()}/entries/${i}.json`, { cache: 'no-store' });
        if (!r.ok) break;
        const entries = (await r.json()) as { kind: string; seq: number; body: string }[];
        const mine = entries.find((e) => e.kind === 'ballot' && wasm.body_hash(e.body) === hash);
        if (mine) { place = { hash, checkpoint: i, seq: mine.seq, nullifier: String(JSON.parse(mine.body).nullifier ?? '') }; render(); return; }
      } catch { break; }
    }
  };

  const render = () => {
    const s = session.state();
    const closed = multi ? closedNow() : s.pollStatus === 'closed';
    if (closed !== pollClosed) { pollClosed = closed; renderAudit(); }
    if (multi && !closed && !closeTimer) closeTimer = setTimeout(() => { closeTimer = null; render(); }, Math.max(0, config.closes * 1000 - Date.now()) + 1500);
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
          ${pending.url ? `<div class="qr"><canvas id="qr"></canvas></div>
          <p class="muted"><a href="${esc(pending.url)}">On this phone? Open the request in the ZKPassport app.</a></p>` : '<div class="progress"><span style="width:50%"></span></div>'}</div>`;
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
    if (multi && s.phase === 'joining') booth += `<div class="phase"><h2>Registration confirmed</h2><p class="muted">It is being published in the public log: the ballot appears here by itself in a minute or two, no reload needed.</p></div>`;
    if (multi && s.phase === 'ready') {
      if (!swept && !sweeping) void sweep();
      booth += ballotForm(s);
    }
    if (!multi && (s.phase === 'ready' || s.phase === 'joining')) {
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
    const done = multi ? swept && config.polls.every((id) => isCast(id) || isStuck(id)) : s.ballot.state === 'acked' || s.ballot.state === 'verified' || s.ballot.state === 'missing';
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
    if (multi) {
      if (closedNow()) {
        if (!swept && !sweeping) void sweep();
        const got = config.polls.filter((id) => info[id]?.tally ?? info[id]?.unverified?.verdict);
        const verdict = (id: number) => (info[id].tally ?? info[id].unverified!.verdict)!;
        // One ballot holds every question: the same number of persons answered each. A question with another
        // count (someone stopped before the end, or cast outside this page) shows its own.
        const counts = got.map((id) => { const r = verdict(id).results; return r.type === 'choice' ? r.counted : -1; });
        const same = got.length === config.polls.length && counts.every((c) => c === counts[0]);
        result = got.length
          ? `<section class="result-hero"><p class="rtag">Results</p>${same ? `<p class="headline"><span class="big">${counts[0]}</span> ${counts[0] === 1 ? 'person' : 'persons'} voted</p>` : ''}
            ${got.map((id) => resultHtml(verdict(id), QUESTIONS[id]?.title ?? `Poll ${id}`, !same)).join('')}
            <p class="muted">One passport, one voice; the poll closed ${when(config.closes)}.</p><p class="center"><a class="btn" href="#audit">Audit the vote in this browser</a></p></section>`
          : `<section class="result-hero wait"><p class="rtag">Closed</p><p class="muted">The poll closed ${when(config.closes)}. The results appear here once the drand round is published and the ballots opened.</p></section>`;
      }
    } else if (t && t.results.type === 'choice' && s.poll) {
      const r = t.results;
      const pct = (n: number) => (r.counted ? Math.round((1000 * n) / r.counted) / 10 : 0);
      const top = r.slots.filter((x) => !x.blank).reduce((best, x) => (x.count > (best?.count ?? -1) ? x : best), null as typeof r.slots[number] | null);
      result = `<section class="result-hero">
        <p class="rtag">${t.tally.final ? 'Final result' : 'Provisional result'}</p>
        ${top && r.counted ? `<p class="headline"><span class="big">${pct(top.count)}%</span> ${esc(top.label ?? '')}</p>` : ''}
        ${resultHtml(t, null)}
        <p class="muted">One passport, one voice; the poll closed ${when(s.poll.closes)}. ${t.checked === 'beacon' ? (t.beacon_ok ? 'The drand beacon that opened the ballots verified in this browser.' : 'The beacon did not verify.') : ''}</p>
        <p class="center"><a class="btn" href="#audit">Audit the vote in this browser</a></p></section>`;
    } else if (s.pollStatus === 'closed' && s.poll) {
      result = `<section class="result-hero wait"><p class="rtag">Closed</p><p class="muted">The poll closed ${when(s.poll.closes)}. The result appears here once the drand round is published and the ballots opened.</p></section>`;
    }
    body = body.replace('<!--result-->', result);

    // A state event re-renders the page: keep what the voter typed or picked.
    const typed = new Map<string, string>();
    app.querySelectorAll<HTMLInputElement>('input[data-pos]').forEach((i) => typed.set(i.dataset.pos!, i.value));
    const picked = app.querySelector<HTMLInputElement>('input[name=pick]:checked')?.value ?? null;
    app.querySelectorAll<HTMLInputElement>('input[name^="pick-"]:checked').forEach((i) => { answers[Number(i.name.slice(5))] = Number(i.value); });
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
    status: (text: string) => { if (pending?.kind === 'scan') { pending.text = text; render(); } },
    // The phone has the request: the code goes, the step's text stays.
    codeTaken: () => { if (pending?.kind === 'scan') { pending.url = undefined; render(); } }
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
      pending = null; lastError = null; remembered = null; try { localStorage.removeItem(CAST_KEY); } catch { /* */ } session.forgetKey(); render();
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
    document.getElementById('ballots')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const f = ev.target as HTMLFormElement;
      new FormData(f).forEach((v, k) => { if (k.startsWith('pick-')) answers[Number(k.slice(5))] = Number(v); });
      if (f.dataset.last === '1') { step = 0; run(castAll); } else { step += 1; render(); }
    });
    document.getElementById('qback')?.addEventListener('click', () => { step -= 1; render(); });
  };

  let lastSig = '';
  session.subscribe(() => {
    const s = session.state();
    const sig = `phase ${s.phase} · ballot ${s.ballot?.state ?? '-'} · prover ${s.prover}`;
    if (sig !== lastSig) { lastSig = sig; console.info(`isoloir: ${sig}`); }
    render();
  });
  await session.init();
  render();
  if (multi && closedNow()) void sweep();
  const circuit = multi ? ELECTION.circuit : session.state().poll?.circuit.name;
  if (circuit) prover.warm(circuit).then(() => console.info('isoloir: prover warm'), (e) => console.warn('isoloir: prover warm failed', e));
}

main().catch((e) => { h(`<h1>Vote</h1>${errorBox(e)}<p class="muted">Reload the page; if it persists, the mirror or the relays may be unreachable from your network.</p>`); console.error(e); });
