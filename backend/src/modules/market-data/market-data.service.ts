import { config } from '../../config/env';
import { db } from '../../db/knex';
import { logger } from '../../lib/logger';
import { parseAmfiNav, type NavRecord } from './amfi';

export interface PriceUpdate {
  investmentId: string;
  price: string;
  asOf: string;
  source: 'live' | 'delayed';
  provider: string;
}

export interface RefreshResult {
  provider: string;
  configured: boolean;
  updated: number;
  skipped: number;
  message: string;
  updates: PriceUpdate[];
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
let fetcher: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(20_000) });
/** Test hook so the AMFI integration can be exercised without network access. */
export function setMarketDataFetcher(f: Fetcher) {
  fetcher = f;
}

let navCache: { at: number; data: Map<string, NavRecord> } | null = null;
const NAV_TTL_MS = 6 * 3600 * 1000;

export function clearNavCache() {
  navCache = null;
}

async function loadAmfiNav(): Promise<Map<string, NavRecord>> {
  if (navCache && Date.now() - navCache.at < NAV_TTL_MS) return navCache.data;
  const res = await fetcher(config.AMFI_NAV_URL);
  if (!res.ok) throw new Error(`AMFI NAV download failed with status ${res.status}`);
  const data = parseAmfiNav(await res.text());
  if (data.size === 0) throw new Error('AMFI NAV file could not be parsed');
  navCache = { at: Date.now(), data };
  return data;
}

/**
 * Refreshes prices from the configured provider. Only verified sources are
 * used; when none is configured Monetra keeps manual prices and says so.
 */
export async function refreshPrices(userId: string): Promise<RefreshResult> {
  if (config.MARKET_DATA_PROVIDER === 'none') {
    return {
      provider: 'none',
      configured: false,
      updated: 0,
      skipped: 0,
      message: 'No market data provider is configured. Prices remain as manually entered.',
      updates: [],
    };
  }

  const holdings: Array<Record<string, any>> = await db('investments')
    .where({ user_id: userId, status: 'active', instrument_type: 'mutual_fund' })
    .where((q) => q.whereNotNull('scheme_code').orWhereNotNull('isin'));
  if (!holdings.length) {
    return { provider: 'AMFI', configured: true, updated: 0, skipped: 0, message: 'Add an AMFI scheme code or ISIN to your mutual funds to fetch NAVs.', updates: [] };
  }

  let navs: Map<string, NavRecord>;
  try {
    navs = await loadAmfiNav();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'AMFI NAV refresh failed');
    return { provider: 'AMFI', configured: true, updated: 0, skipped: holdings.length, message: 'Could not reach AMFI right now. Existing prices were kept.', updates: [] };
  }

  const updates: PriceUpdate[] = [];
  for (const h of holdings) {
    const rec = (h.schemeCode && navs.get(`code:${h.schemeCode}`)) || (h.isin && navs.get(`isin:${h.isin}`));
    if (!rec) continue;
    updates.push({ investmentId: h.id, price: rec.nav, asOf: rec.date, source: 'delayed', provider: 'AMFI' });
    await db('investments')
      .where({ id: h.id })
      .update({ current_price: rec.nav, price_source: 'delayed', price_provider: 'AMFI', price_as_of: new Date(`${rec.date}T18:30:00Z`) });
  }
  return {
    provider: 'AMFI',
    configured: true,
    updated: updates.length,
    skipped: holdings.length - updates.length,
    message: `Updated ${updates.length} fund NAV(s) from AMFI. NAVs are end-of-day values, not live prices.`,
    updates,
  };
}

export function providerStatus() {
  return {
    provider: config.MARKET_DATA_PROVIDER,
    configured: config.MARKET_DATA_PROVIDER !== 'none',
    coverage: config.MARKET_DATA_PROVIDER === 'amfi' ? ['mutual_fund'] : [],
    dataType: config.MARKET_DATA_PROVIDER === 'amfi' ? 'delayed' : 'manual',
    note:
      config.MARKET_DATA_PROVIDER === 'amfi'
        ? 'Mutual fund NAVs come from AMFI (official, end-of-day). Stocks, ETFs and other assets use manually entered prices.'
        : 'All prices are entered manually. Configure MARKET_DATA_PROVIDER=amfi to fetch official mutual fund NAVs.',
    lastCacheRefresh: navCache ? new Date(navCache.at).toISOString() : null,
  };
}
