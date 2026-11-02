/**
 * 商品库管理后台 API（SKU 口径权威挂载证据）：getList 按 categoryIds（子树匹配，叶子=直挂）。
 * cookie 在 .env PRODUCT_HUB_COOKIE（JWT 约 7 天过期）。
 */
export interface ProductHubSample {
  id: string;
  title: string;
  brand: string | null;
  stdCategoryId: string | null;
}

const API = "https://sc.sanheng.com/manage/product/product-hub/api/getList";

export function productHubCookie(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.PRODUCT_HUB_COOKIE ?? null;
}

interface GetListResponse {
  count?: number;
  list?: Array<Record<string, unknown>>;
}

export async function queryProductHub(
  cookie: string,
  categoryId: string,
  pageSize: number,
): Promise<{ count: number; samples: ProductHubSample[] }> {
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      listType: "SKU",
      categoryIds: [categoryId],
      activeTab: "ALL",
      page: 1,
      pageSize,
      filterRange: "ALL",
      hasTargetCustomer: false,
      dateType: "createdAt",
      priceFilters: ["noPriceFactory", "noPriceRetail"],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`商品库 API HTTP ${r.status}`);
  const j = (await r.json()) as GetListResponse;
  const samples = (j.list ?? []).map((row) => ({
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    brand: typeof row.brandName === "string" ? row.brandName : null,
    stdCategoryId: typeof row.stdCategoryId === "string" ? row.stdCategoryId : null,
  }));
  return { count: typeof j.count === "number" ? j.count : samples.length, samples };
}
