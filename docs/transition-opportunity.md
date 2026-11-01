# DRE-20 authoritative shared transition projection

The original pure cadence helper is a deterministic software utility, not
proof of a server-approved opportunity. The additional
`verifiedStationTransition` accepts an authenticated DRE-06 compiled program,
cycle number, broadcast epoch, and completed occurrence. A trusted synchronous
verifier must authorize the exact immutable normalized program snapshot. It
rejects ambiguous markers, invalid timing and untrusted/async approval.

The chosen opportunity marker comes from the existing broadcaster-approved
common timeline. Its absolute time is the station epoch plus completed cycle
duration and marker offset. Its digest-bound opportunity ID is stable across
clients/reconnects but differs for another broadcast cycle. No listener input
can choose a different marker; absence of an approved marker produces no
opportunity. All client-facing information is metadata, never media plaintext,
media keys, account/private data or a spendable reward.

Real authoritative DRE-06 program verification, station-clock discipline, and
authenticated endpoint delivery must be integrated before claiming a deployed
shared opportunity scheduler. No cryptographic protocol is invented here.
