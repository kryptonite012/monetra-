import { z } from 'zod';
import { db, withTransaction } from '../../db/knex';
import { unprocessable } from '../../lib/errors';
import { apiRouter, envelope, isoDate, optionalText, pageMeta } from '../../lib/http';
import { dec, money, positiveMoney } from '../../lib/money';
import { guarded } from '../../lib/sensitive';
import { audit } from '../audit/audit.service';
import { categoryBySlug } from '../categories/categories.service';
import { postTransaction, serializeTransaction } from '../transactions/ledger.service';
import { listTransactions, transactionFilters } from '../transactions/transactions.query';
import { parseUpiPayload } from './upi.parser';

const r = apiRouter('/upi', 'UPI & digital payments');

const vpa = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,128}@[a-z][a-z0-9.-]{1,64}$/, 'Enter a valid UPI ID');

r.post('/parse-qr', {
  summary: 'Read a UPI QR payload to pre-fill a payment record (does not pay)',
  body: z.object({ payload: z.string().min(10).max(2000) }),
  handler: async ({ body }) => {
    try {
      const parsed = parseUpiPayload(body.payload);
      const suggestedCategoryId = parsed.merchantCategory ? await categoryBySlug(parsed.merchantCategory) : null;
      return { ...parsed, suggestedCategoryId };
    } catch (err) {
      throw unprocessable((err as Error).message);
    }
  },
});

r.post('/transactions', {
  summary: 'Record a UPI payment you made or received',
  description: 'Monetra records UPI activity for tracking only. It never asks for or stores your UPI PIN or OTPs.',
  status: 201,
  body: guarded(
    z.object({
      accountId: z.uuid(),
      direction: z.enum(['outgoing', 'incoming']),
      amount: positiveMoney,
      occurredOn: isoDate.default(() => new Date().toISOString().slice(0, 10)),
      counterpartyVpa: vpa.optional(),
      counterpartyName: optionalText(120),
      upiRef: z.string().trim().regex(/^[A-Za-z0-9]{6,35}$/, 'UPI reference should be the 12-digit UTR or transaction id').optional(),
      paymentMethodId: z.uuid().nullish(),
      categoryId: z.uuid().nullish(),
      note: optionalText(500),
      qrPayload: z.string().max(2000).optional(),
    }),
  ),
  handler: async ({ user, body, req }) => {
    if (body.paymentMethodId) {
      const pm = await db('payment_methods').where({ id: body.paymentMethodId, user_id: user.id }).first('type');
      if (pm && pm.type !== 'upi') throw unprocessable('Choose a UPI payment method', { field: 'paymentMethodId' });
    }
    let qr = null;
    if (body.qrPayload) {
      try {
        qr = parseUpiPayload(body.qrPayload);
      } catch (err) {
        throw unprocessable((err as Error).message, { field: 'qrPayload' });
      }
    }
    const counterpartyVpa = body.counterpartyVpa ?? qr?.payeeVpa;
    const name = body.counterpartyName ?? qr?.payeeName ?? counterpartyVpa ?? 'UPI payment';
    let categoryId = body.categoryId ?? null;
    if (!categoryId && qr?.merchantCategory && body.direction === 'outgoing') categoryId = await categoryBySlug(qr.merchantCategory);

    const txn = await withTransaction((trx) =>
      postTransaction(
        {
          userId: user.id,
          accountId: body.accountId,
          kind: body.direction === 'outgoing' ? 'expense' : 'income',
          amount: body.amount,
          occurredOn: body.occurredOn,
          description: `${body.direction === 'outgoing' ? 'UPI to' : 'UPI from'} ${name}`,
          merchantName: body.direction === 'outgoing' ? name : null,
          counterparty: counterpartyVpa ?? null,
          reference: body.upiRef ?? qr?.transactionRef ?? null,
          paymentMethodId: body.paymentMethodId ?? null,
          categoryId,
          notes: body.note ?? qr?.note ?? null,
          metadata: { channel: 'upi', ...(qr ? { qr: { merchantCode: qr.merchantCode, payeeVpa: qr.payeeVpa } } : {}) },
        },
        trx,
      ),
    );
    await audit({ action: 'upi.recorded', req, entityType: 'transaction', entityId: txn.id, metadata: { direction: body.direction } });
    return serializeTransaction(txn);
  },
});

r.get('/transactions', {
  summary: 'UPI transactions (paid with a UPI method or recorded through the UPI module)',
  query: transactionFilters,
  handler: async ({ user, query }) => {
    const { rows, total, totals } = await listTransactions(user.id, { ...query, upiOnly: true });
    return envelope(rows.map(serializeTransaction), { ...pageMeta(query, total), totals });
  },
});

r.get('/summary', {
  summary: 'Incoming vs outgoing UPI totals and top counterparties',
  query: z.object({ from: isoDate.optional(), to: isoDate.optional() }),
  handler: async ({ user, query }) => {
    const base = db('transactions as t')
      .leftJoin('payment_methods as p', 'p.id', 't.payment_method_id')
      .where('t.user_id', user.id)
      .where('t.status', 'posted')
      .whereNot('t.kind', 'reversal')
      .where((q) => q.where('p.type', 'upi').orWhereRaw(`t.metadata->>'channel' = 'upi'`));
    if (query.from) base.where('t.occurred_on', '>=', query.from);
    if (query.to) base.where('t.occurred_on', '<=', query.to);
    const [totals] = await base
      .clone()
      .select(
        db.raw(`COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'credit'), 0) AS incoming`),
        db.raw(`COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'debit'), 0) AS outgoing`),
        db.raw(`COUNT(*) FILTER (WHERE t.direction = 'credit')::int AS incoming_count`),
        db.raw(`COUNT(*) FILTER (WHERE t.direction = 'debit')::int AS outgoing_count`),
      );
    const counterparties = await base
      .clone()
      .whereNotNull('t.counterparty')
      .groupBy('t.counterparty')
      .select('t.counterparty', db.raw('SUM(t.amount) AS total'), db.raw('COUNT(*)::int AS count'))
      .orderBy('total', 'desc')
      .limit(5);
    const byMethod = await base
      .clone()
      .groupBy('p.label')
      .select(db.raw(`COALESCE(p.label, 'Unassigned') AS method`), db.raw('SUM(t.amount) AS total'), db.raw('COUNT(*)::int AS count'));
    return {
      incoming: money(totals.incoming),
      outgoing: money(totals.outgoing),
      net: money(dec(totals.incoming).minus(totals.outgoing)),
      incomingCount: totals.incomingCount,
      outgoingCount: totals.outgoingCount,
      topCounterparties: counterparties.map((c: any) => ({ ...c, total: money(c.total) })),
      byPaymentMethod: byMethod.map((m: any) => ({ ...m, total: money(m.total) })),
    };
  },
});

export default r.router;
