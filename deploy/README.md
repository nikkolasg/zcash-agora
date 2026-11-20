# Running the Zcash Agora ledger

The order of operations, from nothing to a poll people can vote in. The
protocol and the tools are isoloir's (`../isoloir`, pinned by commit);
this file only says what Zcash Agora fills in. isoloir's own
[OPERATING.md](../isoloir/OPERATING.md) is the reference.

Three roles, three places:

| Role | Where | Holds |
|---|---|---|
| ingest | a server with Postgres (`docker-compose.yml`) | the log key, its Nostr key, a deploy key of the mirror |
| authority | a scheduled job anywhere (an hourly cron on the host), or anyone's machine | nothing: the polls are time-locked to drand, it only opens them after the round |
| operator | any machine with access to the ingest's database | submits the setups in `../ledger` |

Decisions that cannot be changed after genesis: the **origin**
(`zcash-agora`), the **log key**, and for each registry its
**domain and scope** (the passport identifier is derived from them: a
different scope is a different set of identifiers, and people could
register twice). Choose the domain before step 1.

## 0. Before anything: the labels

The site is static (GitHub Pages, `../site`, at the base path
`site/agora.config.json` names). The ledger lists public Nostr relays
only, no direct endpoint: voters never reach the operator's server, so
the ingest needs no public hostname (Caddy serves `/v1/health` only).

Two labels are fixed for ever. The **origin** (`zcash-agora`) names the
log and its key and need not be a hostname. The ZKPassport **domain** in
`../ledger/registries/2.json` (`nikkolasg.github.io`) is hashed, with the
scope, into every passport identifier, and it **must be the hostname of
the page that shows the request**: the bridge tells the app the page's
real origin, and the app accepts the request only if that origin is the
domain, or an origin the domain's owner allowed on ZKPassport's dashboard
(which takes real domains only). Registry 1 used the label `zcash-agora`
and no phone ever accepted its requests; it stays on the log, empty. If
the site moves, a new registry is needed (its identifiers change), or the
old domain's dashboard project must allow the new origin.

## 1. Keys

On the ingest host, with the isoloir binary (`../.github/workflows/release.yml`
builds one per platform; or `cargo build --release -p isoloir` in `../isoloir`):

```sh
isoloir keygen log --origin zcash-agora   # ISOLOIR_LOG_SEED (secret), log_key (public)
isoloir keygen nostr                                  # ISOLOIR_NOSTR_KEY (secret), the ingest's pubkey
isoloir keygen nostr                                  # a second one for the authority
```

Put the secrets in `.env` (from `.env.example`). Put `log_key` and the
ingest's public key in `../ledger/ledger.json`, and `log_key` in
`../site/agora.config.json` (`verifierKey`): the browser pins it and
never reads it from the mirror.

## 2. The mirror repository

Create an empty **public** repository (`nikkolasg/zcash-agora-mirror`),
add a deploy key with write access, and put its private half in
`ISOLOIR_MIRROR_SSH_KEY`. Browsers read it through jsDelivr by commit
(`../site/agora.config.json`, `mirror.repo`). The ingest clones it at
start and pushes after every checkpoint.

## 3. Circuits

On a machine with `nargo` 1.0.0-beta.22 and `bb` 5.0.0 (`ISOLOIR_BB`),
from `../isoloir`:

```sh
isoloir circuits choice4_tlock_linked_d20 --mirror /path/to/mirror-clone
```

It prints `choice4_tlock_linked_d20 0x3314…c229`: the hash in
`../ledger/polls/1.json` must match, or the ingest refuses the poll.
Commit and push `circuits/` to the mirror repository (the ingest keeps
them with the clone). Anyone can rebuild them and compare the hash.

## 4. Genesis and setups

```sh
export DATABASE_URL=postgresql://agora:…@localhost/agora
isoloir check ledger ../ledger/ledger.json
isoloir check registry ../ledger/registries/2.json
isoloir check poll ../ledger/polls/3.json --registry ../ledger/registries/2.json
isoloir genesis ../ledger/ledger.json                 # once per database
docker compose up -d db ingest caddy
isoloir submit registry ../ledger/registries/2.json  # waits until logged
isoloir submit poll ../ledger/polls/3.json
```

The poll's `round` is the drand quicknet round at or after `closes`
(`../ledger/round.sh <closes>`). The ingest checks it.

