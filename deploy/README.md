# Running the Zcash Agora ledger

The order of operations, from nothing to a poll people can vote in. The
protocol and the tools are isoloir's (`../isoloir`, pinned by commit);
this file only says what Zcash Agora fills in. isoloir's own
[OPERATING.md](../isoloir/OPERATING.md) is the reference.

Three roles, three places:

| Role | Where | Holds |
|---|---|---|
| ingest | a server with Postgres (`docker-compose.yml`) | the log key, its Nostr key, a deploy key of the mirror |
| authority | the same host, or anyone's machine | nothing: the polls are time-locked to drand, it only opens them after the round |
| operator | any machine with access to the ingest's database | submits the setups in `../ledger` |

Decisions that cannot be changed after genesis: the **origin**
(`zcash-agora.org/agora`), the **log key**, and for each registry its
**domain and scope** (the passport identifier is derived from them: a
different scope is a different set of identifiers, and people could
register twice). Choose the domain before step 1.

## 0. Before anything: the domain

The site is static (GitHub Pages, `../site`). The ingest's direct
channel needs a host of its own (`ingest.zcash-agora.org` here) because
Pages cannot proxy. The ZKPassport `domain` in `../ledger/registries/1.json`
is the site's host: the passport request is made from the page and the
SDK binds the proof to it.

## 1. Keys

On the ingest host, with the isoloir binary (`../.github/workflows/release.yml`
builds one per platform; or `cargo build --release -p isoloir` in `../isoloir`):

```sh
isoloir keygen log --origin zcash-agora.org/agora     # ISOLOIR_LOG_SEED (secret), log_key (public)
isoloir keygen nostr                                  # ISOLOIR_NOSTR_KEY (secret), the ingest's pubkey
isoloir keygen nostr                                  # a second one for the authority
```

Put the secrets in `.env` (from `.env.example`). Put `log_key` and the
ingest's public key in `../ledger/ledger.json`, and `log_key` in
`../site/agora.config.json` (`verifierKey`): the browser pins it and
never reads it from the mirror.

## 2. The mirror repository

Create an empty **public** repository (`lanterne-labs/zcash-agora-mirror`),
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
isoloir check registry ../ledger/registries/1.json
isoloir check poll ../ledger/polls/1.json --registry ../ledger/registries/1.json
isoloir genesis ../ledger/ledger.json                 # once per database
docker compose up -d db ingest caddy
isoloir submit registry ../ledger/registries/1.json  # waits until logged
isoloir submit poll ../ledger/polls/1.json
```

The poll's `round` is the drand quicknet round at or after `closes`
(`../ledger/round.sh <closes>`). The ingest checks it.

## 5. DNS and the site

- `ingest.zcash-agora.org` → the compose host (Caddy gets the certificate).
- `zcash-agora.org` → GitHub Pages (`../site/CNAME`); enable Pages on the
  repository with the `site.yml` workflow as the source.

## 6. The authority

`docker compose up -d authority`. It verifies the whole log (every proof,
every passport) before it opens anything, then at the first checkpoint
after `closes` it fetches the drand beacon of the poll's round, opens
every ballot, and posts the tally. Any third party can do the same, from
the public mirror, with circuits they built themselves:

```sh
isoloir authority --mirror https://cdn.jsdelivr.net/gh/lanterne-labs/zcash-agora-mirror@main \
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

## 8. CI secrets

Both workflows check out the `isoloir` submodule, which is a private
repository: add a read-only deploy key of `tartuffeme/isoloir` as the
repository secret `ISOLOIR_DEPLOY_KEY` (the private half; the public half
on isoloir's deploy keys). `release.yml` pushes the image to
`ghcr.io/<org>/isoloir` with the workflow's own token; `site.yml` needs
GitHub Pages enabled with "GitHub Actions" as the source.
