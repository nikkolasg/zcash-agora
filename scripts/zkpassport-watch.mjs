#!/usr/bin/env node
// zkpassport-watch.mjs tells, before a voter finds out, that the ZKPassport
// app has moved ahead of the verifier the ingest runs.
//
// What happened on 20 November 2026 (issue #1): the app started making proofs
// of circuit version 0.23.0; the ingest's verifier (isoloir/zkverifier, then on
// @zkpassport/sdk 0.18.2) refused them at the face match, and a voter whose
// passport the app had accepted got `reg:bad_proof`. The SDK that verifies
// them (0.21.0) had been on npm for four days.
//
// The checks, from public data only (npm, ZKPassport's circuit registry on
// Ethereum, the ledger's mirror):
//
//   1. every registration on the log still verifies with the pinned SDK
//      (the same verify.mjs the ingest runs);
//   2. the pinned SDK is npm's latest. A release comes out before the app
//      uses its circuits (0.21.0 came 40 minutes before the registry moved
//      to 0.23.0), so this is the early signal;
//   3. when it is not, every registration on the log is replayed with the
//      latest SDK, to say whether moving the pin is safe;
//   4. the circuit version the registry names (what the app proves with now)
//      is one a logged registration was verified with. Until one is, that
//      version is unproven here.
//
//   node scripts/zkpassport-watch.mjs --mirror /path/to/mirror-clone [--report out.md]
//
// It needs `npm ci` done in isoloir/zkverifier. Exit 0: nothing to do. Exit 1:
// something to do (the report says what). Exit 3: a check could not run (npm,
// the registry or the mirror unreachable): not an alarm, run it again.
//
// The binding of each replayed proof is read from the proof itself: this
// checks that the verifier and the proofs agree, not who registered (the
// ingest and the audit check that, with the key).

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZKV = join(ROOT, 'isoloir', 'zkverifier');

function arg(name) {
	const i = process.argv.indexOf(name);
	return i < 0 ? undefined : process.argv[i + 1];
}

class Unreachable extends Error {}

/** -1, 0, 1 on the numeric parts; a pre-release is below its release. */
function cmp(a, b) {
	const [na, pa] = a.split('-'), [nb, pb] = b.split('-');
	const xa = na.split('.').map(Number), xb = nb.split('.').map(Number);
	for (let i = 0; i < 3; i++) if ((xa[i] ?? 0) !== (xb[i] ?? 0)) return (xa[i] ?? 0) < (xb[i] ?? 0) ? -1 : 1;
	return pa && !pb ? -1 : !pa && pb ? 1 : 0;
}

async function npmLatest() {
	try {
		const r = await fetch('https://registry.npmjs.org/@zkpassport/sdk/latest', { signal: AbortSignal.timeout(30_000) });
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		return (await r.json()).version;
	} catch (e) {
		throw new Unreachable(`npm: ${e.message}`);
	}
}

/** The version of the circuit manifest ZKPassport's registry names as the latest: what the app proves with. */
async function circuitsNow() {
	try {
		const { RegistryClient } = createRequire(join(ZKV, 'x'))('@zkpassport/registry');
		const m = await new RegistryClient({ chainId: 1 }).getCircuitManifest();
		if (!m?.version) throw new Error('the manifest names no version');
		return m.version;
	} catch (e) {
		throw new Unreachable(`circuit registry: ${e.message}`);
	}
}

/** Every registration of the mirror, with the eligibility of its registry. */
function registrations(mirror) {
	const dir = join(mirror, 'entries');
	if (!existsSync(dir)) throw new Unreachable(`no entries/ in ${mirror}`);
	const eligibility = new Map();
	const of = (id) => {
		if (!eligibility.has(id)) {
			const setups = JSON.parse(readFileSync(join(mirror, 'registries', `${id}.json`), 'utf8')).setups;
			const body = setups[setups.length - 1].body;
			eligibility.set(id, (typeof body === 'string' ? JSON.parse(body) : body).eligibility);
		}
		return eligibility.get(id);
	};
	const out = [];
	for (const f of readdirSync(dir).sort((a, b) => parseInt(a) - parseInt(b))) {
		const text = readFileSync(join(dir, f), 'utf8');
		if (!text.includes('register')) continue;
		for (const e of JSON.parse(text)) {
			if (e.kind !== 'register') continue;
			const b = typeof e.body === 'string' ? JSON.parse(e.body) : e.body;
			const el = of(b.registry);
			if (el.provider !== 'zkpassport') continue;
			out.push({ checkpoint: parseInt(f), seq: e.seq, body: b, eligibility: el });
		}
	}
	return out;
}

/** One registration through verify.mjs in `dir`, as the ingest asks (crates/server/src/eligibility.rs). */
function verify(dir, reg) {
	const { body: b, eligibility: el } = reg;
	const req = {
		proofs: b.proof.proofs,
		result: b.proof.result,
		challenge: b.proof.proofs?.[0]?.committedInputs?.bind?.data?.custom_data,
		domain: el.domain,
		scope: el.scope,
		minAge: el.min_age,
		nationality: el.nationality,
		documentType: el.document_type,
		requireExpiry: el.require_expiry,
		oprfKey: el.oprf_key,
		proofDate: b.proof_date * 1000
	};
	const r = spawnSync(process.execPath, [join(dir, 'verify.mjs')], { input: JSON.stringify(req), encoding: 'utf8', timeout: 180_000, maxBuffer: 1 << 26 });
	let ans;
	try {
		ans = JSON.parse(r.stdout.trim().split('\n').pop());
	} catch {
		throw new Unreachable(`verify.mjs gave no answer: ${(r.stderr || r.error?.message || '').slice(0, 300)}`);
	}
	if (ans.infrastructure) throw new Unreachable(`verify.mjs: ${JSON.stringify(ans.errors).slice(0, 300)}`);
	const ok = ans.verified === true && ans.uniqueIdentifier === b.uid;
	return { ok, why: ok ? '' : JSON.stringify(ans.errors ?? `identifier ${ans.uniqueIdentifier} is not the logged one`).slice(0, 400) };
}

