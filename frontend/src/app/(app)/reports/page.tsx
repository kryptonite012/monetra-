'use client';
import { Download, Eye, FileSpreadsheet, FileText, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, useToast } from '@/components/ui';
import { api, ApiError, downloadFile } from '@/lib/api';
import { formatDateTime, formatMoney, todayISO } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useAccountOptions } from '@/lib/options';
import type { Paged } from '@/lib/types';

interface ReportDoc {
  title: string;
  subtitle: string;
  summary: Array<{ label: string; value: string; type?: string }>;
  sections: Array<{ title: string; columns: Array<{ key: string; label: string; type: string }>; rows: Array<Record<string, unknown>> }>;
  notes: string[];
}

interface ReportRow {
  id: string;
  reportType: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  format: string;
  status: string;
  sizeBytes: number | null;
  createdAt: string;
}

function fyRange() {
  const t = todayISO();
  const y = Number(t.slice(5, 7)) >= 4 ? Number(t.slice(0, 4)) : Number(t.slice(0, 4)) - 1;
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

export default function ReportsPage() {
  const toast = useToast();
  const accounts = useAccountOptions();
  const { data: types } = useApi<Array<{ type: string; title: string }>>('/reports/types');
  const { data: list, mutate } = useApi<ReportRow[]>('/reports?pageSize=50');
  const [form, setForm] = useState({ reportType: 'monthly_statement', periodStart: `${todayISO().slice(0, 7)}-01`, periodEnd: todayISO(), accountId: '', format: 'pdf' });
  const [preview, setPreview] = useState<ReportDoc | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  void (null as unknown as Paged<ReportRow>);

  const params = () => ({ reportType: form.reportType, periodStart: form.periodStart, periodEnd: form.periodEnd, accountId: form.reportType === 'account_statement' ? form.accountId || undefined : undefined });

  const quick = (type: string) => {
    if (type === 'tax_summary' || type === 'annual_report') {
      const fy = fyRange();
      setForm({ ...form, reportType: type, periodStart: fy.from, periodEnd: fy.to });
    } else setForm({ ...form, reportType: type });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Reports & statements" description="Monthly statements, annual and tax summaries, loan and investment reports. Export to PDF, Excel or CSV." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Create a report" />
          <CardBody className="space-y-3">
            <Field label="Report">
              <Select value={form.reportType} onChange={(e) => quick(e.target.value)}>
                {types?.map((t) => <option key={t.type} value={t.type}>{t.title}</option>)}
              </Select>
            </Field>
            {form.reportType === 'account_statement' && (
              <Field label="Account">
                <Select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                  <option value="">Choose…</option>
                  {accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </Select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="From"><Input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} /></Field>
              <Field label="To"><Input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></Field>
            </div>
            <Field label="Format">
              <Select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
                <option value="pdf">PDF</option>
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="csv">CSV</option>
              </Select>
            </Field>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                loading={busy === 'preview'}
                onClick={async () => {
                  setBusy('preview');
                  try {
                    const q = new URLSearchParams(Object.entries(params()).filter(([, v]) => v) as Array<[string, string]>);
                    setPreview(await api.get<ReportDoc>(`/reports/preview?${q}`));
                  } catch (err) {
                    toast((err as ApiError).message, 'error');
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <Eye className="h-4 w-4" /> Preview
              </Button>
              <Button
                loading={busy === 'generate'}
                onClick={async () => {
                  setBusy('generate');
                  try {
                    const r = await api.post<ReportRow>('/reports', { ...params(), format: form.format });
                    await downloadFile(`/reports/${r.id}/download`, `report.${form.format}`);
                    toast('Report generated');
                    mutate();
                  } catch (err) {
                    toast((err as ApiError).message, 'error');
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <Download className="h-4 w-4" /> Generate
              </Button>
            </div>
            <p className="text-xs text-muted">Reports are built from your records and are not audited statements or tax advice.</p>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Generated reports" />
          <DataTable
            rows={list}
            loading={!list}
            columns={[
              { key: 't', header: 'Report', render: (r) => <div className="flex items-center gap-2">{r.format === 'pdf' ? <FileText className="h-4 w-4 text-negative" /> : <FileSpreadsheet className="h-4 w-4 text-positive" />}<div><p className="font-medium">{r.title}</p><p className="text-xs text-muted">{r.periodStart} → {r.periodEnd}</p></div></div> },
              { key: 'f', header: 'Format', render: (r) => <Badge>{r.format.toUpperCase()}</Badge> },
              { key: 'c', header: 'Created', hideOnMobile: true, render: (r) => <span className="text-xs text-muted">{formatDateTime(r.createdAt)}</span> },
              { key: 'x', header: '', align: 'right', render: (r) => (r.status === 'ready' ? <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => downloadFile(`/reports/${r.id}/download`, `report.${r.format}`)} aria-label="Download"><Download className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={async () => { await api.delete(`/reports/${r.id}`); mutate(); }} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button></div> : <Badge tone="negative">{r.status}</Badge>) },
            ]}
            empty={<EmptyState title="No reports yet" description="Create your first statement on the left." />}
          />
        </Card>
      </div>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.title ?? ''} description={preview?.subtitle} size="xl">
        {preview && (
          <div className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-4">
              {preview.summary.map((s) => (
                <div key={s.label} className="rounded-xl bg-surface-2 p-3"><p className="text-[11px] text-muted">{s.label}</p><p className="num text-sm font-semibold">{s.type === 'money' ? formatMoney(s.value) : s.type === 'percent' ? `${s.value}%` : s.value}</p></div>
              ))}
            </div>
            {preview.sections.map((sec) => (
              <div key={sec.title}>
                <h3 className="mb-2 text-sm font-semibold">{sec.title}</h3>
                <div className="max-h-72 overflow-auto rounded-xl border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-2"><tr>{sec.columns.map((c) => <th key={c.key} className={c.type === 'money' || c.type === 'number' || c.type === 'percent' ? 'px-3 py-2 text-right' : 'px-3 py-2 text-left'}>{c.label}</th>)}</tr></thead>
                    <tbody>
                      {sec.rows.slice(0, 200).map((row, i) => (
                        <tr key={i} className="border-t border-border/60">
                          {sec.columns.map((c) => (
                            <td key={c.key} className={c.type === 'money' || c.type === 'number' || c.type === 'percent' ? 'num px-3 py-1.5 text-right' : 'px-3 py-1.5'}>
                              {c.type === 'money' && row[c.key] !== '' && row[c.key] != null ? formatMoney(String(row[c.key])) : String(row[c.key] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {!sec.rows.length && <tr><td className="px-3 py-3 text-muted" colSpan={sec.columns.length}>No entries.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {preview.notes.map((n) => <p key={n} className="text-xs italic text-muted">{n}</p>)}
          </div>
        )}
      </Modal>
    </div>
  );
}
