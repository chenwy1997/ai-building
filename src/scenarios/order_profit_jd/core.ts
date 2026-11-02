export type PriceRow = Record<string, unknown> & { skuId: number | string };
export type PriceResult = { sku: string; status: 'ok' | 'not_in_pool' | 'missing_price' | 'error'; fetchedAt: string; jdPrice: number | null; salePrice: number | null; errorCode?: string; error?: string; raw?: PriceRow };
export function jdSkuFromUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value.trim());
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    if (!['item.jd.com', 'item.m.jd.com', 'item.m.jd.hk', 'item.jd.hk'].includes(url.hostname.toLowerCase())) return null;
    return url.pathname.match(/(?:^|\/)(\d+)\.html$/)?.[1] ?? null;
  } catch { return null; }
}
export function linkCandidate(properties: Record<string, string>): { sku: string; method: string } | null {
  const source = properties.sourceUrl?.trim();
  if (source) { const sku = jdSkuFromUrl(source); return sku ? { sku, method: 'source_url' } : null; }
  const sku = jdSkuFromUrl(properties.compareUrl);
  return sku ? { sku, method: 'compare_url_verified' } : null;
}
export function safeError(error: unknown) {
  return String(error instanceof Error ? error.message : error)
    .replace(/((?:access_token|authorization|sign|secret|password)\s*[=:]\s*)[^\s,&)]+/gi, '$1[REDACTED]').slice(0, 800);
}
export function errorCode(error: unknown): string {
  return String((error as { cause?: { resultCode?: unknown } })?.cause?.resultCode ?? '');
}
export const validPrice = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
export function isPoolError(error: unknown) {
  return ['2004', '3553'].includes(errorCode(error)) || /不在(?:用户|客户)商品池/.test(safeError(error));
}
export function isRateLimitError(error: unknown): boolean {
  if (isPoolError(error)) return false;
  const e = error as { status?: unknown; statusCode?: unknown } | null;
  return String(e?.status ?? e?.statusCode ?? errorCode(error)) === '429'
    || /\b(?:HTTP(?:\s+error)?|status(?:\s+code)?)\s*[:=]?\s*429\b|\brate[ _-]?limit(?:ed|ing)?\b|too many requests|限流|请求(?:频率|过于频繁)/i.test(safeError(error));
}
/** A bad SKU must never cause the other SKUs in its price batch to disappear. */
export async function collectPrices(
  ids: string[],
  fetchPrices: (ids: string[]) => Promise<PriceRow[]>,
  audit: (event: Record<string, unknown>) => void = () => {},
): Promise<PriceResult[]> {
  const output: PriceResult[] = [];
  const visit = async (batch: string[]): Promise<void> => {
    const fetchedAt = new Date().toISOString();
    const fail = (sku: string, status: PriceResult['status'], error: unknown): PriceResult => ({ sku, status, fetchedAt, jdPrice: null, salePrice: null, errorCode: errorCode(error), error: safeError(error) });
    try {
      const rows = await fetchPrices(batch);
      if (!Array.isArray(rows)) throw new Error('Price result is not an array');
      const mapped = new Map(rows.map(row => [String(row.skuId), row]));
      audit({ batch, fetchedAt, status: 'ok', response: rows });
      for (const sku of batch) {
        const raw = mapped.get(sku);
        const jdPrice = validPrice(raw?.jdPrice), salePrice = validPrice(raw?.salePrice);
        output.push({ sku, fetchedAt, status: raw && (jdPrice !== null || salePrice !== null) ? 'ok' : 'missing_price', jdPrice, salePrice, raw });
      }
    } catch (error) {
      audit({ batch, fetchedAt, status: isPoolError(error) ? 'not_in_pool' : 'error', errorCode: errorCode(error), error: safeError(error) });
      if (!isPoolError(error)) { output.push(...batch.map(id => fail(id, 'error', error))); return; }
      if (batch.length === 1) { output.push(fail(batch[0]!, 'not_in_pool', error)); return; }
      // Only classify explicitly named requested IDs, otherwise bisect to isolate.
      const message = safeError(error).split(/不在(?:用户|客户)商品池/)[0] ?? '';
      const mentioned = new Set(message.match(/\d+/g) ?? []);
      const bad = batch.filter(id => mentioned.has(id));
      if (bad.length && bad.length < batch.length) {
        output.push(...bad.map(id => fail(id, 'not_in_pool', error)));
        await visit(batch.filter(id => !mentioned.has(id)));
      } else {
        const half = Math.ceil(batch.length / 2);
        await visit(batch.slice(0, half)); await visit(batch.slice(half));
      }
    }
  };
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) await visit(unique.slice(i, i + 100));
  return output;
}

export const dimensions = ['brand', 'model', 'specification', 'package', 'unit'] as const;
export function confirmedSame(decision: any, allowed: Set<string>): boolean {
  return decision?.verdict === 'same' && allowed.has(String(decision.sku))
    && dimensions.every(key => ['same', 'not_applicable'].includes(decision.checks?.[key]?.status))
    && dimensions.every(key => typeof decision.checks?.[key]?.evidence === 'string' && decision.checks[key].evidence.trim().length > 0);
}
