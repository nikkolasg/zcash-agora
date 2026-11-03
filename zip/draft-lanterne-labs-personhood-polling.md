    ZIP: unassigned
    Title: Personhood Polling: counting people, not coins, in Zcash ecosystem polls
    Owners: Lanterne Labs <lanternelabs@proton.me>
    Credits: the isoloir protocol and its contributors
             the drand League of Entropy
             ZKPassport
    Status: Draft
    Category: Informational / Process
    Created: 2026-11-02
    License: MIT
    Discussions-To: <https://forum.zcashcommunity.com/> (thread to be opened)
    Pull-Request: <https://github.com/zcash/zips/pull/???>


# Terminology

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY", "RECOMMENDED",
"OPTIONAL", and "REQUIRED" in this document are to be interpreted as described
in BCP 14 [^BCP14] when, and only when, they appear in all capitals.

"Coinholder poll" means a poll in which the weight of a ballot is the amount
of ZEC its caster proves to hold at a snapshot, as in the shielded coinholder
voting protocol drafts [^valar-voting] [^valar-setup] and the Coinholder Protocol
Feature Sentiment Poll of February 2026 [^sentiment-poll].

"Personhood poll" means a poll in which every eligible person has one ballot
of weight one, whatever they hold.

"Ledger", "registry", "registration", "poll", "ballot", "checkpoint",
"mirror", "ingest", "authority" and "audit" are to be interpreted as defined
in the isoloir specification [^isoloir-spec].

"Time-lock" means identity-based encryption to a future round of a
threshold randomness beacon, as implemented by drand's tlock [^tlock].


# Abstract

This ZIP describes a polling mechanism for the Zcash ecosystem that counts
people rather than coins: eligibility is proven once, in zero knowledge, with
a government-issued passport; each ballot is anonymous, encrypted to a future
time by a randomness beacon that no Zcash party operates, and appended to a
public, signed, timestamped log that anyone can recount. It specifies the
eligibility rule, the ballot, what is public at each moment, the publication
of results, and how a personhood count is reported next to a coinholder
count. It is informational: it binds no one, allocates no funds, and changes
no consensus rule. It is a companion to coinholder polling, not a replacement.


# Motivation

The Zcash ecosystem has, since 2025, used coinholder polls as a signal for
protocol and funding decisions [^sentiment-poll] [^zip-1016]. A coinholder poll
answers one question well: what does the capital want? It cannot answer a
second question that the same decisions raise: what do the people want?

The two can differ widely. In the February 2026 sentiment poll, the reported
98.6% against Zcash Shielded Assets is a share of the voting weight, cast by a
turnout of about 7.25% of the circulating supply [^sentiment-poll]
[^forum-zcg]. The number of distinct humans behind it is unknown, by design: a
coinholder poll has no notion of a person. Whether a thousand people or ten
held that weight is not a detail; it changes what the number means.

Zcash's own motivation is not capital-weighted. Its roots are in the cypherpunk
tradition, where the protections are for persons: the right to transact, to
speak, to be let alone, held equally by whoever has a little and whoever has
a lot. A governance signal that weighs a voice by a balance is a legitimate
signal, but it is a different thing from a count of the people, and an
ecosystem that only ever looks at the first is blind in one eye.

This ZIP therefore specifies a second instrument, to be read next to the
first. It does not propose which of the two should prevail, and it does not
propose that either be binding. It proposes that both be measured, with the
same rigour, and shown together.


# Privacy Implications

A personhood poll must establish that each voter is one person and then
forget who that person is. The mechanism below is designed so that:

- No party learns how a given person voted, at any time, including the
  operator, the registering authority (ZKPassport), the passport's issuing
  state, the randomness beacon's operators, and anyone reading the log.
- No party learns any ballot's content before the poll closes, including
  the operator. There is no decryption key: the key is the beacon's
  signature of a round that does not yet exist.
