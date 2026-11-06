import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../../config/env';
import { db } from '../../db/knex';
import { notFound, unprocessable } from '../../lib/errors';
import { apiRouter, envelope, idParams, isoDate, pageMeta, paginationQuery } from '../../lib/http';
import { logger } from '../../lib/logger';
import { requireOwnedRef } from '../../lib/ownership';
import { audit } from '../audit/audit.service';
import { buildReport, REPORT_TITLES, type ReportType } from './report.builders';
import { renderCsv, renderPdf, renderXlsx } from './renderers';

const r = apiRouter('/reports', 'Reports');

const TYPES = Object.keys(REPORT_TITLES) as [ReportType, ...ReportType[]];
const CONTENT_TYPES = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8' } as const;

const reportQuery = z
  .object({ reportType: z.enum(TYPES), periodStart: isoDate, periodEnd: isoDate, accountId: z.uuid().optional(), loanId: z.uuid().optional() })
  .refine((v) => v.periodStart <= v.periodEnd, 'periodStart must be on or before periodEnd')
  .refine((v) => v.reportType !== 'account_statement' || v.accountId, { message: 'Choose an account for an account statement', path: ['accountId'] });

function reportPath(userId: string, filename: string) {
  if (!/^[0-9a-f-]{36}\.(pdf|xlsx|csv)$/.test(filename)) throw new Error('Invalid report filename');
  return path.resolve(config.REPORT_DIR, userId, filename);
}

r.get('/types', {
  summary: 'Available report types',
  handler: () => TYPES.map((t) => ({ type: t, title: REPORT_TITLES[t] })),
});

r.get('/preview', {
  summary: 'Report data as JSON for on-screen viewing',
  query: reportQuery,
  handler: async ({ user, query }) => {
    await requireOwnedRef('accounts', query.accountId, user.id, 'accountId');
    await requireOwnedRef('loans', query.loanId, user.id, 'loanId');
    return buildReport({ userId: user.id, type: query.reportType, from: query.periodStart, to: query.periodEnd, accountId: query.accountId, loanId: query.loanId });
  },
});

r.post('/', {
  summary: 'Generate a report file (PDF, Excel or CSV)',
  status: 201,
  body: z.intersection(reportQuery, z.object({ format: z.enum(['pdf', 'xlsx', 'csv']) })),
  handler: async ({ user, body, req }) => {
    await requireOwnedRef('accounts', body.accountId, user.id, 'accountId');
    await requireOwnedRef('loans', body.loanId, user.id, 'loanId');
    const [row] = await db('financial_reports')
      .insert({
        user_id: user.id,
        report_type: body.reportType,
        period_start: body.periodStart,
        period_end: body.periodEnd,
        format: body.format,
        title: REPORT_TITLES[body.reportType],
        parameters: JSON.stringify({ accountId: body.accountId, loanId: body.loanId }),
      })
      .returning('*');
    try {
      const doc = await buildReport({ userId: user.id, type: body.reportType, from: body.periodStart, to: body.periodEnd, accountId: body.accountId, loanId: body.loanId });
      const buffer = body.format === 'pdf' ? await renderPdf(doc) : body.format === 'xlsx' ? await renderXlsx(doc) : renderCsv(doc);
      const filename = `${row.id}.${body.format}`;
      const target = reportPath(user.id, filename);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, buffer, { mode: 0o600 });
      const [ready] = await db('financial_reports')
        .where({ id: row.id })
        .update({ status: 'ready', stored_filename: filename, size_bytes: buffer.length, title: doc.title, completed_at: db.fn.now() })
        .returning('*');
      await audit({ action: 'report.generated', req, entityType: 'report', entityId: row.id, metadata: { type: body.reportType, format: body.format } });
      return ready;
    } catch (err) {
      logger.error({ err, reportId: row.id }, 'report generation failed');
      await db('financial_reports').where({ id: row.id }).update({ status: 'failed', error: (err as Error).message.slice(0, 500), completed_at: db.fn.now() });
      throw unprocessable('The report could not be generated. Please check the parameters and try again.');
    }
  },
});

r.get('/', {
  summary: 'Previously generated reports',
  query: paginationQuery,
  handler: async ({ user, query }) => {
    const base = db('financial_reports').where({ user_id: user.id });
    const [{ count }] = await base.clone().count({ count: '*' });
    const rows = await base.clone().orderBy('created_at', 'desc').limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    return envelope(rows, pageMeta(query, Number(count)));
  },
});

r.get('/:id/download', {
  summary: 'Download a generated report',
  params: idParams,
  raw: true,
  handler: async ({ user, params, res }) => {
    const row = await db('financial_reports').where({ id: params.id, user_id: user.id, status: 'ready' }).first();
    if (!row) throw notFound('Report');
    const data = await fs.readFile(reportPath(user.id, row.storedFilename)).catch(() => null);
    if (!data) throw notFound('Report file');
    const name = `monetra-${row.reportType.replace(/_/g, '-')}-${row.periodStart}-to-${row.periodEnd}.${row.format}`;
    res.setHeader('Content-Type', CONTENT_TYPES[row.format as keyof typeof CONTENT_TYPES]);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(data);
  },
});

r.delete('/:id', {
  summary: 'Delete a generated report',
  params: idParams,
  handler: async ({ user, params }) => {
    const row = await db('financial_reports').where({ id: params.id, user_id: user.id }).first();
    if (!row) throw notFound('Report');
    await db('financial_reports').where({ id: params.id }).delete();
    if (row.storedFilename) await fs.rm(reportPath(user.id, row.storedFilename), { force: true }).catch(() => undefined);
    return undefined;
  },
});

export default r.router;
