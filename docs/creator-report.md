# DRE-25 source-bound creator and sponsor reporting

`creatorReport` requires exact tenant/application/creator scope, a bounded event
set and an explicit trusted source verifier. Status strings do not authenticate
an output, transaction, grant or campaign. Source/event IDs deduplicate the input;
currencies remain separate and amounts use exact integer units. Future-dated
records, cross-scope events, malformed quantities and asynchronous/failed
verifiers fail closed.

Missing measurements stay unavailable (`null` and false coverage), rather than
becoming measured zeros. A verified zero remains distinct. Source proofs and
raw ambient/extra private fields are absent from the output. The authorized
reporting endpoint must load minimal records from actual output/ledger, grant,
provider and campaign stores and bind each verifier to those exact source facts.
No output quantity estimates how many humans heard a broadcast, and no location
or venue requirement is introduced.

The pure projection does not deploy an analytics endpoint or supply production
issuer keys. Production source provisioning, encrypted report delivery, retention
and operational verification remain separate integration gates.