- After the close, every ballot's content is public under a per-poll
  pseudonym. The pseudonym is unlinkable to the passport, to the
  registration, and to the same person's pseudonym in any other poll. The
  publication is deliberate: it is what makes the count recomputable by
  anyone, and it reveals a choice without a weight, a balance, an address or
  a person attached. Section "What is public" states this precisely.
- The passport's issuing state cannot tell whether a holder registered:
  the registration identifier is salted by ZKPassport's threshold OPRF
  under a key the registry pins, so computing it takes the passport's
  chip data and two of the three OPRF operators. The price is a face
  match in the ZKPassport app at registration.
- The network address of a voter is seen by the public relay the voter
  posts to (and by no one else when relays are used). Voters MAY use Tor or
  a VPN; the system does not depend on it for ballot secrecy, only for
  address privacy.

The sections on eligibility and on limitations give the full list of what
each party learns.


# Requirements

1. One person, one ballot of weight one per poll; a second registration of
   the same passport MUST be refused.
2. No party, including the operator, can read any ballot before the poll's
   close; no party is trusted to withhold a key.
3. Every accepted and every refused message is in a public, append-only,
   signed, timestamped log; the result of a poll is a deterministic function
   of that log and of public beacon data; anyone can recompute it.
4. A voter can prove, with a signed receipt, that an acknowledged ballot was
   dropped; withholding is detectable by third parties.
5. No chain, token, sequencer network or key ceremony operated by the
   polling organization.
6. The personhood count MUST be reported next to the coinholder count of the
   same question, when one exists, in a form that states what each counts.


# Specification

The protocol is isoloir [^isoloir-spec], used with the parameters fixed
here. Where this ZIP and the isoloir specification differ, the isoloir
specification is normative for the protocol and this ZIP for the
parameters and the reporting.

## Eligibility: the registry

A registry is a rule a passport must satisfy and a Merkle tree of the
registrations that did. The Zcash Agora registry uses the ZKPassport
provider with:

- `document_type`: `passport`;
- `require_expiry`: true (the document is not expired on the day of the
  proof);
- no `min_age` and no `nationality` constraint;
- `oprf_key`: ZKPassport's mainnet OPRF key 1, pinned, so that the
  identifier is salted.

A voter registers by proving, on their phone with the ZKPassport app
[^zkpassport], that their passport satisfies the rule, and obtains a unique
identifier `uid` derived from the document, the registry's domain and its
scope, and the output of the threshold OPRF (2 of 3 nodes) under the
pinned key on a blinded query. The identifier is the same for the same
passport and registry, and the issuing state cannot compute it from its
records. The ingest verifies the proof with the provider's open
verifier, refuses a `uid` already registered, and logs a leaf
`ID = H(T_id, registry, s)` bound to a voter secret `s` known only to the
voter's devices. The proof is bound to a throwaway registration key that
signs the leaf, so a relay that saw the proof cannot reuse it.

Rationale and alternatives are in the Rationale section. Other providers
(other identity documents, other personhood proofs) are a new provider in
the same registry format, not a new protocol.

## The ballot

A ballot in a poll of kind `choice` (single choice among up to four slots,
including a blank) carries:

- a zero-knowledge proof (Noir, UltraHonk) that a leaf of the registry tree
  at a recent checkpoint root belongs to the prover, that the pseudonym
  `nullifier = H(T_null, poll, s)` is derived from the same secret, and that
  the committed values encode one valid choice for the poll's mask;
- a commitment `vcmt` to the choice under a salt;
- a blob: a 16-byte key time-locked to the poll's drand round
  [^tlock], followed by the salted choice sealed under that key. The proof
  binds the blob's hash, so the blob cannot be swapped in transit and only
  the voter can make their own ballot void.

One ballot per pseudonym (`revote: none`). A second ballot of the same
pseudonym MUST be refused and the refusal logged.

## Time-lock parameters

