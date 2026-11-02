# Zcash Agora

**One passport, one voice.** Anonymous polls for the Zcash ecosystem,
counted per head and shown next to the count per coin.

Zcash polls today count coins: a ballot weighs what its caster holds.
Zcash Agora counts people: one valid passport, one anonymous ballot,
sealed until the close by the [drand](https://drand.love) randomness
beacon (a key that does not exist before the closing time, held by no
one), appended to a public log timestamped in Bitcoin, and recounted by
anyone. It is a companion to coinholder polling, not a replacement:
both counts are shown side by side, and neither binds anyone.

The protocol is [isoloir](https://github.com/tartuffeme/isoloir)
(pinned as a submodule). This repository holds what Zcash Agora adds:

| Directory | What |
|---|---|
| [`ledger/`](ledger/) | the setups of this ledger: origin and channels, the passport registry (any passport, unexpired, no age or nationality rule), the first poll (the ZSA question, time-locked to drand quicknet round 34815412) |
| [`site/`](site/) | the website (GitHub Pages): vote, why, how it works, technical, the comparison with the coinholder stack, eligibility, recount. `site/app` is the voting page (Vite, `@isoloir/web`, a ZKPassport adapter) |
| [`deploy/`](deploy/) | docker-compose for the ingest, the authority and Caddy, and the runbook from nothing to an open poll |
| [`scripts/`](scripts/) | `trial.sh`: the whole thing locally with the dev passport provider, in three minutes; `audit.sh`: recount the public ledger |
| [`zip/`](zip/) | the draft ZIP: personhood polling as an instrument next to coinholder polling |
| [`.github/workflows`](.github/workflows/) | `release.yml` builds the `isoloir` binaries and the container image; `site.yml` deploys the site |

## Eligibility, in one paragraph

Any biometric passport that [ZKPassport](https://zkpassport.id) can
verify, unexpired, of any country, at any age. The proof is made on the
phone and discloses nothing but a number unique to the document, so the
same passport registers once. The number is salted by ZKPassport's
threshold OPRF under a pinned key, so the issuing state cannot recompute
it from its records. This is **one** proof of personhood: it excludes
people without such a passport or an NFC phone, and the salted number
needs a face match in the app. Humans matter more than coins; the
registry format accepts other providers whenever a better proof of
personhood exists.

## What is public, and when

| | before the close | after the close |
|---|---|---|
| that a passport identifier registered | public | public |
| which registration cast which ballot | never | never |
| a ballot's content | nobody, not the operator | public, under an unlinkable per-poll pseudonym |
| the count | nobody | public, recomputable by anyone from the log and the drand round |

## Run it locally

Needs Rust, Postgres on localhost, node 22, `nargo` 1.0.0-beta.22
(`noirup -v 1.0.0-beta.22`) and `bb` 5.0.0 (`npm i @aztec/bb.js@5.0.0`;
`ISOLOIR_BB` points at `build/<arch>-<os>/bb`).

```sh
git clone --recursive git@github.com:lanterne-labs/zcash-agora.git && cd zcash-agora
(cd isoloir && cargo build --release -p isoloir)
ISOLOIR_BB=… scripts/trial.sh          # relay, ingest, registry, a 90-second tlock poll, 3 voters, the drand opening, the audit
```

For the site: `(cd isoloir/js && npm ci && npm run wasm:web && npm run build)`,
then `(cd site/app && npm ci && npm run build)` writes the voting page into
`site/vote/`, and `python3 site/build-pages.py` assembles the other pages.
`SERVE=1 scripts/trial.sh` plus `npm run dev -- --mode trial` in `site/app`
runs the real voting page against the local trial (dev passport provider:
type any identifier instead of scanning).

## Status

- Protocol, circuits, ingest, authority, audit: isoloir, trial-tested here
  end to end with the real drand quicknet (`scripts/trial.sh`).
- Setups: written and checked offline (`isoloir check`). Keys, genesis and
  the mirror repository are made at deployment (`deploy/README.md`).
- Site: written. The voting page is built on `@isoloir/web`; the ZKPassport
  adapter follows the SDK's documented flow and must be exercised with a
  real passport before the poll opens.
- Hosting, domain (`zcash-agora.org` is a placeholder throughout) and the
  org rename to `lanterne-labs`: to decide.

## Licence

Code MIT or Apache-2.0; texts CC-BY-4.0. See [LICENSE](LICENSE).

## Try it, passport-free

```sh
scripts/try.sh        # http://localhost:5173/ ; CLOSE_IN=300 for a five-minute poll
```

The whole ledger runs locally with isoloir's *dev* registry (type any
identifier instead of scanning a passport); three command-line voters
have already voted; you register and vote from the real page; at the
close the ballots open with the real drand beacon and the result shows.
A dev registry is refused by any ingest not started with `--dev`, and the
production registry is ZKPassport: test mode cannot leak into production.
