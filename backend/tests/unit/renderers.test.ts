import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { renderCsv, renderPdf, renderXlsx, safeText } from '../../src/modules/reports/renderers';
import type { ReportDocument } from '../../src/modules/reports/report.types';

const doc: ReportDocument = {
  title: 'Monthly Financial Statement',
  subtitle: 'Asha · 2026-03-01 to 2026-03-31',
  period: { from: '2026-03-01', to: '2026-03-31' },
  generatedAt: '2026-04-01T10:00:00.000Z',
  owner: 'Asha',
  summary: [{ label: 'Total income', value: '125000.00', type: 'money' }],
  sections: [
    {
      title: 'Transactions',
      columns: [
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'debit', label: 'Debit', type: 'money' },
      ],
      rows: [
        { description: '=HYPERLINK("http://evil")', debit: '1500.00' },
        { description: 'Rent, March', debit: '-25000.00' },
      ],
    },
  ],
  notes: ['Not audited.'],
};

describe('report renderers', () => {
  it('neutralises formula injection in CSV text but keeps numbers', () => {
    expect(safeText('=SUM(A1)')).toBe("'=SUM(A1)");
    const csv = renderCsv(doc).toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"Rent, March",-25000.00');
  });

  it('produces an Excel workbook with a summary and typed money cells', async () => {
    const buf = await renderXlsx(doc);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Transactions']);
    const ws = wb.getWorksheet('Transactions')!;
    expect(ws.getCell('B3').value).toBe(-25000);
    expect(String(ws.getCell('A2').value).startsWith("'=")).toBe(true);
  });

  it('produces a valid PDF', async () => {
    const pdf = await renderPdf(doc);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