The poll names the drand chain (`quicknet`, chain hash
`52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`, period
3 s, genesis 1692803367, scheme `bls-unchained-g1-rfc9380`) and the round
at or after `closes`. The beacon of that round is the only key that opens
the ballots. The chain is operated by the League of Entropy [^drand], a
consortium of organizations none of which is a Zcash organization. The
threshold of League nodes could, by colluding, produce the round's
signature early; what they would learn is exactly what everyone learns at
the round (the next section), earlier.

## The log, the mirror, the receipts

Every accepted message and every refusal is an entry of one append-only
RFC 6962 log with Ed25519-signed checkpoints, mirrored as static files in
a public git repository read by commit, and every checkpoint is
timestamped in Bitcoin with OpenTimestamps. Messages travel through public
Nostr relays (which keep copies, so withholding is provable) or the
ingest's direct HTTPS endpoint. Every message is acknowledged with a
signed receipt naming the checkpoint that will hold it; a missing body is
a complaint anyone can judge. These are isoloir §4, §11, §15 unchanged.

## Publication of results

The poll is `closed`: no tally before the close. At the first checkpoint
at or after `closes`, the ingest logs the `close` entry. Any party fetches
the beacon of the poll's round, opens every counted ballot, lists as
`void` the ballots whose blob does not open to its commitment, and posts
the tally `{values, counted, void, beacon}`. The ingest verifies every
opening before logging it. Two correct tallies are identical.

## What is public, and when

| | Before the close | After the close |
|---|---|---|
| That a passport `uid` registered, at which checkpoint | public | public |
| Which registration cast which ballot | never | never |
| That a pseudonym cast a ballot, at which checkpoint | public | public |
| The content of a ballot | nobody, not the operator | public, under the pseudonym |
| The count | nobody | public, recomputable |

The ingest sees relay traffic timing as any relay does; a relay sees the
address that posts to it; the operator sees the address of a voter who
uses the direct channel instead of a relay.

## Reporting next to a coinholder count

A report of a question that was polled both ways MUST present, for each
instrument, in the same table:

1. the question and the options, verbatim, and whether they are identical
   across the two polls;
2. the unit counted (ZEC at a snapshot height; persons with a passport);
3. the result per option in that unit, and as a share of the ballots cast;
4. the turnout: ZEC voted over ZEC in circulation at the snapshot; persons
   who voted over persons registered;
5. what is unknown: for the coinholder poll, the number of distinct persons;
   for the personhood poll, the holdings of the voters;
6. the dates of each poll and a link to the data each count is recomputed
   from.

A report MUST NOT present either count as the other, and SHOULD NOT present
either as the ecosystem's decision. A report MAY state which count the
author weighs more and why.


# Rationale

**Why passports.** A personhood poll needs Sybil resistance or it counts
accounts, not people. Forum accounts, GitHub accounts, e-mail addresses and
wallet addresses are free to create in any number. A passport is a credential
that a state issues once per person and that a phone can verify offline,
with a zero-knowledge proof that discloses nothing but the fact the rule
demands. It is one proof of personhood among several; it excludes people
without a biometric passport or an NFC phone, and the salted identifier
takes a face match in the app. Humans matter more than coins: the registry
counts people, and its format accepts other providers whenever one is
ready.

**Why time-lock rather than a threshold committee.** A committee that holds
decryption shares is a trust assumption with a Zcash-shaped incentive: its
members are, in practice, the ecosystem's organizations, and the thing they
could decrypt early is the ecosystem's own vote. A time-lock to a public
randomness beacon has no key holder in the poll at all. The beacon's
operators are unrelated to the question, learn nothing by decrypting early
that is not public an hour later, and have been producing rounds every three
seconds since 2023. The cost is that every ballot opens at the round, under
a pseudonym: the mechanism publishes the whole count, not only its sum.

**Why publish the ballots.** A sum that only a key holder can produce is a
sum the public takes on trust in the key holder. A set of opened ballots
under pseudonyms is a count anyone recomputes, with no key, from the log
and the beacon alone. The pseudonym carries no weight and no identity, so
the publication reveals a choice without a person.

