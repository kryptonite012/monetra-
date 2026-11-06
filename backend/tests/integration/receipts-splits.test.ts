import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { balanceOf, createAccount } from '../helpers/fixtures';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');

describe('receipts and expense splitting', () => {
  let user: TestUser;
  let bank: { id: string };
  let expenseId: string;

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    bank = await createAccount(user, { name: 'Bank', openingBalance: '10000' });
    const created = await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: '3000', description: 'Goa villa deposit', occurredOn: '2026-05-01' });
    if (created.status !== 201) throw new Error(`expense create failed: ${created.status} ${JSON.stringify(created.body)}`);
    expenseId = created.body.data.id;
  });
  afterAll(resetDatabase);

  it('accepts real images and PDFs and serves them back privately', async () => {
    const img = await api().post(`/api/v1/expenses/${expenseId}/receipts`).set(user.auth).attach('file', PNG, { filename: '../../etc/passwd.png', contentType: 'image/png' });
    expect(img.status).toBe(201);
    expect(img.body.data.originalFilename).toBe('passwd.png');
    const pdf = await api().post(`/api/v1/expenses/${expenseId}/receipts`).set(user.auth).attach('file', PDF, { filename: 'invoice.pdf', contentType: 'application/pdf' });
    expect(pdf.status).toBe(201);

    const file = await api().get(`/api/v1/receipts/${img.body.data.id}/file`).set(user.auth);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['content-security-policy']).toContain('sandbox');
    const other = await createUser();
    expect((await api().get(`/api/v1/receipts/${img.body.data.id}/file`).set(other.auth)).status).toBe(404);
    const detail = await api().get(`/api/v1/expenses/${expenseId}`).set(user.auth);
    expect(detail.body.data.receipts).toHaveLength(2);
  });

  it('rejects disguised and dangerous files', async () => {
    const fake = await api().post(`/api/v1/expenses/${expenseId}/receipts`).set(user.auth).attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' });
    expect(fake.status).toBe(422);
    const mismatch = await api().post(`/api/v1/expenses/${expenseId}/receipts`).set(user.auth).attach('file', PDF, { filename: 'x.png', contentType: 'image/png' });
    expect(mismatch.status).toBe(422);
    const scripted = Buffer.from('%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>');
    const js = await api().post(`/api/v1/expenses/${expenseId}/receipts`).set(user.auth).attach('file', scripted, { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(js.status).toBe(422);
  });

  it('splits equally, tracks receivables and records settlements', async () => {
    const split = await api()
      .post(`/api/v1/expenses/${expenseId}/splits`)
      .set(user.auth)
      .send({ method: 'equal', participants: [{ name: 'Kabir' }, { name: 'Ananya' }] });
    expect(split.body.data).toMatchObject({ yourShare: '1000.00', owedToYou: '2000.00' });
    const owed = await api().get('/api/v1/splits?settled=false').set(user.auth);
    expect(owed.body.data.totalOutstanding).toBe('2000.00');
    expect(owed.body.data.byPerson.map((p: { name: string }) => p.name).sort()).toEqual(['Ananya', 'Kabir']);

    const kabir = owed.body.data.items.find((s: { participantName: string }) => s.participantName === 'Kabir');
    const settle = await api().post(`/api/v1/splits/${kabir.id}/settle`).set(user.auth).send({ accountId: bank.id, settledOn: '2026-05-04' });
    expect(settle.body.data.isSettled).toBe(true);
    expect(await balanceOf(user, bank.id)).toBe('8000.00');
    expect((await api().post(`/api/v1/expenses/${expenseId}/splits`).set(user.auth).send({ participants: [{ name: 'X' }] })).status).toBe(409);
  });

  it('validates exact splits', async () => {
    const id = (await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: '900', description: 'Dinner' })).body.data.id;
    const over = await api().post(`/api/v1/expenses/${id}/splits`).set(user.auth).send({ method: 'exact', participants: [{ name: 'A', shareAmount: '1000' }] });
    expect(over.status).toBe(422);
    const ok = await api().post(`/api/v1/expenses/${id}/splits`).set(user.auth).send({ method: 'exact', participants: [{ name: 'A', shareAmount: '400' }, { name: 'B', shareAmount: '250.50' }] });
    expect(ok.body.data).toMatchObject({ yourShare: '249.50', owedToYou: '650.50' });
  });
});
