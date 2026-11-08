# Beekle Bridge adapter

Maintainer: Buchi Onwuasoanya, Beekle Technologies Limited.

NestJS service that orchestrates Bridge fiat and stablecoin transfers for Beekle. Bridge settlement is not live. The default provider is a local fake that never calls Bridge. The real HTTP client is implemented against the documented transfer API and is tested with fixtures on loopback, not against Bridge sandbox or production.

Docs were read on **2026-11-07**. Account eligibility and commercial corridors are unconfirmed. A route the API schema and the public route explorer both list is still not a Beekle go-live approval.

## What is implemented

- Fixed-amount transfer create, get, list, and cancel. Create calls an injectable compliance verifier and does not treat a correlation string as approval. The labelled local demo verifier is allowlist-only and cannot be selected for the real HTTP provider. Real HTTP mode stays blocked until a trusted verifier implementation exists; this build does not include one.
- Deposit instructions are stored redacted. Raw bank account numbers, routing numbers, IBANs, and beneficiary details are not written to MySQL. The owning merchant can fetch the current provider copy with `GET /v1/transfers/{id}/deposit-instructions`. That response is not saved. `DEPOSIT_INSTRUCTION_STORAGE=encrypted` is rejected because no at-rest encryption design is implemented.
- `GET /v1/capabilities/matrix` separates listed asset support in the examined create-transfer enum, orchestratable transfer routes, and account availability.
- Local allowlist: a pair must appear in the pinned route-explorer snapshot and in the create-transfer request enums captured the same day. Unknown rails and currencies are rejected.
- Explicit rejections for GHS, NGN, RMB/CNY, and every Stellar rail.
- Decimal-string amounts. They are not JSON numbers and they are not binary floats.
- Merchant idempotency keys, a stable outbound `Idempotency-Key` for Bridge, and MySQL unique constraints.
- Provider state machine for the documented happy path and the documented exception states. Older sequences and backward happy-path states do not rewrite a transfer.
- Webhook intake that verifies the raw body with Bridge's RSA signature. If the public key is unset, the handler returns 503 and does not change a transfer.
- Reconciliation of provider transfer ids this service created, by `GET /v0/transfers/{id}`.
- Audit rows that do not store the webhook body, API keys, or deposit account numbers.
- OpenAPI at `/docs` and `/openapi.json`.
- A small operator status page at `/operator`.
- Docker Compose for the app and MySQL. It was not started in this workspace because Docker is not installed here.

## What is not implemented

- No call to Bridge sandbox or production was made. No sandbox API key is available. No testnet or settlement evidence is claimed.
- No customer create, no KYC or KYB, and no `POST /v0/customers/{id}/simulate_kyc_approval`. A `kyc_required` provider state becomes `compliance_hold`. It is not an approval.
- No Stellar payment, memo, or asset-issuer flow. See [docs/sibling-stellar-boundary.md](docs/sibling-stellar-boundary.md).
- No separate quote API. `dry_run` exists on the HTTP client and is covered by a fixture test.
- No liquidation addresses, virtual accounts, wallets, cards, or external-account creation.
- No live link to the existing Beekle compliance service. The contract is documented below and is not a cryptographic check.
- Hosted CI in `.github/workflows/ci.yml` was not executed here.

## Supported and unsupported routes

Acceptance means all of the following:

1. Source and destination currencies are in the create-transfer `EuroInclusiveCurrency` enum.
2. Source rail is in `TransferSourcePaymentRail` and destination rail is in `SepaSwiftInclusiveOfframpPaymentRail`.
3. The pair is in the pinned snapshot of the public route explorer.
4. Documented constraints hold (`eur` with `sepa`, `swift` destination with `usd`, and the EUR/SEPA destination currency limit).
5. The amount is a positive decimal string at or above the explorer `min` for that pair. The explorer does not state a separate unit. Bridge can still reject the amount.

From the snapshot parsed on 2026-11-07:

| | Count |
| --- | ---: |
| Explorer pairs mapped onto API rail and currency codes | 1672 |
| Pairs this adapter will accept for orchestration | 1458 |
| Stellar pairs blocked even though they are listed | 146 |
| Explorer rows whose chain or asset is outside the create-transfer schema | 708 |

Accepted pairs still have account availability `unknown` and commercial availability `unconfirmed`. The 1458 figure is not a commercial corridor list and it is not an account endorsement. Sandbox endorsements are documented to differ from production.

`GET /v1/capabilities/matrix` is the distinction:

