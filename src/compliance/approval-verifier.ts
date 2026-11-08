import { AppError } from '../common/errors.js';

export interface ComplianceApprovalRequest {
  merchantId: string;
  decisionRef: string;
  onBehalfOf: string;
  amount: string;
  amountCurrency: string;
  sourceRail: string;
  sourceCurrency: string;
  destinationRail: string;
  destinationCurrency: string;
}

export interface PositiveComplianceDecision {
  decisionRef: string;
  positive: true;
  verifier: 'local_demo_not_a_compliance_gate' | 'trusted_compliance_gate';
}

/**
 * A positive decision is the only create authorization. A non-empty
 * correlation string is not a decision.
 */
export interface ComplianceApprovalVerifier {
  readonly mode: 'unconfigured' | 'local_demo';
  verify(request: ComplianceApprovalRequest): Promise<PositiveComplianceDecision>;
}

export const COMPLIANCE_VERIFIER = Symbol('COMPLIANCE_VERIFIER');

export class UnconfiguredComplianceVerifier implements ComplianceApprovalVerifier {
  readonly mode = 'unconfigured' as const;

  verify(_request: ComplianceApprovalRequest): Promise<PositiveComplianceDecision> {
    return Promise.reject(
      new AppError(
        403,
        'compliance_verifier_unconfigured',
        'No trusted compliance verifier is configured. The transfer was not submitted to the provider.',
      ),
    );
  }
}

/**
 * Explicit allowlist for the local fake demo. It is not the Beekle compliance
 * gate and it must not be selected for the real HTTP provider.
 */
export class LocalDemoApprovalVerifier implements ComplianceApprovalVerifier {
  readonly mode = 'local_demo' as const;

  constructor(private readonly allowedDecisionRefs: ReadonlySet<string>) {}

  verify(request: ComplianceApprovalRequest): Promise<PositiveComplianceDecision> {
    if (!this.allowedDecisionRefs.has(request.decisionRef)) {
      return Promise.reject(
        new AppError(
          403,
          'compliance_decision_not_approved',
          'This decision reference is not an explicit local demo approval. A correlation string is not an approval.',
        ),
      );
    }
    return Promise.resolve({
      decisionRef: request.decisionRef,
      positive: true,
      verifier: 'local_demo_not_a_compliance_gate',
    });
  }
}

export function createComplianceVerifier(input: {
  mode: 'unconfigured' | 'local_demo';
  localDemoApprovalRefs: readonly string[];
}): ComplianceApprovalVerifier {
  if (input.mode === 'unconfigured') return new UnconfiguredComplianceVerifier();
  return new LocalDemoApprovalVerifier(new Set(input.localDemoApprovalRefs));
}
