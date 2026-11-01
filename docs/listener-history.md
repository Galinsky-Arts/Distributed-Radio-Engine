# DRE-22 durable listener completion history

The legacy `ListenerCompletion` prototype stores only volatile per-process
state and MUST NOT be treated as an authenticated playback proof.

`DurableListenerCompletion` persists strictly scoped per-listener, creator and
occurrence completions with a local private SQLite file (WAL/FULL synchronous
transactions). Its externally provided synchronous `verifyCompletion` must
authenticate a complete uninterrupted playback interval and output route for
the exact immutable scope, station/program digest and occurrence. A raw client
flag, an unsigned playback event, or a permissive test callback is not proof.
Missing, throwing or async verifiers fail closed.

Muted, background-halted or late-joined playback cannot become a recorded
completion. Headphones can record a full listen for Groove eligibility but
never themselves earn speaker points. Neither route yields spendable points
or a grant from this module. Replays of an identical occurrence remain
idempotent; conflicting routes or program revisions are rejected.

The durable service supports restricted creator-scoped history pages and
authenticated lifetime counts for future DRE-21 eligibility. It stores
metadata only, no decrypted media, raw ambient sound, location, or secrets.
Actual DRE-11 endpoint identity and DRE-15 completion authority remain to
be integrated; browser/native live authentication is not asserted here.