| Layer | What it means |
| --- | --- |
| Listed asset support | Currencies in the examined create-transfer `EuroInclusiveCurrency` enum. Codes absent from that enum are not sent. Absence from the pages examined on 2026-11-07 is not a claim about every Bridge product. |
| Orchestratable transfer routes | Explorer pairs that are also representable on the examined create-request enums and pass the documented constraints. Stellar rails are listed and are not orchestrated here. |
| Account availability | Unknown. A listed asset or an orchestratable route does not mean this Bridge account can use it. |

The explorer label `ACH` is stored as both `ach` and `ach_push` because the page does not split them. `Bre-B & Bank Transfer` is stored as both `bre_b` and `co_bank_transfer` for the same reason. `ach_same_day` is in the API enum and is not orchestrated because the explorer has no distinct row. `swift` as a source is not orchestrated because the create schema requires flexible amount, which this adapter does not send. `pix` and `faster_payments` as destinations are not orchestrated because they are absent from the examined create-request destination enum even where an example or the explorer mentions them.

This adapter will not send:

| Request | Code | Basis in the examined docs |
| --- | --- | --- |
| `ghs`, `ngn`, `cny`, `rmb`, `cnh` | `currency_not_in_bridge_transfer_schema` | Not in the examined create-transfer currency enum |
| Any `stellar` rail, including Stellar USDC | `stellar_route_not_orchestrated` | Present in the enum and the explorer; outside this adapter |
| Chains or assets only in the explorer, such as HyperEVM, Plasma, Monad, World Chain, Sui, Aptos, CASH, USDG | `not_in_create_transfer_request_schema` | Not in the examined create-request enums |
| `pix` or `faster_payments` or `bridge_wallet` as a destination | `destination_rail_absent_from_create_request_enum` | Missing from the examined destination request enum |

`GET /v1/capabilities` returns the counts. `GET /v1/capabilities/evaluate` checks one tuple.

## Source documents

All retrieved 2026-11-07 from `https://apidocs.bridge.xyz`:

