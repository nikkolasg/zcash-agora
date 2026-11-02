# The Zcash Agora ledger: its setups

The files the operator submits (`isoloir submit`), checked offline first
(`isoloir check`). They are canonical JSON bodies as isoloir's SPEC
describes (§4.1 ledger, §5 registry, §7 poll); the log holds them with
inclusion proofs and the browser verifies them before it uses them.

| File | What | Fixed for ever |
|---|---|---|
| `ledger.json` | origin, log key, ingest key, channels (three public Nostr relays, no direct endpoint: the operator never sees a voter's address), checkpoint period | origin, log key |
| `registries/1.json` | who may vote: any passport that ZKPassport can verify, not expired. No minimum age, no nationality rule. The identifier is salted by ZKPassport's threshold OPRF under mainnet key 1 (`oprf_key`, pinned), so the issuing state cannot recompute it. | domain, scope, identifier type (the passport identifier derives from them) |
| `polls/1.json` | the ZSA question: single choice, two options and a blank, time-locked to drand quicknet, one result at the close, one ballot per voter | everything but `title` and `closes` (which may only move later, SPEC §13) |

`FILLED-AT-GENESIS` fields are the keys made in `../deploy/README.md` §1.

## The poll

- Opens 2026-11-16 12:00 UTC, closes 2026-12-14 12:00 UTC (four weeks).
- `round` 34815412 is the quicknet round at or after the close
  (`./round.sh 1797249600`); the beacon of that round is the key that opens
  every ballot, and it does not exist before 2026-12-14 12:00:00 UTC.
- `circuit.vk_hash` is the hash of the verification key of
  `choice4_tlock_linked_d20` built with nargo 1.0.0-beta.22 and bb 5.0.0.
  Anyone can rebuild it (`isoloir circuits`) and compare.
- `blank: true`: a voter may cast a ballot that picks nothing. It counts
  in `counted` and in no option: "I took part and I abstain".
- `revote: none`: under time-lock a correction is a pattern of its own,
  so one ballot per voter (SPEC §8).

## Later polls

A new poll is a new file `polls/<id>.json` on the same registry: no new
registration, no new keys. The matrix in SPEC §8 says what is sound; the
`choice4_tlock_linked_d20` circuit serves any single choice among up to
four slots (three options and a blank). A ranked ballot or more options
is another variant to build and install first.
