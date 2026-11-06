import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { createAccount } from '../helpers/fixtures';

describe('reports', () => {
  let user: TestUser;
  let bank: { id: string };
  beforeAll(async () => {
    await resetDatabase();
    user = await createUser({ fullName: 'Report Owner' });
    bank = await createAccount(user, { name: 'Bank', openingBalance: '10000', openingDate: '2026-01-01' });
    await api().post('/api/v1/income').set(user.auth).send({ accountId: bank.id, sourceType: 'salary', grossAmount: '60000', taxDeducted: '5000', occurredOn: '2026-03-01' });
    await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: '1500', description: 'Swiggy', occurredOn: '2026-03-05' });
    await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: '12000', description: 'LIC premium', occurredOn: '2026-03-07', isTaxDeductible: true, taxSection: '80C' });
  });
  afterAll(resetDatabase);

  it('previews a monthly statement as JSON', async () => {
    const res = await api().get('/api/v1/reports/preview?reportType=monthly_statement&periodStart=2026-03-01&periodEnd=2026-03-31').set(user.auth);
    expect(res.body.data.summary[0]).toMatchObject({ label: 'Total income', value: '55000.00' });
    expect(res.body.data.sections.find((s: { title: string }) => s.title === 'Transactions').rows).toHaveLength(3);
  });

  it('generates and downloads PDF, Excel and CSV files', async () => {
    for (const format of ['pdf', 'xlsx', 'csv']) {
      const created = await api().post('/api/v1/reports').set(user.auth).send({ reportType: 'income_expense', periodStart: '2026-01-01', periodEnd: '2026-03-31', format });
      expect(created.status).toBe(201);
      expect(created.body.data.status).toBe('ready');
      const file = await api().get(`/api/v1/reports/${created.body.data.id}/download`).set(user.auth).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(file.status).toBe(200);
      expect(file.headers['content-disposition']).toContain(`.${format}`);
      if (format === 'pdf') expect((file.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      if (format === 'xlsx') expect((file.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    }
    const list = await api().get('/api/v1/reports').set(user.auth);
    expect(list.body.meta.total).toBe(3);
  });

  it('summarises tax data with TDS and deductions', async () => {
    const res = await api().get('/api/v1/reports/preview?reportType=tax_summary&periodStart=2025-04-01&periodEnd=2026-03-31').set(user.auth);
    const summary = Object.fromEntries(res.body.data.summary.map((s: { label: string; value: string }) => [s.label, s.value]));
    expect(summary['Tax deducted at source (TDS)']).toBe('5000.00');
    expect(summary['Deductible expenses recorded']).toBe('12000.00');
    expect(res.body.data.sections[1].rows[0]).toMatchObject({ section: '80C', total: '12000.00' });
  });

  it('validates account statements and isolates files', async () => {
    const missing = await api().post('/api/v1/reports').set(user.auth).send({ reportType: 'account_statement', periodStart: '2026-03-01', periodEnd: '2026-03-31', format: 'csv' });
    expect(missing.status).toBe(422);
    const ok = await api().post('/api/v1/reports').set(user.auth).send({ reportType: 'account_statement', accountId: bank.id, periodStart: '2026-03-01', periodEnd: '2026-03-31', format: 'csv' });
    const other = await createUser();
    expect((await api().get(`/api/v1/reports/${ok.body.data.id}/download`).set(other.auth)).status).toBe(404);
  });
});
