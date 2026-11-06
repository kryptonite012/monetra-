import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { dec } from '../../lib/money';
import type { ReportColumn, ReportDocument } from './report.types';

/** Neutralises spreadsheet formula injection in text cells (=, +, -, @, tab, CR). */
export function safeText(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function csvCell(value: unknown, col?: ReportColumn): string {
  const s = col && col.type !== 'text' ? (value == null ? '' : String(value)) : safeText(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function renderCsv(doc: ReportDocument): Buffer {
  const lines: string[] = [];
  lines.push(csvCell(doc.title));
  lines.push(`Period,${doc.period.from},${doc.period.to}`);
  lines.push('');
  for (const s of doc.summary) lines.push(`${csvCell(s.label)},${csvCell(s.value, { key: 'v', label: '', type: s.type ?? 'text' })}`);
  for (const section of doc.sections) {
    lines.push('', csvCell(section.title));
    lines.push(section.columns.map((c) => csvCell(c.label)).join(','));
    for (const row of section.rows) lines.push(section.columns.map((c) => csvCell(row[c.key], c)).join(','));
  }
  lines.push('', ...doc.notes.map((n) => csvCell(n)));
  // UTF-8 BOM so Excel opens ₹ and Indic names correctly.
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

const INR_FORMAT = '"₹"#,##,##0.00;[Red]-"₹"#,##,##0.00';

function excelValue(value: unknown, col: ReportColumn): unknown {
  if (value === '' || value == null) return null;
  if (col.type === 'money' || col.type === 'percent' || col.type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : String(value);
  }
  return safeText(value);
}

export async function renderXlsx(doc: ReportDocument): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Monetra';
  wb.created = new Date(doc.generatedAt);
  const summary = wb.addWorksheet('Summary');
  summary.addRow([doc.title]).font = { bold: true, size: 14 };
  summary.addRow([doc.subtitle]);
  summary.addRow([]);
  for (const s of doc.summary) {
    const row = summary.addRow([s.label, s.type === 'money' || s.type === 'percent' ? Number(s.value) : s.value]);
    if (s.type === 'money') row.getCell(2).numFmt = INR_FORMAT;
  }
  summary.addRow([]);
  for (const n of doc.notes) summary.addRow([n]).font = { italic: true, color: { argb: 'FF64748B' } };
  summary.getColumn(1).width = 38;
  summary.getColumn(2).width = 22;

  const used = new Set<string>(['Summary']);
  doc.sections.forEach((section, idx) => {
    let name = section.title.replace(/[\\/*?:[\]]/g, ' ').slice(0, 28) || `Section ${idx + 1}`;
    while (used.has(name)) name = `${name.slice(0, 25)} ${idx}`;
    used.add(name);
    const ws = wb.addWorksheet(name);
    const header = ws.addRow(section.columns.map((c) => c.label));
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    for (const row of section.rows) ws.addRow(section.columns.map((c) => excelValue(row[c.key], c)));
    section.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.type === 'text' ? 30 : 16;
      if (c.type === 'money') col.numFmt = INR_FORMAT;
      if (c.type === 'percent') col.numFmt = '0.00"%"';
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** PDF fonts lack the ₹ glyph, so amounts print as "Rs. 1,23,456.00". */
function pdfMoney(value: unknown): string {
  if (value === '' || value == null) return '';
  const d = dec(value as string);
  const [int, frac] = d.abs().toFixed(2).split('.');
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${d.isNegative() ? '-' : ''}Rs. ${rest ? `${rest},` : ''}${last3}.${frac}`;
}

function pdfCell(value: unknown, col: ReportColumn): string {
  if (col.type === 'money') return pdfMoney(value);
  if (col.type === 'percent') return value === '' || value == null ? '' : `${value}%`;
  return value == null ? '' : String(value);
}

export function renderPdf(doc: ReportDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: doc.title, Author: 'Monetra', Creator: 'Monetra' } });
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const width = pdf.page.width - 80;
    pdf.fillColor('#0f766e').fontSize(18).font('Helvetica-Bold').text('MONETRA', 40, 40);
    pdf.fillColor('#0f172a').fontSize(15).text(doc.title, 40, 66);
    pdf.fillColor('#475569').fontSize(9).font('Helvetica').text(`${doc.subtitle}   ·   Generated ${doc.generatedAt.slice(0, 16).replace('T', ' ')} UTC`, 40, 88);
    pdf.moveTo(40, 104).lineTo(40 + width, 104).strokeColor('#cbd5e1').stroke();

    let y = 116;
    pdf.fontSize(10);
    for (const s of doc.summary) {
      pdf.fillColor('#334155').font('Helvetica').text(s.label, 40, y, { width: width / 2 });
      pdf.fillColor('#0f172a').font('Helvetica-Bold').text(s.type === 'money' ? pdfMoney(s.value) : s.type === 'percent' ? `${s.value}%` : s.value, 40 + width / 2, y, { width: width / 2, align: 'right' });
      y += 16;
    }

    for (const section of doc.sections) {
      y += 14;
      if (y > pdf.page.height - 120) {
        pdf.addPage();
        y = 40;
      }
      pdf.fillColor('#0f766e').font('Helvetica-Bold').fontSize(11).text(section.title, 40, y);
      y += 18;
      const colWidth = width / section.columns.length;
      const drawHeader = () => {
        pdf.rect(40, y - 3, width, 15).fill('#f1f5f9');
        pdf.fillColor('#334155').font('Helvetica-Bold').fontSize(7.5);
        section.columns.forEach((c, i) => pdf.text(c.label, 42 + i * colWidth, y, { width: colWidth - 4, align: c.type === 'text' || c.type === 'date' ? 'left' : 'right', lineBreak: false }));
        y += 15;
      };
      drawHeader();
      pdf.font('Helvetica').fontSize(7.5).fillColor('#0f172a');
      if (!section.rows.length) {
        pdf.fillColor('#94a3b8').text('No entries in this period.', 42, y);
        y += 12;
      }
      for (const row of section.rows) {
        if (y > pdf.page.height - 60) {
          pdf.addPage();
          y = 40;
          drawHeader();
          pdf.font('Helvetica').fontSize(7.5).fillColor('#0f172a');
        }
        section.columns.forEach((c, i) =>
          pdf.text(pdfCell(row[c.key], c).slice(0, 60), 42 + i * colWidth, y, { width: colWidth - 4, align: c.type === 'text' || c.type === 'date' ? 'left' : 'right', lineBreak: false, ellipsis: true }),
        );
        y += 12;
      }
    }

    const range = pdf.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      pdf.switchToPage(i);
      pdf.fillColor('#94a3b8').fontSize(7).font('Helvetica').text(`${doc.notes[0] ?? ''}   Page ${i + 1} of ${range.count}`, 40, pdf.page.height - 30, { width, align: 'center', lineBreak: false });
    }
    pdf.end();
  });
}
