# Direct Stellar boundary

This package does not call, import, or settle the direct Stellar gateway. The fields below are the boundary the separate integration is expected to own. They are not a claim that the two services are wired together, and they are not Bridge transfer fields.

Intent fields:

| Field | Meaning |
| --- | --- |
| `id` | Intent id owned by the Stellar gateway |
| `amount` | Decimal string |
| `assetCode` | Stellar asset code |
| `assetIssuer` | Stellar asset issuer |
| `network` | Stellar network name |
| `destination` | Destination account |
| `memo` | Optional memo |
| `reference` | Optional client reference |
| `expiresAt` | Expiry timestamp |

Normalized events the sibling may emit, named here only so the boundary is visible:

- `intent.created`
- `intent.updated`
- `intent.expired`
- `intent.completed`
- `intent.failed`

No code in this repository produces those events or accepts those intents. Bridge's public route explorer does list Stellar USDC and Stellar EURC. This adapter rejects every `stellar` rail with `stellar_route_not_orchestrated` so a fiat-to-Stellar-USDC transfer cannot be mistaken for the direct gateway.
