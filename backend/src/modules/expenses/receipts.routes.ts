import fs from 'node:fs/promises';
import { db } from '../../db/knex';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { apiRouter, idParams } from '../../lib/http';
import { logger } from '../../lib/logger';
import { receiptUpload, safeFilename, storeUserFile, userFilePath } from '../../lib/uploads';
import { audit } from '../audit/audit.service';

const MAX_RECEIPTS_PER_EXPENSE = 5;

export const expenseReceipts = apiRouter('/expenses', 'Expenses');

expenseReceipts.post('/:id/receipts', {
  summary: 'Attach a receipt (JPEG, PNG, WEBP or PDF; validated by content)',
  description: 'multipart/form-data with a single field named "file".',
  status: 201,
  params: idParams,
  middleware: [receiptUpload.single('file')],
  handler: async ({ user, params, req }) => {
    const expense = await db('expense_records').where({ id: params.id, user_id: user.id }).whereNull('deleted_at').first('id');
    if (!expense) throw notFound('Expense');
    if (!req.file) throw unprocessable('Attach a file in the "file" field');
    const [{ count }] = await db('receipts').where({ expense_record_id: params.id }).count({ count: '*' });
    if (Number(count) >= MAX_RECEIPTS_PER_EXPENSE) throw conflict(`An expense can have at most ${MAX_RECEIPTS_PER_EXPENSE} receipts`);
    const stored = await storeUserFile(user.id, req.file);
    const [row] = await db('receipts')
      .insert({
        user_id: user.id,
        expense_record_id: params.id,
        original_filename: safeFilename(req.file.originalname),
        stored_filename: stored.storedFilename,
        mime_type: stored.mimeType,
        size_bytes: stored.sizeBytes,
        sha256: stored.sha256,
      })
      .returning(['id', 'original_filename', 'mime_type', 'size_bytes', 'sha256', 'uploaded_at']);
    await audit({ action: 'receipt.uploaded', req, entityType: 'receipt', entityId: row.id, metadata: { expenseId: params.id, size: stored.sizeBytes } });
    return row;
  },
});

export const receipts = apiRouter('/receipts', 'Expenses');

receipts.get('/:id/file', {
  summary: 'Download a receipt file',
  params: idParams,
  raw: true,
  handler: async ({ user, params, res }) => {
    const row = await db('receipts').where({ id: params.id, user_id: user.id }).first();
    if (!row) throw notFound('Receipt');
    const data = await fs.readFile(userFilePath(user.id, row.storedFilename)).catch(() => null);
    if (!data) throw notFound('Receipt file');
    const disposition = row.mimeType.startsWith('image/') ? 'inline' : 'attachment';
    res.setHeader('Content-Type', row.mimeType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${row.originalFilename.replace(/"/g, '')}"`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(data);
  },
});

receipts.delete('/:id', {
  summary: 'Delete a receipt',
  params: idParams,
  handler: async ({ user, params, req }) => {
    const row = await db('receipts').where({ id: params.id, user_id: user.id }).first();
    if (!row) throw notFound('Receipt');
    await db('receipts').where({ id: params.id }).delete();
    await fs.rm(userFilePath(user.id, row.storedFilename), { force: true }).catch((err) => logger.warn({ err }, 'receipt file removal failed'));
    await audit({ action: 'receipt.deleted', req, entityType: 'receipt', entityId: params.id });
    return undefined;
  },
});
