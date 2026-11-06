const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}

/** Converts the top-level keys of a database row to camelCase (JSON columns are left untouched). */
export function camelRow<T = Record<string, unknown>>(row: unknown): T {
  if (!isPlainObject(row)) return row as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out as T;
}

/** Converts camelCase keys to snake_case column names and drops undefined values. */
export function snakeKeys(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) out[snake(k)] = v;
  }
  return out;
}

/** knex postProcessResponse hook: camelises rows returned by builders and raw queries. */
export function postProcessResponse(result: unknown): unknown {
  if (Array.isArray(result)) return result.map((r) => camelRow(r));
  if (
    typeof result === 'object' &&
    result !== null &&
    'command' in result &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    const r = result as unknown as { rows: unknown[] };
    r.rows = r.rows.map((row) => camelRow(row));
    return r;
  }
  if (isPlainObject(result)) return camelRow(result);
  return result;
}
