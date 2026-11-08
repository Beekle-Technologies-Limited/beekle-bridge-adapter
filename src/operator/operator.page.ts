import { capabilitySummary } from '../capabilities/route-policy.js';
import { TransferView } from '../transfers/transfers.service.js';

export interface OperatorPageModel {
  provider: string;
  environment: string;
  productionCallsEnabled: boolean;
  webhookVerification: 'configured' | 'blocked';
  database: 'up' | 'down';
  authenticated: boolean;
  loginError: boolean;
  transfers: TransferView[];
  orchestratedPairCount: number;
  stellarPairsBlocked: number;
  explorerPairCount: number;
}

export function renderOperatorPage(model: OperatorPageModel): string {
  const summary = capabilitySummary();
  const banner = model.provider === 'fake'
    ? 'Local fake provider. No Bridge API call is made. No bank or chain settlement occurs.'
    : 'HTTP provider is selected. A successful response is still not a Beekle commercial corridor, and production calls stay off unless every production flag agrees.';
  const webhook = model.webhookVerification === 'configured'
    ? 'Webhook signatures are verified with the configured RSA public key.'
    : 'Webhook mutation is blocked until BRIDGE_WEBHOOK_PUBLIC_KEY is set. Requests are not accepted permissively.';
  const rows = model.transfers
    .map(
      (transfer) => `<tr>
        <td>${esc(transfer.id)}</td>
        <td>${esc(transfer.amount)} ${esc(transfer.amountCurrency)}</td>
        <td>${esc(transfer.source.paymentRail)}/${esc(transfer.source.currency)} → ${esc(transfer.destination.paymentRail)}/${esc(transfer.destination.currency)}</td>
        <td>${esc(transfer.providerState ?? '')}</td>
        <td>${esc(transfer.normalizedStatus)}</td>
        <td>${esc(transfer.settlementAuthority)}</td>
      </tr>`,
    )
    .join('');
  const transferSection = model.authenticated
    ? `<table>
        <thead><tr><th>Transfer</th><th>Amount</th><th>Route</th><th>Provider state</th><th>Normalized</th><th>Settlement authority</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6">No transfers yet.</td></tr>'}</tbody>
      </table>
      <form method="post" action="/operator/logout"><button type="submit">Sign out</button></form>`
    : `<form method="post" action="/operator/session">
        <label>Operator key <input type="password" name="apiKey" autocomplete="current-password" required></label>
        <button type="submit">Open status</button>
        ${model.loginError ? '<p class="error">Operator key was rejected.</p>' : ''}
      </form>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Beekle Bridge adapter status</title>
  <style>
    body { margin: 0; font: 15px/1.45 "IBM Plex Sans", "Segoe UI", sans-serif; background: #f4f1ea; color: #1c2430; }
    header { background: #142033; color: #f7f4ee; padding: 20px 24px; }
    main { max-width: 1100px; margin: 0 auto; padding: 20px; }
    .banner { background: #fff4cc; border: 1px solid #e2c56a; padding: 12px 14px; margin: 12px 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .card { background: white; border: 1px solid #ddd4c4; padding: 12px; }
    .label { color: #5c6778; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    table { width: 100%; border-collapse: collapse; background: white; margin-top: 16px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #eee; font-size: 13px; vertical-align: top; }
    button { background: #142033; color: white; border: 0; padding: 8px 12px; }
    .error { color: #8d1d1d; }
    form { margin-top: 16px; }
  </style>
</head>
<body>
  <header>
    <strong>Beekle Bridge adapter</strong>
    <div>Operator status. Route B is not live settlement.</div>
  </header>
  <main>
    <p class="banner">${esc(banner)}</p>
    <p class="banner">${esc(webhook)}</p>
    <section class="grid">
      <article class="card"><div class="label">Provider</div><strong>${esc(model.provider)}</strong></article>
      <article class="card"><div class="label">Bridge environment</div><strong>${esc(model.environment)}</strong></article>
      <article class="card"><div class="label">Production calls</div><strong>${model.productionCallsEnabled ? 'enabled' : 'disabled'}</strong></article>
      <article class="card"><div class="label">Database</div><strong>${esc(model.database)}</strong></article>
      <article class="card"><div class="label">Orchestrated explorer pairs</div><strong>${summary.orchestratedPairCount}</strong></article>
      <article class="card"><div class="label">Stellar pairs blocked</div><strong>${summary.stellarPairsBlocked}</strong></article>
      <article class="card"><div class="label">Explorer pairs pinned</div><strong>${summary.explorerPairCount}</strong></article>
    </section>
    <p>Account availability stays unknown. Currencies absent from the examined create-transfer enum are not sent. Stellar is listed by that enum and is not orchestrated here.</p>
    ${transferSection}
  </main>
</body>
</html>`;
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
