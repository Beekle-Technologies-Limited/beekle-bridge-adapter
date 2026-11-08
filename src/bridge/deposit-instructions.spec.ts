import { redactDepositInstructions, sensitiveBankFieldNames } from './deposit-instructions.js';

describe('deposit instruction redaction', () => {
  it('drops bank account material and keeps a minimal payment reference', () => {
    const redacted = redactDepositInstructions({
      payment_rail: 'ach_push',
      amount: '75.0',
      currency: 'usd',
      deposit_message: 'BVI7depositmessage',
      bank_name: 'Bank name',
      bank_address: 'Bank address',
      bank_routing_number: '123456789',
      bank_account_number: '1234567890',
      bank_beneficiary_name: 'Bank beneficiary',
      bank_beneficiary_address: 'Bank beneficiary address',
      originator_name: 'Jane Q Customer',
    });
    expect(redacted?.bank_account_number).toBeUndefined();
    expect(redacted?.bank_routing_number).toBeUndefined();
    expect(redacted?.bank_beneficiary_name).toBeUndefined();
    expect(JSON.stringify(redacted)).not.toContain('1234567890');
    expect(JSON.stringify(redacted)).not.toContain('Jane Q Customer');
    expect(redacted?.payment_rail).toBe('ach_push');
    expect(redacted?.amount).toBe('75.0');
    expect(redacted?.deposit_message).toBe('BVI7depositmessage');
    expect(redacted?.bank_name).toBe('Bank name');
    expect(redacted?.sensitive_fields_withheld).toContain('bank_account_number');
    expect(sensitiveBankFieldNames(redacted ?? null)).toEqual([]);
  });
});