## 5. DNS and the site

- Enable Pages on the repository with "GitHub Actions" as the source;
  `site.yml` deploys to `<owner>.github.io/<repo>/`. A custom domain is
  a `site/CNAME` file plus `site.base` set to `/` in `agora.config.json`.
- The compose host needs no DNS name for voters; `INGEST_HOST` is for
  the health endpoint only.

## 6. The authority

`docker compose up -d authority`, or on a host with scheduled jobs a
service with a cron schedule running `isoloir authority --once` (it has nothing to do before
a close, and one run after it is enough). It verifies the whole log
(every proof, every passport) before it opens anything, then once
`closes` has passed it fetches the drand beacon of the poll's round,
opens every ballot, and posts the tally. The ingest, by contrast, stays
up: it holds the relay subscriptions and voters wait for its receipt. Any third party can do the same, from
the public mirror, with circuits they built themselves:

```sh
isoloir authority --mirror https://cdn.jsdelivr.net/gh/nikkolasg/zcash-agora-mirror@main \
  --circuits ./my-circuits --zkverifier ../isoloir/zkverifier/verify.mjs \
  --log-key "<log_key>" --nostr-key <a Nostr key> --drand https://api.drand.sh --once
```

The ingest accepts a tally from anyone, after checking every opening
itself (SPEC §10.4); two correct tallies are the same tally.

## 7. Checks

`../scripts/audit.sh` runs isoloir's audit against the public mirror,
the relays and Bitcoin. Run it from a machine the operator does not
control, with circuits you built. The audit prints `PROBLEM` lines and
exits non-zero on anything it could not verify.

## What the operator can and cannot do

The ingest can refuse service (it is one process) and it chooses what
each checkpoint holds. It cannot read a ballot before the drand round
(nobody can), cannot change one (the proof binds the blob), cannot vote
for anyone (no passport, no registration), and cannot drop a message
quietly (every message is acknowledged with a signed receipt, the relays
keep copies, and the audit compares). See isoloir's
[DESIGN.md](../isoloir/DESIGN.md) for the full map.

## 8. CI

Both workflows check out the `isoloir` submodule over https (a public
repository, no secret). `release.yml` pushes the image to
`ghcr.io/<owner>/isoloir` with the workflow's own token; `site.yml` needs
GitHub Pages enabled with "GitHub Actions" as the source.

## 9. When ZKPassport moves

The ingest verifies passport proofs with the SDK pinned in
`../isoloir/zkverifier/package.json`. The ZKPassport app updates on its
own: when it starts proving with circuits the pinned SDK does not know,
the app says "verified" and the ingest answers `reg:bad_proof` (issue #1,
20 November 2026: circuits 0.23.0 against SDK 0.18.2).

`zkpassport-watch.yml` runs `../scripts/zkpassport-watch.mjs` every hour:
the pin against npm's latest SDK, the circuit version the app proves with
(ZKPassport's registry on Ethereum), and every registration on the log
replayed with the pin and with the latest SDK. A new SDK comes out before
the app uses its circuits, so the issue it opens (label
`zkpassport-watch`, assigned to the repository's owner) normally arrives
before a voter is refused. When it does:

1. Read the issue: it says whether the latest SDK verifies every
   registration on the log. If it does not, stop and find out why (the
   audit and the authority would stop on those registrations).
2. In isoloir: set `@zkpassport/sdk` in `zkverifier/package.json`, run
   `npm install --ignore-scripts` there, open the pull request, merge it.
3. Here: move the submodule to that commit, then deploy **both** services
   (the authority verifies every passport before it opens a poll):
   `scripts/deploy-tree.sh ingest <dir>` and `… authority <dir>`, each
   deployed as its service. Check the running version:
   `grep '"version"' /app/zkverifier/node_modules/@zkpassport/sdk/package.json`
   in the container.
4. The issue closes by itself at the next run.

A voter who was refused meanwhile lost nothing: their key is kept by the
page, and they scan again. The ingest logs the verifier's reason for every
refused proof ("passport proof refused", a warning), and keeps the refused
message 30 days in `isoloir_refused`: `verify.mjs` can replay it.

The watch cannot see a break that comes without a new SDK or a new
circuit version. The first registration after any change of the app is
the real test: watch the ingest's warnings during a poll.
