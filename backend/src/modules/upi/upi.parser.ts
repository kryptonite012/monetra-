/**
 * Parser for UPI deep links / QR payloads (NPCI "upi://pay" format). Monetra
 * only reads the payload to pre-fill a record; it never initiates payments.
 */
export interface UpiPayload {
  payeeVpa: string;
  payeeName: string | null;
  amount: string | null;
  currency: string;
  note: string | null;
  transactionRef: string | null;
  merchantCode: string | null;
  merchantCategory: string | null;
}

const MCC_CATEGORY: Record<string, string> = {
  '5411': 'food.groceries',
  '5499': 'food.groceries',
  '5812': 'food.restaurants',
  '5814': 'food.delivery',
  '5541': 'transport.fuel',
  '5542': 'transport.fuel',
  '4121': 'transport.cab',
  '4111': 'transport.public',
  '4112': 'travel.trains',
  '4511': 'travel.flights',
  '7011': 'travel.hotels',
  '5912': 'health.medicines',
  '8062': 'health.doctor',
  '5651': 'shopping.clothing',
  '5732': 'shopping.electronics',
  '4814': 'utilities.mobile',
  '4900': 'utilities.electricity',
  '7832': 'entertainment.events',
  '8220': 'education.fees',
};

export function parseUpiPayload(raw: string): UpiPayload {
  const text = raw.trim();
  if (!/^upi:\/\/pay\?/i.test(text)) throw new Error('Not a UPI payment QR code');
  const params = new URLSearchParams(text.slice(text.indexOf('?') + 1));
  const payeeVpa = params.get('pa')?.trim().toLowerCase();
  if (!payeeVpa || !/^[a-z0-9._-]{2,128}@[a-z][a-z0-9.-]{1,64}$/.test(payeeVpa)) throw new Error('QR code has no valid payee UPI ID');
  const am = params.get('am');
  if (am && !/^\d{1,10}(\.\d{1,2})?$/.test(am)) throw new Error('QR code amount is invalid');
  const mc = params.get('mc');
  return {
    payeeVpa,
    payeeName: params.get('pn')?.trim() || null,
    amount: am || null,
    currency: (params.get('cu') || 'INR').toUpperCase(),
    note: params.get('tn')?.trim() || null,
    transactionRef: params.get('tr')?.trim() || params.get('tid')?.trim() || null,
    merchantCode: mc || null,
    merchantCategory: mc ? (MCC_CATEGORY[mc] ?? null) : null,
  };
}
