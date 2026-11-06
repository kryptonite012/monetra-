export type ColumnType = 'text' | 'money' | 'date' | 'percent' | 'number';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export interface ReportSection {
  title: string;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
}

/** Format-neutral report; renderers turn it into CSV, Excel or PDF. */
export interface ReportDocument {
  title: string;
  subtitle: string;
  period: { from: string; to: string };
  generatedAt: string;
  owner: string;
  summary: Array<{ label: string; value: string; type?: ColumnType }>;
  sections: ReportSection[];
  notes: string[];
}
