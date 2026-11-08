export interface ProviderTransfer {
  id: string;
  state: string;
  amount: string;
  currency: string | null;
  developerFee: string | null;
  onBehalfOf: string;
  clientReferenceId: string | null;
  source: {
    paymentRail: string;
    currency: string;
    fromAddress: string | null;
  };
  destination: {
    paymentRail: string;
    currency: string;
    toAddress: string | null;
    externalAccountId: string | null;
  };
  depositInstructions: Record<string, string> | null;
  receipt: Record<string, string> | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CreateProviderTransfer {
  outboundIdempotencyKey: string;
  amount: string;
  onBehalfOf: string;
  developerFee: string | null;
  clientReferenceId: string | null;
  source: {
    paymentRail: string;
    currency: string;
    fromAddress?: string;
    bridgeWalletId?: string;
    senderReturnUrl?: string;
  };
  destination: {
    paymentRail: string;
    currency: string;
    toAddress?: string;
    externalAccountId?: string;
    reference?: string;
  };
  dryRun?: boolean;
}

export interface ProviderRouteCheck {
  state: 'valid' | 'invalid';
  notes: string[];
}

export class ProviderCallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
