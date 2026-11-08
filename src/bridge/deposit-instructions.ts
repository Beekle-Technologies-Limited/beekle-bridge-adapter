const SENSITIVE_BANK_INSTRUCTION_FIELDS = [
  'bank_account_number',
  'bank_routing_number',
  'iban',
  'bic',
  'clabe',
  'account_number',
  'bank_beneficiary_name',
  'bank_beneficiary_address',
  'bank_address',
  'br_code',
] as const;

const PERSISTABLE_INSTRUCTION_FIELDS = new Set([
  'payment_rail',
  'amount',
  'currency',
  'deposit_message',
  'bank_name',
  'from_address',
  'to_address',
]);

export function redactDepositInstructions(input: Record<string, string> | null): Record<string, string> | null {
  if (!input) return null;
  const persisted: Record<string, string> = {};
  const withheld: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (!PERSISTABLE_INSTRUCTION_FIELDS.has(key) || isSensitiveBankField(key)) {
      withheld.push(key);
      continue;
    }
    persisted[key] = value;
  }
  if (withheld.length > 0) persisted.sensitive_fields_withheld = [...new Set(withheld)].sort().join(',');
  return Object.keys(persisted).length > 0 ? persisted : null;
}

export function sensitiveBankFieldNames(input: Record<string, string> | null): string[] {
  if (!input) return [];
  return Object.keys(input).filter((key) => isSensitiveBankField(key)).sort();
}

function isSensitiveBankField(key: string): boolean {
  return (SENSITIVE_BANK_INSTRUCTION_FIELDS as readonly string[]).includes(key);
}