**Why one ballot per voter.** Under time-lock a correction is only sound if
the ballot it corrects is counted, and nobody can tell before the round
whether a blob will open (isoloir §8). Re-votes are a feature of the
ElGamal modes, which need an authority.

**Why no chain of our own.** Voting on a chain operated by the parties
whose decision is at stake is the thing a counter-signal should avoid. The
log is a transparency log; the only chains touched are Bitcoin (to
timestamp checkpoints) and drand (to open ballots), and both are read, not
written to by voters.

**Why informational.** The authors do not propose that any count bind
anyone. They propose that the ecosystem measure both and look.


# Security Considerations

- **Operator.** The ingest can refuse service and chooses what each
  checkpoint holds. It cannot read, alter or forge a ballot, cannot register
  anyone, and cannot drop an acknowledged message without a receipt proving
  it. It can fork the log for a subset of readers; the audit collects notes
  from the relays and the mirror and fails on two notes of one index with
  different roots.
- **ZKPassport.** The ingest verifies every passport proof with the
  provider's open verifier against the registry's rule and the certificate
  registry. A compromise of ZKPassport's certificate registry could admit
  forged passports; the audit re-verifies every registration and a pinned
  certificate root is listed among isoloir's extensions. The OPRF key is
  pinned in the registry, so a verifier needs nothing from the OPRF nodes;
  two of the three nodes must be reachable to register, and two colluding
  with an issuing state could recompute that state's identifiers.
- **drand.** A threshold of League nodes could sign a round early and open
  the ballots early; what they would learn is public at the round. They
  cannot alter a ballot or the count.
- **Coercion and sale.** A voter who reveals their secret `s` proves their
  ballot, as a coinholder who reveals a hotkey does. The time-lock delays
  any such proof to after the close; it does not prevent it.
- **Relays.** A relay sees the address and the time of a post, and after
  the round the content of the ballots it carried, as the public does. A
  voter uses different relays for registration and ballots, chosen by a hash
  of `s`.
- **Scale.** The reference deployment holds about 100,000 ballots in memory
  and a tree of depth 20 holds a million registrations.


# Reference Implementation

- isoloir [^isoloir]: the protocol, the ingest, the authority, the audit,
  the browser package.
- Zcash Agora [^agora]: the setups of this ledger, the deployment, the site,
  and this ZIP.


# References

[^BCP14]: [Information on BCP 14 — "RFC 2119: Key words for use in RFCs to Indicate Requirement Levels" and "RFC 8174: Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words"](https://www.rfc-editor.org/info/bcp14)

[^isoloir-spec]: [isoloir — protocol specification](https://github.com/lanterne-labs/isoloir/blob/main/SPEC.md)

[^isoloir]: [isoloir: anonymous polls with passport eligibility](https://github.com/lanterne-labs/isoloir)

[^agora]: [Zcash Agora](https://github.com/lanterne-labs/zcash-agora)

[^tlock]: [tlock: Timelock Encryption/Decryption Made Practical](https://github.com/drand/tlock), and [drand documentation: Timelock encryption](https://docs.drand.love/docs/timelock-encryption/)

[^drand]: [drand: the League of Entropy](https://drand.love/partners/)

[^zkpassport]: [ZKPassport documentation](https://docs.zkpassport.id/intro)

[^valar-voting]: [Draft ZIP: Shielded Voting Protocol (Valar Group)](https://github.com/zcash/zips/pull/1200)

[^valar-setup]: [Draft ZIP: Zcash Shielded Coinholder Voting (Valar Group)](https://github.com/zcash/zips/pull/1203)

[^sentiment-poll]: [Coinholder Protocol Feature Sentiment Poll](https://forum.zcashcommunity.com/t/coinholder-protocol-feature-sentiment-poll/54487)

[^forum-zcg]: [End ZCG and send its funds to the NSM (forum thread, October 2026)](https://forum.zcashcommunity.com/t/end-zcg-and-send-its-funds-to-the-nsm/58515)

[^zip-1016]: [ZIP 1016: Community and Coinholder Funding Model](https://zips.z.cash/zip-1016)
