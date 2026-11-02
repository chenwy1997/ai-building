import { describe, expect, test } from 'bun:test';
import { collectPrices, confirmedSame, jdSkuFromUrl, linkCandidate, isRateLimitError } from '../src/scenarios/order_profit_jd/core.ts';
const pool = (message: string) => new Error(message, { cause: { resultCode: '2004' } });
describe('order profit JD batch boundaries', () => {
  test('SKU digits in pool failures are not HTTP rate limits', () => {
    expect(isRateLimitError(pool('10030709776634,64272842969不在用户商品池，请联系商务经理'))).toBe(false);
    expect(isRateLimitError(new Error('SKU 64272842969 查询失败'))).toBe(false);
    expect(isRateLimitError(new Error('HTTP 429: Too Many Requests'))).toBe(true);
    expect(isRateLimitError(new Error('HTTP error: 429'))).toBe(true);
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError(new Error('请求频率超限'))).toBe(true);
  });
  test('only recognized JD product URL hosts, source takes precedence', () => {
    expect(jdSkuFromUrl('https://item.jd.com/123.html')).toBe('123');
    expect(jdSkuFromUrl('https://item.jd.com.evil.test/123.html')).toBeNull();
    expect(jdSkuFromUrl('https://example.test/?u=https://item.jd.com/123.html')).toBeNull();
    expect(linkCandidate({ sourceUrl: 'https://example.test/a', compareUrl: 'https://item.jd.com/123.html' })).toBeNull();
    expect(linkCandidate({ compareUrl: 'https://item.jd.com/123.html' })?.method).toBe('compare_url_verified');
  });
  test('isolates named pool failures and retries the healthy remainder', async () => {
    const calls: string[][] = [];
    const rows = await collectPrices(['111', '222', '333', '111'], async ids => {
      calls.push(ids);
      if (ids.includes('222')) throw pool('222不在客户商品池');
      return ids.map(skuId => ({ skuId, jdPrice: 5, salePrice: 4 }));
    });
    expect(calls).toEqual([['111', '222', '333'], ['111', '333']]);
    expect(rows.find(r => r.sku === '222')?.status).toBe('not_in_pool');
    expect(rows.filter(r => r.status === 'ok').length).toBe(2);
  });
  test('bisects pool errors without SKU IDs and preserves all outcomes', async () => {
    const rows = await collectPrices(['111', '222', '333'], async ids => {
      if (ids.includes('222')) throw pool('SKU不在客户商品池');
      return ids.map(skuId => ({ skuId, jdPrice: 5, salePrice: 4 }));
    });
    expect(rows.length).toBe(3);
    expect(rows.filter(r => r.status === 'ok').length).toBe(2);
    expect(rows.find(r => r.sku === '222')?.jdPrice).toBeNull();
  });
  test('does not substitute a returned different SKU or zero price', async () => {
    const rows = await collectPrices(['111', '222'], async () => [{ skuId: '999', jdPrice: 8 }, { skuId: '222', jdPrice: 0, salePrice: null }]);
    expect(rows.every(row => row.status === 'missing_price' && row.jdPrice === null)).toBe(true);
  });
  test('unknown packaging cannot pass same-product confirmation', () => {
    const decision = { sku: '111', verdict: 'same', checks: Object.fromEntries(['brand', 'model', 'specification', 'package', 'unit'].map(k => [k, { status: 'same', evidence: 'verified' }])) };
    expect(confirmedSame(decision, new Set(['111']))).toBe(true);
    decision.checks.package = { status: 'unknown', evidence: 'not supplied' };
    expect(confirmedSame(decision, new Set(['111']))).toBe(false);
  });
});
