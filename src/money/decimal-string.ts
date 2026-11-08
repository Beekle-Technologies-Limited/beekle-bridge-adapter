const DECIMAL = /^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/;

export function isDecimalString(value: string): boolean {
  return DECIMAL.test(value);
}

export function assertPositiveDecimal(value: string, field: string): string {
  if (!isDecimalString(value) || compareDecimal(value, '0') <= 0) {
    throw new Error(`${field} must be a positive decimal string`);
  }
  return value;
}

export function assertNonNegativeDecimal(value: string, field: string): string {
  if (!isDecimalString(value) || compareDecimal(value, '0') < 0) {
    throw new Error(`${field} must be a non-negative decimal string`);
  }
  return value;
}

export function compareDecimal(left: string, right: string): number {
  if (!isDecimalString(left) || !isDecimalString(right)) {
    throw new Error('compareDecimal requires canonical decimal strings');
  }
  const [leftInt, leftFrac = ''] = left.split('.');
  const [rightInt, rightFrac = ''] = right.split('.');
  const intCompare = compareInteger(leftInt, rightInt);
  if (intCompare !== 0) return intCompare;
  const scale = Math.max(leftFrac.length, rightFrac.length);
  const a = leftFrac.padEnd(scale, '0');
  const b = rightFrac.padEnd(scale, '0');
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

function compareInteger(left: string, right: string): number {
  const a = left.replace(/^0+/, '') || '0';
  const b = right.replace(/^0+/, '') || '0';
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  if (a === b) return 0;
  return a > b ? 1 : -1;
}
