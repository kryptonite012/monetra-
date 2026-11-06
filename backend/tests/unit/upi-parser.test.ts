import { describe, expect, it } from 'vitest';
import { parseUpiPayload } from '../../src/modules/upi/upi.parser';

describe('UPI QR parser', () => {
  it('reads merchant QR payloads', () => {
    const p = parseUpiPayload('upi://pay?pa=FreshMart@okaxis&pn=Fresh%20Mart&am=432.50&cu=INR&tn=Order%2042&tr=FM42&mc=5411');
    expect(p).toEqual({
      payeeVpa: 'freshmart@okaxis',
      payeeName: 'Fresh Mart',
      amount: '432.50',
      currency: 'INR',
      note: 'Order 42',
      transactionRef: 'FM42',
      merchantCode: '5411',
      merchantCategory: 'food.groceries',
    });
  });

  it('rejects non-UPI and malformed payloads', () => {
    expect(() => parseUpiPayload('https://example.com')).toThrow(/Not a UPI/);
    expect(() => parseUpiPayload('upi://pay?pn=NoVpa')).toThrow(/payee/);
    expect(() => parseUpiPayload('upi://pay?pa=shop@okhdfc&am=12,00')).toThrow(/amount/);
  });
});
