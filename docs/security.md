# Endpoint encryption and assurance

The exact upstream E2EESA commit and profile IDs are pinned in security-baseline.json. Media and private derivatives are prepared, probed and encrypted at the artist/operator's authorized endpoint. Ciphertext-only storage, CDNs, relays and schedulers route opaque records and must never possess private manifests, media keys or plaintext. Uploaded waveform images, transcodes, previews and caches are separate encrypted objects with fresh keys.

Recorded media uses attachment-chunked-aead@0.1.0. Its private manifest/key must be distributed through an authenticated E2EESA pairwise/group channel; the object codec does not implement that channel or invent a substitute. Live audio will use RFC 9605 SFrame with one of the two exact upstream profiles after interoperability and counter-persistence qualification. Signature-only controls are integrity protection; private control payloads also require an E2EE control channel.

Account authentication and endpoint/device authority are separate. Relays cannot add recipients. Guest free-listening endpoints can be deliberately authorized under the artist's broadcast policy without an audience account; the endpoint key/authorization protocol remains explicit. This is access control, not a promise that an authorized listener cannot copy sound.

Operational metadata includes opaque tenant/application routing, opaque asset and session IDs, ciphertext sizes, retention, payment-provider transaction records and point-wallet arithmetic. Private titles, manifests, audio, contributor precise locations, permits and sensitive creator records remain encrypted. Intentional public artist/station metadata and required financial facts are documented disclosures; those facts are not falsely called E2EE secrets. Radio point adjudication later requires a narrowly scoped explicit reward-verifier endpoint if it consumes private evidence; the verifier cannot silently become a media recipient.

No cloud cost, production deployment, actual hardware result, independent crypto review or certification has been supplied by creating this repository. Endpoint codec/control tests verify implemented behavior, not the entire standard. Key-distribution integration, native secure storage, client update transparency, maintained dependency/secret scans, restore/retention drills and field trials remain concrete integration/release gates. Independent expert review is deferred follow-up under the October 13 owner policy, not a merge or release prerequisite. Owner-authorized development merges continue around those gates. An author cannot count as their own independent release reviewer.

Ciphertext relay retention is bounded to 30 days under the pinned server profile. Long-term fan/artist archives require an independently assessed endpoint-controlled backup profile. Expiration does not recall content already delivered to a listener.

The November 9 [radio flow inventory](radio-security-flow-inventory.json) maps
current implementation roles, intended disclosures and unresolved integrations.
It is source discovery and AI-assisted review evidence, not a complete standard
assessment or independent certification. Radio station recovery now requires an
owner-private ordinary database and directory, rejecting symlink targets and
implicit volatile storage. Protecting public scheduling metadata also protects
its integrity; public classification does not authorize untrusted mutation.
