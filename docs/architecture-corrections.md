# Corrections to the proposed architecture sketch

The sketch titled "Beekle Payment Gateway × Stellar — Settlement Architecture" is a proposal. It is not evidence that any box is running. Retrieved Bridge docs on 2026-11-07 change a few of its labels.

- The green "current platform" boxes (checkout, orchestrator, compliance gate, wallet ledger, merchant webhooks) are outside this repository. This service does not approve KYC and does not take a merchant session from that platform. It accepts an opaque `complianceDecisionRef` and a merchant bearer key.
- The violet "planned" area is not implemented as a whole. This repository is only the Bridge adapter, its MySQL record of transfers, and reconciliation of those Bridge transfer records. It is not the Stellar observer, the signer, or a two-rail orchestrator.
- "One orchestrator, two settlement routes" is not built. Route A, native Stellar, is the sibling described in `sibling-stellar-boundary.md`.
- The Bridge box says "quotes / transfers / signed webhooks". Transfers and signed webhooks match the docs. No separate quote resource appeared in the transfer pages read on 2026-11-07. Route checks are local policy, plus the documented `dry_run: true` flag on `POST /v0/transfers`. That flag was tested against a fixture, not against Bridge.
- "Signed webhooks" is specifically `X-Webhook-Signature: t=<milliseconds>,v0=<base64>` over `SHA256(SHA256(timestamp + "." + rawBody))` with the webhook endpoint's RSA public key (PKCS#1 v1.5, SHA-256). It is not a shared-secret HMAC.
- Route B is not "fiat to USDC" only. The route explorer lists several fiat rails and several stablecoins. USDC on Ethereum is one documented pair. Stellar USDC is also listed there and is blocked in this adapter.
- "Partner-dependent: currencies, corridors and commercial terms not yet confirmed" remains true. Every accepted route is stored with account eligibility `unknown` and commercial availability `unconfirmed`.
- The sketch's note that native payments use no Soroban contracts is about the sibling, not this adapter. This service does not deploy or call contracts.
- Host placement "AWS + Contabo, service placement to be confirmed" stays unresolved. This repository does not assign the process to either provider.
