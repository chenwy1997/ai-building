/** 公司 ES 最小客户端：无 @elastic/elasticsearch 依赖，直接用 fetch 打 _search（HTTP Basic）。
 * 证据源 = 商品库：所有查询带 isStdProduct: true 过滤（实测商品库总量 85,328）。
 * 类目匹配字段 = standardCategory：叶子直接挂载量用 standardCategory.id，任意层级用 standardCategory.idPath
 * （idPath 含全路径节点 id，实测与标准树节点 id 完全一致）。
 */

export const ES_INDEX = "uece-prod-sc_current";

export interface EsConfig {
  node: string;
  username: string;
  password: string;
}

export function esConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EsConfig {
  const node = env.ES_NODE;
  const username = env.ES_USERNAME;
  const password = env.ES_PASSWORD;
  if (!node || !username || !password) {
    throw new Error("缺少 ES 配置：请在 .env 配置 ES_NODE/ES_USERNAME/ES_PASSWORD（从 sanheng/ai-core 的 .env 复制）");
  }
  return { node: node.replace(/\/+$/u, ""), username, password };
}

export interface EsSample {
  /** ES 文档 _id（商品唯一标识，重挂/迁移交付必需） */
  id: string | null;
  title: string;
  brand: string | null;
  standardCategoryId: string | null;
  standardCategoryFullPath: string | null;
}

interface EsSearchResponse {
  hits?: {
    total?: number | { value?: number; relation?: string };
    hits?: Array<{ _id?: string; _source?: Record<string, unknown> }>;
  };
}

const SAMPLE_SOURCE = ["title", "brand.name", "standardCategory.id", "standardCategory.fullPath"];

const productQuery = (categoryTerm: Record<string, unknown>, size: number): Record<string, unknown> => ({
  track_total_hits: true,
  size,
  _source: SAMPLE_SOURCE,
  query: { bool: { filter: [{ term: { isStdProduct: true } }, categoryTerm] } },
});

/** 末级直接挂载量：standardCategory.id 精确命中（size=0 + track_total_hits 即纯 count）。 */
export function buildLeafQuery(leafId: string, size: number): Record<string, unknown> {
  return productQuery({ term: { "standardCategory.id": leafId } }, size);
}

/** 任意层级范围采样：standardCategory.idPath 含全路径节点 id。 */
export function buildScopeQuery(nodeId: string, size: number): Record<string, unknown> {
  return productQuery({ term: { "standardCategory.idPath": nodeId } }, size);
}

export async function searchProducts(
  config: EsConfig,
  body: unknown,
): Promise<{ total: number; samples: EsSample[] }> {
  const credentials = Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64");
  const response = await fetch(`${config.node}/${ES_INDEX}/_search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`ES 查询失败：HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  const json = await response.json() as EsSearchResponse;
  const totalRaw = json.hits?.total;
  const total = typeof totalRaw === "number" ? totalRaw : totalRaw?.value ?? 0;
  const samples = (json.hits?.hits ?? []).map((hit): EsSample => {
    const source = hit._source ?? {};
    const brand = source.brand as { name?: unknown } | undefined;
    const category = source.standardCategory as { id?: unknown; fullPath?: unknown } | undefined;
    return {
      id: typeof hit._id === "string" ? hit._id : null,
      title: typeof source.title === "string" ? source.title : "",
      brand: typeof brand?.name === "string" ? brand.name : null,
      standardCategoryId: typeof category?.id === "string" ? category.id : null,
      standardCategoryFullPath: typeof category?.fullPath === "string" ? category.fullPath : null,
    };
  });
  return { total, samples };
}

interface EsAggResponse {
  aggregations?: { leaf?: { buckets?: Array<{ key: string; doc_count: number }> } };
}

const rawSearch = async (config: EsConfig, body: unknown): Promise<EsAggResponse> => {
  const credentials = Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64");
  const response = await fetch(`${config.node}/${ES_INDEX}/_search`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Basic ${credentials}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<EsAggResponse>;
};

/**
 * 一次查询拿全末级挂载量：isStdProduct 过滤 + terms agg on standardCategory.id（size 65536）。
 * 实测 4,621 bucket、sum_other=0 一次拿全；字段不可聚合时退 .keyword，再退 composite 分页。
 */
export async function leafMountCounts(config: EsConfig): Promise<Map<string, number>> {
  const query = { term: { isStdProduct: true } };
  for (const field of ["standardCategory.id", "standardCategory.id.keyword"]) {
    try {
      const json = await rawSearch(config, {
        size: 0,
        track_total_hits: false,
        query,
        aggs: { leaf: { terms: { field, size: 65536 } } },
      });
      const buckets = json.aggregations?.leaf?.buckets;
      if (buckets) return new Map(buckets.map((bucket) => [bucket.key, bucket.doc_count]));
    } catch {
      // 字段不可聚合，换下一种打法
    }
  }
  // composite 分页兜底
  interface CompositeResponse {
    aggregations?: { leaf?: { buckets?: Array<{ key: { id: string }; doc_count: number }> } };
  }
  const counts = new Map<string, number>();
  let after: string | undefined;
  for (;;) {
    const credentials = Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64");
    const response = await fetch(`${config.node}/${ES_INDEX}/_search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${credentials}` },
      body: JSON.stringify({
        size: 0,
        track_total_hits: false,
        query,
        aggs: {
          leaf: {
            composite: {
              size: 10000,
              sources: [{ id: { terms: { field: "standardCategory.id.keyword" } } }],
              ...(after ? { after: { id: after } } : {}),
            },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`ES 聚合失败：HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    const json = await response.json() as CompositeResponse;
    const buckets = json.aggregations?.leaf?.buckets ?? [];
    for (const bucket of buckets) counts.set(bucket.key.id, bucket.doc_count);
    if (buckets.length < 10000) return counts;
    after = buckets.at(-1)!.key.id;
  }
}