- [Authentication](https://apidocs.bridge.xyz/api-reference/introduction/introduction) — `Api-Key` header, HTTPS only. Sandbox keys are per developer.
- [Idempotency](https://apidocs.bridge.xyz/api-reference/introduction/idempotence) — required `Idempotency-Key` on POST, not on GET or DELETE. Same body for 24 hours. A changed body or a key older than 24 hours is an error. This service does not mint a new Bridge key after that window, because that could create a second transfer.
- [Sandbox](https://apidocs.bridge.xyz/get-started/introduction/quick-start/setting-up-sandbox) — base URL `https://api.sandbox.bridge.xyz/v0`, keys prefixed `sk-test`. No real funds. Access requires a Bridge developer account. This workspace does not have one.
- [Create a transfer](https://apidocs.bridge.xyz/api-reference/transfers/create-a-transfer) — `POST /v0/transfers`, production host `https://api.bridge.xyz/v0`. Amounts are decimal strings. `409` with `resource_state_conflict` is retried with the same key.
- [Get a transfer](https://apidocs.bridge.xyz/api-reference/transfers/get-a-transfer), [list transfers](https://apidocs.bridge.xyz/api-reference/transfers/get-all-transfers), [delete a transfer](https://apidocs.bridge.xyz/api-reference/transfers/delete-a-transfer) — delete is documented only from `awaiting_funds`.
- [Transfer states](https://apidocs.bridge.xyz/platform/orchestration/transfers/transfer-states) — happy path never moves backward. `error` and `missing_return_policy` are in this guide and not in the OpenAPI `TransferState` enum. The list filter also names `kyc_required`, `kyc_in_review`, and `developer_kyb_required`, which the guide does not. All of those are treated as known non-success states.
- [Transfer errors and recovery](https://apidocs.bridge.xyz/platform/orchestration/transfers/transfer-errors-and-recovery) — retry 424, 500, and 503. Do not retry 400, 401, 403, 404, or 422. A 401 can mean a bad API key or a feature that is not enabled. Those are mapped separately and the upstream message is not returned.
- [Route explorer](https://apidocs.bridge.xyz/get-started/introduction/what-we-support/payment-routes) — pinned in `src/capabilities/route-explorer.snapshot.json`.
- [Webhook signature](https://apidocs.bridge.xyz/platform/additional-information/webhooks/signature) and [event structure](https://apidocs.bridge.xyz/platform/additional-information/webhooks/structure).
- [Configure webhooks](https://apidocs.bridge.xyz/get-started/introduction/quick-start/setting-up-webhooks).

Two official pages disagree about sandbox webhook delivery. The create-webhook reference says sandbox endpoints receive no events. The sandbox guide says supported simulations can generate events. This service does not claim either behavior was observed.

The ACH onramp body in `src/bridge/fixtures/ach-onramp.response.json` is the documented example from the create-transfer page. It is not a response captured from Bridge.

## Compliance and merchant contract

Merchant calls send `Authorization: Bearer` with a configured merchant credential. The merchant id comes from that configuration, not from the body.

Create also requires `complianceDecisionRef` and `onBehalfOf`.

- The decision reference is passed to `ComplianceApprovalVerifier`. Only a positive result from that verifier allows the provider call.
- `LocalDemoApprovalVerifier` accepts only refs listed in `LOCAL_DEMO_APPROVAL_REFS`. Its result is labelled `local_demo_not_a_compliance_gate`. It can be selected only when `BRIDGE_PROVIDER=fake`. It is not the Beekle compliance gate and it does not check identity documents.
- `bridge_http` cannot select the local demo verifier. With no trusted implementation registered, the verifier mode is `unconfigured` and create returns `compliance_verifier_unconfigured` before any provider request. `COMPLIANCE_VERIFIER=trusted` refuses to boot, because this build does not contain a trusted verifier.
- `onBehalfOf` is an existing Bridge customer id. This service does not collect name, address, tax id, or documents, and it does not call `simulate_kyc_approval`.

## Deposit instructions

Bridge deposit instructions can include bank account numbers, routing numbers, and beneficiary details. Those fields are not written to `transfers` or to audit metadata. The stored copy keeps the rail, amount, currency, deposit message, institution name, and chain addresses, plus the names of withheld fields.

`GET /v1/transfers/{id}/deposit-instructions` loads the current provider transfer for the owning merchant and returns the instructions for that response only. The handler does not save them. Operator status does not receive that payload. Setting `DEPOSIT_INSTRUCTION_STORAGE=encrypted` fails startup: no at-rest encryption design is implemented, so there is no mode that persists the raw values.

The fake provider keeps only the redacted instruction in its table. The labelled fake account number is generated in memory when that provider record is read. It is not a bank account.

## Run locally

MySQL or MariaDB must be reachable. Export `DATABASE_PASSWORD`, `OPERATOR_API_KEY`, and `MERCHANT_API_KEYS` before start. `.env.example` lists the variable names with empty values; the process does not load that file and it refuses empty or placeholder credentials. There is no built-in access secret.

```bash
npm install
npm run start:dev
```

The process listens on `0.0.0.0:43117`. Then, in another shell:

```bash
npm run example:fake
```

That script creates a `250.00` USD `ach_push` to Ethereum USDC transfer, walks the fake provider along `awaiting_funds → funds_received → payment_submitted → payment_processed`, and reconciles each step. The printed `settlementAuthority` is `local_fake_not_bridge`. The receipt hash `fake-not-a-chain-transaction` is not a chain transaction.

Operator status is at `/operator` on the local port. Use the local `OPERATOR_API_KEY` from your environment, not a value copied into a URL. OpenAPI is at `/docs`.

`docker compose up --build` is the same local fake stack with MySQL 8.4. It was not run here.

To point the HTTP client at sandbox later, set `BRIDGE_PROVIDER=bridge_http` and `BRIDGE_API_KEY` to a dashboard key that starts with `sk-test`. Leave `BRIDGE_ALLOW_PRODUCTION` false. Production requires all of `NODE_ENV=production`, `BRIDGE_ENVIRONMENT=production`, `BRIDGE_BASE_URL=https://api.bridge.xyz/v0`, `BRIDGE_ALLOW_PRODUCTION=true`, a non-demo operator key, a non-demo merchant key, and `BRIDGE_PROVIDER=bridge_http`. There is no environment variable that disables the host allowlist.

Copy `.env.example` if you want the variables in a file. The process does not load `.env` by itself. Export the variables before start.

## Tests actually run

On this workspace, against MariaDB 10.11.14, not against MySQL 8.4 and not against Bridge:

- `npx tsc -p tsconfig.json --noEmit` passed, and `npm run build` emitted `dist/`.
- `npx vitest run src test --fileParallelism=false` passed 12 files and 46 tests. They cover the compliance verifier, deposit-instruction redaction, the capability matrix, decimal strings, the route allowlist, the state machine, the RSA webhook verifier, the URL guard, retry policy, and the HTTP client against loopback fixtures. The database file checks idempotent create, fake advance plus reconciliation, signed webhooks, duplicates, stale sequences, a missing public key, Stellar and currency-enum rejections, a correlation string that is not an approval, and that bank account numbers are not stored.
- `npx tsx src/examples/fake-flow.ts` completed and printed `settlementAuthority: local_fake_not_bridge`, states `awaiting_funds → funds_received → payment_submitted → payment_processed`, normalized status `completed`, bank name `LOCAL FAKE PROVIDER — NOT A BANK`, and destination hash `fake-not-a-chain-transaction`.

The GitHub Actions workflow was not run. Docker was not available, so the Compose file was not started. No Bridge host was contacted.

## Threat model

Assets: transfer amounts and rails, Bridge customer ids, deposit instructions, the Bridge API key, the webhook public key, and merchant and operator bearer keys.

- The Bridge API key is read from the environment and sent only as the `Api-Key` header to an allowlisted HTTPS host. It is not written to MySQL, audit metadata, logs, or error bodies. Production hosts are refused unless the environment, the base URL, and `BRIDGE_ALLOW_PRODUCTION=true` all agree. Redirects are not followed. There is no configuration flag for an arbitrary base URL. Tests pass a loopback origin only as an in-process constructor argument, and that argument still rejects every host except `127.0.0.1`.
- Webhook trust is the endpoint RSA public key. The verifier uses the raw body, requires `t` and `v0`, decodes base64 strictly, checks a 10-minute past window from the Bridge guide, and also rejects timestamps more than five minutes in the future. That future bound is local policy. An empty key does not mean "accept". Duplicate `event_id` values hit a unique key and do not apply twice. A stale `event_sequence` or a backward happy-path state is stored as a result and does not change the transfer. Webhook bodies are hashed, not stored. `originator_name` and similar counterparty fields are not columns.
- Deposit instructions returned by the provider can contain bank account numbers. The adapter stores a redacted copy. Raw values are fetched for the owning merchant on demand and are not written on that read. No encryption mode is implemented; requesting encrypted storage refuses to boot.
- Merchant authentication is a shared bearer credential. It is not the Beekle end-user session. A compliance decision is accepted only from the configured verifier. The local demo verifier is an explicit allowlist and is not a compliance gate.
- Errors returned to clients use stable codes. Upstream Bridge messages, which can name identity fields, are dropped. Validation errors name fields, not rejected values.
- The operator cookie is `HttpOnly` and `SameSite=Lax`. It is a hash of the operator credential. It is not marked `Secure`, because the local page is HTTP. A TLS terminator in production should add `Secure`. Credentials are required at runtime; placeholder values are refused.
- The fake provider is the dangerous confusion. Its bank name is `LOCAL FAKE PROVIDER — NOT A BANK`, its transaction hash is `fake-not-a-chain-transaction`, and its settlement authority is `local_fake_not_bridge`. It cannot be selected when `NODE_ENV=production`.

## Production checklist

Do not treat this repository as deployed.

1. Obtain a Bridge developer account and confirm, in writing, the corridors, minimums, and endorsements Beekle will use. Delete or narrow the local allowlist to that set. The explorer snapshot is not that agreement.
2. Run sandbox with `sk-test` keys and a real webhook endpoint. Reconcile sandbox behavior with the two conflicting webhook-delivery statements before trusting delivery.
3. Set the webhook PEM from the created endpoint. Refuse to expose `POST /webhooks/bridge` until that is set. The process already blocks mutations without it.
4. Set operator and merchant credentials in a secret store. Keep the Bridge API key there too, not in an image, compose file, or shell history.
5. Put MySQL on a private network. Do not publish port 3306. Restrict the app to the orchestrator and to Bridge's webhook source.
6. Terminate TLS in front of the app. Bridge will not send webhooks to plain HTTP.
7. Leave `BRIDGE_ALLOW_PRODUCTION` unset until a controlled production transfer is intended. Production also refuses the fake provider.
8. Plan operations for `error`, `missing_return_policy`, `refund_failed`, and `compliance_hold`. This service does not clear them.
9. Retain idempotency rows. Do not retry a failed non-retryable create with the same key, and do not rotate the outbound key after Bridge's 24-hour window without a new business decision.
10. Review deposit-instruction storage. If those bank details must be encrypted, add that before production. It is not encrypted now.

## AWS and Contabo

Beekle's current platform is described as NestJS and MySQL on AWS and Contabo, with service placement still unconfirmed. This adapter is a single Node process and a MySQL database. It can run as a process on a virtual machine or as a container. Nothing here selects ECS, EKS, RDS, a region, a Contabo product, or a network path between them. Place the database where the process can reach it over a private address, and do not decide that from this repository.

## Architecture sketch

Corrections to the proposed diagram are in [docs/architecture-corrections.md](docs/architecture-corrections.md).
