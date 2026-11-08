import { compareDecimal, isDecimalString } from './decimal-string.js';

describe('decimal strings', () => {
  it('accepts the shapes Bridge documents and rejects floats and exponents', () => {
    expect(isDecimalString('100.25')).toBe(true);
    expect(isDecimalString('0.1')).toBe(true);
    expect(isDecimalString('1.234567')).toBe(true);
    expect(isDecimalString('75.0')).toBe(true);
    expect(isDecimalString('0')).toBe(true);
    expect(isDecimalString('01.2')).toBe(false);
    expect(isDecimalString('1e2')).toBe(false);
    expect(isDecimalString('-1.00')).toBe(false);
    expect(isDecimalString('1.')).toBe(false);
    expect(isDecimalString('')).toBe(false);
  });

  it('compares without binary floating point', () => {
    expect(compareDecimal('0.10', '0.1')).toBe(0);
    expect(compareDecimal('10', '9.99')).toBe(1);
    expect(compareDecimal('1.234567', '1.234568')).toBe(-1);
    expect(compareDecimal('100.25', '100.25')).toBe(0);
  });
});
