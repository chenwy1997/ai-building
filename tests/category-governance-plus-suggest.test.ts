import { describe, expect, test } from "bun:test";
import {
  clusterTitles,
  findOrphanSamples,
  nameSimilarity,
  nameTokens,
  normalizeTitle,
  suggestOps,
  titleOverlap,
} from "../src/scenarios/category_governance_plus/suggest.ts";
import type { LeafStats, ScopeStats } from "../src/scenarios/category_governance_plus/suggest.ts";
import { buildLeafQuery, buildScopeQuery } from "../src/scenarios/category_governance_plus/es.ts";
import { validateOpShape } from "../src/scenarios/category_governance_plus/ops.ts";
import type { Attribute } from "../src/scenarios/category_attributes_governance/types.ts";

const sample = (title: string, standardCategoryId: string | null = null) =>
  ({ title, brand: null, standardCategoryId });

const leaf = (id: string, name: string, productCount: number, titles: string[]): LeafStats => ({
  id,
  name,
  path: ["标准类目", "五金工具", "电动铆接工具", name],
  productCount,
  samples: titles.map((title) => sample(title, id)),
});

const SCOPE = { id: "scope-rivet", name: "电动铆接工具", path: ["标准类目", "五金工具", "电动铆接工具"] };

const attr = (key: string): Attribute => [key, key, "text", "optional", "", [], "", "", "", []];

describe("ES 查询构造", () => {
  interface BoolQuery { query: { bool: { filter: Array<Record<string, unknown>> } } }
  const filtersOf = (body: unknown) => (body as BoolQuery).query.bool.filter;

  test("buildLeafQuery：isStdProduct 过滤 + standardCategory.id 精确命中", () => {
    const body = buildLeafQuery("leaf-1", 50);
    expect(body).toMatchObject({
      track_total_hits: true,
      size: 50,
      _source: ["title", "brand.name", "standardCategory.id", "standardCategory.fullPath"],
    });
    expect(filtersOf(body)).toEqual([
      { term: { isStdProduct: true } },
      { term: { "standardCategory.id": "leaf-1" } },
    ]);
    expect(JSON.stringify(body)).not.toContain("categoryInstanceId");
    expect(JSON.stringify(body)).not.toContain("categoryIds");
  });

  test("buildScopeQuery：isStdProduct 过滤 + standardCategory.idPath 任意层级", () => {
    const body = buildScopeQuery("node-9", 200);
    expect(filtersOf(body)).toEqual([
      { term: { isStdProduct: true } },
      { term: { "standardCategory.idPath": "node-9" } },
    ]);
  });
});

describe("add 悬空/错挂判定", () => {
  test("standardCategoryId 缺失或不在 enabled 末级集合内即悬空", () => {
    const leafIds = new Set(["plug", "magnet"]);
    const orphans = findOrphanSamples(leafIds, [
      sample("电动拉铆枪 插电式", "plug"),        // 正常挂载
      sample("磁力钻 32mm", "magnet"),            // 正常挂载
      sample("不锈钢抽芯铆钉", null),             // standardCategory 缺失
      sample("万能转换接头", "orphan-elsewhere"), // 挂在集合外（禁用/其他分支）
    ]);
    expect(orphans.map((orphan) => orphan.title)).toEqual(["不锈钢抽芯铆钉", "万能转换接头"]);
  });
});

describe("suggest 名称相似度", () => {
  test("中文 bigram 与拉丁/数字 token，泛化词降权", () => {
    expect(nameSimilarity("插电式拉铆枪", "充电式拉铆枪")).toBeCloseTo(4 / 6, 3);
    expect(nameSimilarity("拉铆枪", "磁力钻")).toBe(0);
    expect(nameSimilarity("拉铆枪", "拉铆枪")).toBe(1);
    expect(nameTokens("3M口罩9001").has("3m")).toBe(true);
    expect(normalizeTitle("BOSI 气动拉铆枪 4.8mm")).toContain("bosi");
  });

  test("其他/通用类兜底名称降权，纯泛化名强降权", () => {
    expect(nameSimilarity("其他拉铆枪", "拉铆枪")).toBeCloseTo(0.6, 3);
    expect(nameSimilarity("其他拉铆枪", "拉铆枪")).toBeLessThan(nameSimilarity("拉铆枪", "拉铆枪"));
    expect(nameSimilarity("通用电动工具", "其他电动工具")).toBeCloseTo(0.6, 3);
    expect(nameSimilarity("其他", "其他")).toBeCloseTo(0.3, 3);
    expect(nameSimilarity("其他", "通用")).toBe(0);
  });
});

