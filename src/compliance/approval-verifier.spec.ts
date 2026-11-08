import { AppError } from '../common/errors.js';
import {
  createComplianceVerifier,
  LocalDemoApprovalVerifier,
  UnconfiguredComplianceVerifier,
} from './approval-verifier.js';

const request = {
  merchantId: 'demo-merchant',
  decisionRef: 'dec_local_demo',
  onBehalfOf: 'cust_local_demo',
  amount: '250.00',
  amountCurrency: 'usd',
  sourceRail: 'ach_push',
  sourceCurrency: 'usd',
  destinationRail: 'ethereum',
  destinationCurrency: 'usdc',
};

describe('compliance approval verifier', () => {
  it('accepts only an explicit local demo ref and labels the result as not a compliance gate', async () => {
    const verifier = new LocalDemoApprovalVerifier(new Set(['dec_local_demo']));
    await expect(verifier.verify(request)).resolves.toEqual({
      decisionRef: 'dec_local_demo',
      positive: true,
      verifier: 'local_demo_not_a_compliance_gate',
    });
    await expect(verifier.verify({ ...request, decisionRef: 'dec_just_a_correlation' })).rejects.toMatchObject({
      status: 403,
      code: 'compliance_decision_not_approved',
    });
  });

  it('fails closed when no trusted verifier is configured', async () => {
    const verifier = new UnconfiguredComplianceVerifier();
    await expect(verifier.verify(request)).rejects.toBeInstanceOf(AppError);
    await expect(verifier.verify(request)).rejects.toMatchObject({
      code: 'compliance_verifier_unconfigured',
    });
  });

  it('selects the unconfigured verifier for real-provider mode', async () => {
    const verifier = createComplianceVerifier({ mode: 'unconfigured', localDemoApprovalRefs: ['dec_local_demo'] });
    expect(verifier.mode).toBe('unconfigured');
    await expect(verifier.verify(request)).rejects.toMatchObject({ code: 'compliance_verifier_unconfigured' });
  });
});