/** A copy of the verifier with another SDK version, installed in a temporary folder. */
function verifierWith(version) {
	const dir = mkdtempSync(join(tmpdir(), 'zkverifier-'));
	cpSync(join(ZKV, 'verify.mjs'), join(dir, 'verify.mjs'));
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'zkverifier-candidate', private: true, type: 'module' }));
	const r = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', `@zkpassport/sdk@${version}`], { cwd: dir, encoding: 'utf8', timeout: 600_000 });
	if (r.status !== 0) throw new Unreachable(`npm install @zkpassport/sdk@${version}: ${(r.stderr || '').slice(-300)}`);
	return dir;
}

const versionOf = (reg) => [...new Set((reg.body.proof.proofs ?? []).map((p) => p.version).filter(Boolean))].join('+') || '?';

async function main() {
	const mirror = arg('--mirror');
	if (!mirror) throw new Error('usage: zkpassport-watch.mjs --mirror <a clone of the mirror> [--report <file.md>]');
	if (!existsSync(join(ZKV, 'node_modules', '@zkpassport', 'sdk'))) throw new Error('run `npm ci` in isoloir/zkverifier first');

	const pinned = JSON.parse(readFileSync(join(ZKV, 'package.json'), 'utf8')).dependencies['@zkpassport/sdk'];
	const page = JSON.parse(readFileSync(join(ROOT, 'site', 'app', 'package.json'), 'utf8')).dependencies['@zkpassport/sdk'];
	const [latest, circuits] = await Promise.all([npmLatest(), circuitsNow()]);
	const regs = registrations(mirror);

	const todo = [];
	const notes = [];

	// 1. The log, with the verifier as pinned.
	const proven = new Set();
	const broken = [];
	for (const r of regs) {
		const v = verify(ZKV, r);
		if (v.ok) proven.add(versionOf(r));
		else broken.push(`checkpoint ${r.checkpoint}, seq ${r.seq} (proof ${versionOf(r)}): ${v.why}`);
	}
	if (broken.length) todo.push(`**${broken.length} logged registration(s) no longer verify with the pinned SDK ${pinned}.** The audit and the authority will stop on them.\n${broken.map((b) => `  - ${b}`).join('\n')}`);

	// 2 and 3. The pin against npm.
	const behind = cmp(pinned, latest) < 0;
	const unproven = !proven.has(circuits);
	if (behind) {
		const dir = verifierWith(latest);
		const bad = regs.map((r) => ({ r, v: verify(dir, r) })).filter((x) => !x.v.ok);
		const safe = bad.length === 0;
		todo.push(
			`**@zkpassport/sdk ${latest} is out; the verifier is pinned at ${pinned}.** ` +
				(unproven
					? `The app now proves with circuits ${circuits}, which no logged registration has been verified with: registrations may be refused right now (\`reg:bad_proof\`).`
					: `The app's circuits (${circuits}) are verified by the pin today; the next ones may not be.`) +
				'\n' +
				(safe
					? `  - ${latest} verifies all ${regs.length} logged registration(s): moving the pin is safe for the log.`
					: `  - ${latest} does **not** verify ${bad.length} logged registration(s): do not move the pin without reading why.\n${bad.map((x) => `    - checkpoint ${x.r.checkpoint}, seq ${x.r.seq} (proof ${versionOf(x.r)}): ${x.v.why}`).join('\n')}`)
		);
	} else if (unproven) {
		// 4. Nothing to move: say it, without an alarm. The first registration of that version settles it.
		notes.push(`The app proves with circuits ${circuits}; no logged registration has that version yet, so it is unproven here. The pin is npm's latest: there is nothing to move. If a voter reports \`reg:bad_proof\`, the ingest's log has the reason ("passport proof refused").`);
	}

	const lines = [
		`| | |`,
		`|---|---|`,
		`| verifier's SDK (isoloir/zkverifier) | ${pinned} |`,
		`| npm's latest SDK | ${latest} |`,
		`| vote page's SDK (site/app, reads the identifier through ZKPassport's API) | ${page} |`,
		`| circuits the app proves with (ZKPassport's registry) | ${circuits} |`,
		`| circuit versions verified on the log | ${[...proven].sort(cmp).join(', ') || 'none'} (${regs.length} registration(s)) |`,
		''
	];
	if (todo.length) {
		lines.push('## To do', '', ...todo.map((t) => `- ${t}`), '', 'How: `deploy/README.md`, "When ZKPassport moves".', '');
	} else {
		lines.push('Nothing to do.', '');
	}
	if (notes.length) lines.push(...notes.map((n) => `Note: ${n}`), '');
	const report = lines.join('\n');
	console.log(report);
	if (arg('--report')) writeFileSync(arg('--report'), report);
	process.exit(todo.length ? 1 : 0);
}

main().catch((e) => {
	console.error(e instanceof Unreachable ? `could not check: ${e.message}` : e);
	process.exit(e instanceof Unreachable ? 3 : 2);
});