describe("suggest 候选生成", () => {
  const plugTitles = ["电动拉铆枪 插电式 4.8mm", "电动拉铆枪 插电式 6.4mm", "电动拉铆枪 插电式 自锁"];
  const batteryTitles = ["电动拉铆枪 插电式 4.8mm", "电动拉铆枪 充电式 6.4mm", "电动拉铆枪 插电式 自锁"];
  const stats = (overrides: Partial<ScopeStats> = {}): ScopeStats => ({
    leaves: [
      leaf("plug", "插电式拉铆枪", 60, plugTitles),
      leaf("battery", "充电式拉铆枪", 90, batteryTitles),
      leaf("magnet", "磁力钻", 80, ["磁力钻 32mm 工业级"]),
      leaf("empty", "充电式铆螺母枪", 0, []),
    ],
    scopeSamples: [],
    ...overrides,
  });

  test("merge：高相似+标题重合出提案，低相似不出；零挂载不参与 merge", () => {
    const { ops } = suggestOps(SCOPE, stats(), { minProducts: 50 });
    const merges = ops.filter((op) => op.type === "merge");
    expect(merges).toHaveLength(1);
    const params = merges[0]!.params as { sources: string[]; target: string };
    expect(params.sources.sort()).toEqual(["battery", "plug"]);
    expect(params.target).toBe("battery"); // 存续者取商品数多者
    const evidence = merges[0]!.evidence as { score: number; samplePairs: unknown[] };
    expect(evidence.score).toBeGreaterThanOrEqual(0.5);
    expect(evidence.samplePairs.length).toBeGreaterThan(0);
    expect(ops.some((op) => op.type === "merge" && JSON.stringify(op.params).includes("magnet"))).toBe(false);
    expect(ops.some((op) => op.type === "merge" && JSON.stringify(op.params).includes("empty"))).toBe(false);
  });

  test("merge 并列商品数时存续者取 id 较小者，保证确定", () => {
    const { ops } = suggestOps(SCOPE, {
      leaves: [
        leaf("b-2", "电钻", 50, ["电钻 10mm"]),
        leaf("a-1", "电钻", 50, ["电钻 10mm"]),
      ],
      scopeSamples: [],
    }, { minProducts: 50 });
    expect(ops).toHaveLength(1);
    expect((ops[0]!.params as { target: string }).target).toBe("a-1");
  });

  test("merge：base-template 的属性 key 重合能把边缘对推过阈值", () => {
    const sparseA = ["电动拉铆枪 插电式 4.8mm", "电动拉铆枪 插电式 6.4mm", "电动拉铆枪 插电式 自锁", "电动拉铆枪 插电式 工业", "电动拉铆枪 插电式 重型"];
    const sparseB = ["电动拉铆枪 插电式 4.8mm", "电动拉铆枪 充电式 6.4mm", "电动拉铆枪 充电式 自锁", "电动拉铆枪 充电式 工业", "电动拉铆枪 充电式 重型"];
    const pair: ScopeStats = {
      leaves: [leaf("plug", "插电式拉铆枪", 60, sparseA), leaf("battery", "充电式拉铆枪", 90, sparseB)],
      scopeSamples: [],
    };
    expect(suggestOps(SCOPE, pair, { minProducts: 50 }).ops.filter((op) => op.type === "merge")).toHaveLength(0);
    const withTemplate = suggestOps(SCOPE, pair, {
      minProducts: 50,
      baseTemplate: { rows: [
        { categoryId: "plug", attributes: [attr("power"), attr("capacity")] },
        { categoryId: "battery", attributes: [attr("power"), attr("capacity")] },
      ] },
    });
    const merges = withTemplate.ops.filter((op) => op.type === "merge");
    expect(merges).toHaveLength(1);
    expect((merges[0]!.evidence as { attrKeyOverlap: number }).attrKeyOverlap).toBe(1);
  });

  test("split：两簇出提案，均匀一簇不出，低于 min-products 不出", () => {
    const twoClusters = leaf("manual", "拉铆枪", 120, [
      "气动拉铆枪 工业级 4.8mm", "气动拉铆枪 工业级 6.4mm", "气动拉铆枪 工业级 自吸式",
      "手动拉铆枪 双把 4.8mm", "手动拉铆枪 双把 6.4mm", "手动拉铆枪 双把 省力",
    ]);
    const { ops } = suggestOps(SCOPE, { leaves: [twoClusters], scopeSamples: [] }, { minProducts: 50 });
    const splits = ops.filter((op) => op.type === "split");
    expect(splits).toHaveLength(1);
    const params = splits[0]!.params as { source: string; children: Array<{ name: string }> };
    expect(params.source).toBe("manual");
    expect(params.children).toHaveLength(2);
    expect(params.children.every((child) => child.name.startsWith("待命名"))).toBe(true);
    const evidence = splits[0]!.evidence as { clusters: Array<{ keywords: string[]; size: number }> };
    expect(evidence.clusters.map((cluster) => cluster.size).sort()).toEqual([3, 3]);
    expect(evidence.clusters.flatMap((cluster) => cluster.keywords)).toContain("气动");

    const uniform = leaf("uniform", "拉铆枪", 120, [
      "气动拉铆枪 工业级 4.8mm", "气动拉铆枪 工业级 4.8mm 现货", "气动拉铆枪 工业级 4.8mm 包邮",
    ]);
    expect(suggestOps(SCOPE, { leaves: [uniform], scopeSamples: [] }, { minProducts: 50 }).ops).toHaveLength(0);

    expect(suggestOps(SCOPE, { leaves: [{ ...twoClusters, productCount: 30 }], scopeSamples: [] }, { minProducts: 50 }).ops).toHaveLength(0);
  });

  test("disable：零挂载末级出提案", () => {
    const { ops } = suggestOps(SCOPE, stats(), { minProducts: 50 });
    const disables = ops.filter((op) => op.type === "disable");
    expect(disables).toHaveLength(1);
    expect((disables[0]!.params as { id: string }).id).toBe("empty");
    expect((disables[0]!.params as { reason: string }).reason).toContain("零挂载");
  });

  test("add：挂载悬空的 scope 样本聚类成组出提案，落进末级或单条不出", () => {
    const scopeSamples = [
      sample("不锈钢抽芯铆钉 4.8mm", "orphan-rivet"),
      sample("不锈钢抽芯铆钉 4.0mm", "orphan-rivet"),
      sample("不锈钢抽芯铆钉 6.4mm", "orphan-rivet"),
      sample("万能转换接头 定制款", "orphan-misc"),
      sample("电动拉铆枪 插电式 4.8mm", "plug"),
      sample("磁力钻 32mm 工业级", "magnet"),
    ];
    const { ops } = suggestOps(SCOPE, stats({ scopeSamples }), { minProducts: 50 });
    const adds = ops.filter((op) => op.type === "add");
    expect(adds).toHaveLength(1);
    const params = adds[0]!.params as { parentId: string; name: string };
    expect(params.parentId).toBe(SCOPE.id);
    expect(params.name).toContain("待命名");
    expect((adds[0]!.evidence as { orphanCount: number }).orphanCount).toBe(3);
  });

  test("产出的 ops.json 形状与 validateOpShape 完全兼容", () => {
    const full: ScopeStats = {
      leaves: [
        leaf("plug", "插电式拉铆枪", 60, ["电动拉铆枪 插电式 4.8mm", "电动拉铆枪 插电式 自锁"]),
        leaf("battery", "充电式拉铆枪", 90, ["电动拉铆枪 插电式 4.8mm", "电动拉铆枪 插电式 自锁"]),
        leaf("manual", "拉铆枪", 120, [
          "气动拉铆枪 工业级 4.8mm", "气动拉铆枪 工业级 6.4mm",
          "手动拉铆枪 双把 4.8mm", "手动拉铆枪 双把 6.4mm",
        ]),
        leaf("empty", "充电式铆螺母枪", 0, []),
      ],
      scopeSamples: [sample("不锈钢抽芯铆钉 4.8mm", "orphan"), sample("不锈钢抽芯铆钉 4.0mm", "orphan")],
    };
    const { ops, report } = suggestOps(SCOPE, full, { minProducts: 50 });
    expect(ops.map((op) => op.type).sort()).toEqual(["add", "disable", "merge", "split"]);
    for (const op of ops) {
      expect(validateOpShape({ type: op.type, params: op.params, evidence: op.evidence })).toEqual([]);
      expect(typeof op.evidence).toBe("object");
    }
    expect(report).toContain("## merge（1）");
    expect(report).toContain("## split（1）");
    expect(report).toContain("## disable（1）");
    expect(report).toContain("## add（1）");
    expect(report).toContain("证据源：离线统计（fixture）");
  });

  test("titleOverlap 按归一化标题交集占比计分", () => {
    const { score, pairs } = titleOverlap(
      [sample("电动拉铆枪 4.8mm"), sample("电动拉铆枪 6.4mm")],
      [sample("6.4mm 电动拉铆枪"), sample("磁力钻")],
    );
    expect(score).toBeCloseTo(0.5, 3);
    expect(pairs).toHaveLength(1);
  });

  test("clusterTitles 对输入顺序确定（内部按标题排序）", () => {
    const titles = ["气动拉铆枪 工业级 4.8mm", "手动拉铆枪 双把 4.8mm", "气动拉铆枪 工业级 6.4mm", "手动拉铆枪 双把 6.4mm"];
    const forward = clusterTitles(titles.map((title) => sample(title)));
    const backward = clusterTitles([...titles].reverse().map((title) => sample(title)));
    expect(forward.map((cluster) => cluster.samples.length)).toEqual(backward.map((cluster) => cluster.samples.length));
    expect(forward).toHaveLength(2);
  });
});
