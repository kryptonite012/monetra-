/**
 * Parser for AMFI's public NAV file (NAVAll.txt), the official end-of-day
 * net asset values for Indian mutual funds. Values are DELAYED (published
 * after market close), never live.
 *
 * Format: Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
 */
export interface NavRecord {
  schemeCode: string;
  isins: string[];
  schemeName: string;
  nav: string;
  date: string;
}

const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

function parseAmfiDate(value: string): string | null {
  const m = value.trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m || !MONTHS[m[2]]) return null;
  return `${m[3]}-${MONTHS[m[2]]}-${m[1]}`;
}

export function parseAmfiNav(text: string): Map<string, NavRecord> {
  const byKey = new Map<string, NavRecord>();
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split(';');
    if (parts.length < 6 || !/^\d+$/.test(parts[0].trim())) continue;
    const [code, isin1, isin2, name, nav, date] = parts.map((p) => p.trim());
    if (!/^\d+(\.\d+)?$/.test(nav)) continue;
    const isoDate = parseAmfiDate(date);
    if (!isoDate) continue;
    const isins = [isin1, isin2].filter((i) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(i));
    const record: NavRecord = { schemeCode: code, isins, schemeName: name, nav, date: isoDate };
    byKey.set(`code:${code}`, record);
    for (const isin of isins) byKey.set(`isin:${isin}`, record);
  }
  return byKey;
}
