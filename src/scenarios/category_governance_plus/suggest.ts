import type { Attribute } from "../category_attributes_governance/types.ts";
import type { OpParams, OpType } from "./ops.ts";

/** suggest 的输入统计：与 ES 解耦，fixture 文件同构，可直接离线喂给 suggestOps。 */
export interface LeafSample {
  title: string;
  brand: string | null;
  standardCategoryId: string | null;
  standardCategoryFullPath?: string | null;
}
export interface LeafStats {
  id: string;
  name: string;
  path: string[];
  productCount: number;
  samples: LeafSample[];
}
export interface ScopeStats {
  leaves: LeafStats[];
  scopeSamples: LeafSample[];
  /** 报告里注明的证据来源，如「商品库（isStdProduct=true）」；缺省为离线统计 */
  sourceNote?: string;
}
export interface ScopeInfo { id: string; name: string; path: string[] }

export interface SuggestOptions {
  minProducts: number;
  mergeThreshold?: number;
  clusterThreshold?: number;
  baseTemplate?: { rows: Array<{ categoryId: string; attributes: Attribute[] }> };
}

export interface SuggestCandidate {
  type: OpType;
  params: OpParams;
  evidence: Record<string, unknown>;
}

export interface TitleCluster { tokens: Set<string>; samples: LeafSample[] }

export const GENERIC_WORDS = ["其他", "其它", "通用", "万能", "各种"];
export const DEFAULT_MERGE_THRESHOLD = 0.5;
// 滑动 bigram 会让"气动拉铆枪/手动拉铆枪"这类共享中间词的标题相似度达到 0.5，阈值必须高于它
export const DEFAULT_CLUSTER_THRESHOLD = 0.55;
const MIN_CLUSTER_SIZE = 2;

const NAME_WEIGHT = 0.45;
const TITLE_WEIGHT = 0.4;
const ATTR_WEIGHT = 0.15;

/** 中文按 bigram、拉丁/数字按 token 切分。 */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const run of text.match(/[一-鿿]+/gu) ?? []) {
    if (run.length === 1) tokens.add(run);
    else for (let i = 0; i < run.length - 1; i += 1) tokens.add(run.slice(i, i + 2));
  }
  for (const run of text.match(/[a-z0-9]+/gu) ?? []) tokens.add(run);
  return tokens;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/** 去掉"其他/通用"类标题党词汇后的类目名 token。 */
export function nameTokens(name: string): Set<string> {
  let text = name.toLowerCase();
  for (const word of GENERIC_WORDS) text = text.split(word).join(" ");
  return tokenize(text);
}

/**
 * 类目名相似度（Jaccard）。含"其他/通用"的名称多为杂类兜底，降权 0.6；
 * 去掉泛化词后为空的纯兜底类目（如"其他"），用原始 token 强降权比较，避免杂类互相误配。
 */
export function nameSimilarity(a: string, b: string): number {
  const tokensA = nameTokens(a);
  const tokensB = nameTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) {
    return jaccard(tokenize(a.toLowerCase()), tokenize(b.toLowerCase())) * 0.3;
  }
  const score = jaccard(tokensA, tokensB);
  const generic = GENERIC_WORDS.some((word) => a.includes(word) || b.includes(word));
  return generic ? score * 0.6 : score;
}

export function normalizeTitle(title: string): string {
  return [...tokenize(title.toLowerCase())].sort().join(" ");
}

/** 样本标题重合：归一化标题的交集占比较小一侧 unique 数的比例；pairs 为证据样本对（最多 5 对）。 */
export function titleOverlap(
  a: LeafSample[],
  b: LeafSample[],
): { score: number; pairs: Array<[string, string]> } {
  const byNorm = new Map<string, string>();
  for (const sample of a) {
    const norm = normalizeTitle(sample.title);
    if (norm && !byNorm.has(norm)) byNorm.set(norm, sample.title);
  }
  if (byNorm.size === 0) return { score: 0, pairs: [] };
  const seenB = new Set<string>();
  const pairs: Array<[string, string]> = [];
  let matched = 0;
  for (const sample of b) {
    const norm = normalizeTitle(sample.title);
    if (!norm || seenB.has(norm)) continue;
    seenB.add(norm);
    const rawA = byNorm.get(norm);
    if (rawA !== undefined) {
      matched += 1;
      if (pairs.length < 5) pairs.push([rawA, sample.title]);
    }
  }
  if (seenB.size === 0) return { score: 0, pairs: [] };
  return { score: matched / Math.min(byNorm.size, seenB.size), pairs };
}

/** 贪心聚类：按标题排序后与代表（首个样本）token 集合相似度过阈值即入簇。 */
export function clusterTitles(samples: LeafSample[], threshold = DEFAULT_CLUSTER_THRESHOLD): TitleCluster[] {
  const sorted = [...samples].sort((a, b) => a.title.localeCompare(b.title));
  const clusters: TitleCluster[] = [];
  for (const sample of sorted) {
    const tokens = tokenize(sample.title.toLowerCase());
    if (tokens.size === 0) continue;
    let best: TitleCluster | undefined;
    let bestScore = 0;
    for (const cluster of clusters) {
      const score = jaccard(tokens, cluster.tokens);
      if (score >= threshold && score > bestScore) {
        best = cluster;
        bestScore = score;
      }
    }
    if (best) best.samples.push(sample);
    else clusters.push({ tokens, samples: [sample] });
  }
  return clusters;
}

/** 簇的区分性代表词：在本簇高频、在其他稳定簇中不出现的 token（纯数字除外），最多 4 个。 */
function clusterKeywords(cluster: TitleCluster, others: TitleCluster[]): string[] {
  const freq = new Map<string, number>();
  for (const sample of cluster.samples) {
    for (const token of tokenize(sample.title.toLowerCase())) freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  const elsewhere = new Set<string>();
  for (const other of others) {
    for (const sample of other.samples) {
      for (const token of tokenize(sample.title.toLowerCase())) elsewhere.add(token);
    }
  }
  return [...freq.entries()]
    .filter(([token]) => !/^\d+$/u.test(token) && !elsewhere.has(token))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([token]) => token);
}

const placeholderName = (keywords: string[], index: number): string =>
  keywords.length > 0 ? `待命名:${keywords.join("、")}` : `待命名${index + 1}`;

const attrKeyOverlap = (
  a: LeafStats,
  b: LeafStats,
  keyMap: Map<string, Set<string>> | undefined,
): number => {
  if (!keyMap) return 0;
  const keysA = keyMap.get(a.id);
  const keysB = keyMap.get(b.id);
  if (!keysA?.size || !keysB?.size) return 0;
  return jaccard(keysA, keysB);
};

interface MergePair {
  a: LeafStats;
  b: LeafStats;
  nameSim: number;
  titleSim: number;
  attrSim: number;
  score: number;
  pairs: Array<[string, string]>;
}

function findMergePairs(
  leaves: LeafStats[],
  keyMap: Map<string, Set<string>> | undefined,
  threshold: number,
): MergePair[] {
  const denominator = NAME_WEIGHT + TITLE_WEIGHT + (keyMap ? ATTR_WEIGHT : 0);
  const candidates: MergePair[] = [];
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      const a = leaves[i]!;
      const b = leaves[j]!;
      // 零挂载类目之间不猜合并，交给 disable 候选
      if (a.productCount === 0 || b.productCount === 0) continue;
      const nameSim = nameSimilarity(a.name, b.name);
      const { score: titleSim, pairs } = titleOverlap(a.samples, b.samples);
      const attrSim = attrKeyOverlap(a, b, keyMap);
      const score = (NAME_WEIGHT * nameSim + TITLE_WEIGHT * titleSim + ATTR_WEIGHT * attrSim) / denominator;
      if (score >= threshold) candidates.push({ a, b, nameSim, titleSim, attrSim, score, pairs });
    }
  }
  // 高分为先贪心去重：同一末级只允许出现在一个 merge 候选里，避免 apply 时 op 冲突
  candidates.sort((x, y) => y.score - x.score || x.a.id.localeCompare(y.a.id) || x.b.id.localeCompare(y.b.id));
  const used = new Set<string>();
  return candidates.filter((candidate) => {
    if (used.has(candidate.a.id) || used.has(candidate.b.id)) return false;
    used.add(candidate.a.id);
    used.add(candidate.b.id);
    return true;
  });
}

/**
 * add 候选的悬空/错挂判定：scope 样本（standardCategory.idPath 命中 scope 节点）中，
 * standardCategory.id 不在该 scope enabled 末级集合内的商品（含 standardCategory 缺失）。
 */
export function findOrphanSamples(leafIds: Set<string>, scopeSamples: LeafSample[]): LeafSample[] {
  return scopeSamples.filter(
    (sample) => !sample.standardCategoryId || !leafIds.has(sample.standardCategoryId),
  );
}

/**
 * 候选生成主函数：merge（名称+标题+属性 key 三路加权）/ split（稳定 ≥2 簇）/
 * disable（零挂载）/ add（scope 样本挂载悬空聚类）。产出的 {type,params,evidence} 可直接写 ops.json。
 */
export function suggestOps(
  scope: ScopeInfo,
  stats: ScopeStats,
  options: SuggestOptions,
): { ops: SuggestCandidate[]; report: string } {
  const mergeThreshold = options.mergeThreshold ?? DEFAULT_MERGE_THRESHOLD;
  const clusterThreshold = options.clusterThreshold ?? DEFAULT_CLUSTER_THRESHOLD;
  const keyMap = options.baseTemplate
    ? new Map(options.baseTemplate.rows.map((row) => [row.categoryId, new Set(row.attributes.map((attr) => attr[0]))]))
    : undefined;
  const ops: SuggestCandidate[] = [];
  const reportLines: string[] = [
    `# suggest 候选报告`,
    ``,
    `范围：${scope.path.join(" > ")}（${scope.id}）`,
    `证据源：${stats.sourceNote ?? "离线统计（fixture）"}`,
    `末级类目 ${stats.leaves.length} 个，scope 样本 ${stats.scopeSamples.length} 条，min-products=${options.minProducts}，merge 阈值=${mergeThreshold}`,
    ``,
  ];

  // merge
  const mergePairs = findMergePairs(stats.leaves, keyMap, mergeThreshold);
  reportLines.push(`## merge（${mergePairs.length}）`, ``);
  for (const pair of mergePairs) {
    // 存续者默认取商品数多者；并列时取 id 较小者保证确定
    const [loser, target] = pair.a.productCount === pair.b.productCount
      ? (pair.a.id.localeCompare(pair.b.id) < 0 ? [pair.b, pair.a] : [pair.a, pair.b])
      : (pair.a.productCount > pair.b.productCount ? [pair.b, pair.a] : [pair.a, pair.b]);
    ops.push({
      type: "merge",
      params: {
        sources: [loser.id, target.id],
        target: target.id,
        reason: `名称/样本标题高度相似（score=${pair.score.toFixed(3)}），建议并入 ${target.name}`,
      },
      evidence: {
        score: Number(pair.score.toFixed(4)),
        nameSimilarity: Number(pair.nameSim.toFixed(4)),
        titleOverlap: Number(pair.titleSim.toFixed(4)),
        attrKeyOverlap: Number(pair.attrSim.toFixed(4)),
        productCounts: { [pair.a.id]: pair.a.productCount, [pair.b.id]: pair.b.productCount },
        paths: { [pair.a.id]: pair.a.path, [pair.b.id]: pair.b.path },
        samplePairs: pair.pairs,
      },
    });
    reportLines.push(
      `- \`${loser.name}\`（${loser.productCount}）→ \`${target.name}\`（${target.productCount}）：` +
      `score=${pair.score.toFixed(3)}（名称 ${pair.nameSim.toFixed(2)} / 标题 ${pair.titleSim.toFixed(2)} / 属性 ${pair.attrSim.toFixed(2)}）`,
      ...pair.pairs.slice(0, 3).map(([left, right]) => `  - 标题对：「${left}」≈「${right}」`),
    );
  }
  reportLines.push(``);

  // split
  const splitOps: SuggestCandidate[] = [];
  reportLines.push(`## split（待聚类后确定）`, ``);
  for (const leaf of stats.leaves) {
    if (leaf.productCount < options.minProducts) continue;
    const stable = clusterTitles(leaf.samples, clusterThreshold)
      .filter((cluster) => cluster.samples.length >= MIN_CLUSTER_SIZE)
      .sort((a, b) => b.samples.length - a.samples.length || a.samples[0]!.title.localeCompare(b.samples[0]!.title));
    if (stable.length < 2) continue;
    const clusters = stable.map((cluster, index) => {
      const keywords = clusterKeywords(cluster, stable.filter((other) => other !== cluster));
      return {
        index,
        keywords,
        size: cluster.samples.length,
        samples: cluster.samples.slice(0, 3).map((sample) => sample.title),
      };
    });
    splitOps.push({
      type: "split",
      params: {
        source: leaf.id,
        children: clusters.map((cluster) => ({ name: placeholderName(cluster.keywords, cluster.index) })),
        reason: `商品 ${leaf.productCount} 个且样本标题稳定聚成 ${stable.length} 簇，建议拆分（子类目名为占位，审批时定名）`,
      },
      evidence: {
        productCount: leaf.productCount,
        path: leaf.path,
        clusters,
      },
    });
    reportLines.push(
      `- \`${leaf.name}\`（${leaf.productCount}）：${stable.length} 簇`,
      ...clusters.map((cluster) => `  - 簇 ${cluster.index + 1}（${cluster.size} 条，线索：${cluster.keywords.join("、") || "无"}）：${cluster.samples.map((title) => `「${title}」`).join("")}`),
    );
  }
  ops.push(...splitOps);
  reportLines[reportLines.indexOf(`## split（待聚类后确定）`)] = `## split（${splitOps.length}）`;
  reportLines.push(``);

  // disable
  const disabled = stats.leaves.filter((leaf) => leaf.productCount === 0);
  reportLines.push(`## disable（${disabled.length}）`, ``);
  for (const leaf of disabled) {
    ops.push({
      type: "disable",
      params: { id: leaf.id, reason: `ES 零挂载商品（范围 ${scope.name}），建议禁用` },
      evidence: { productCount: 0, path: leaf.path },
    });
    reportLines.push(`- \`${leaf.name}\`：零挂载`);
  }
  reportLines.push(``);

  // add：scope 样本中 standardCategory.id 落不进本范围 enabled 末级集合的，即悬空/错挂证据
  const leafIds = new Set(stats.leaves.map((leaf) => leaf.id));
  const orphans = findOrphanSamples(leafIds, stats.scopeSamples);
  const orphanClusters = clusterTitles(orphans, clusterThreshold)
    .filter((cluster) => cluster.samples.length >= MIN_CLUSTER_SIZE)
    .sort((a, b) => b.samples.length - a.samples.length || a.samples[0]!.title.localeCompare(b.samples[0]!.title));
  reportLines.push(`## add（${orphanClusters.length}）`, ``);
  orphanClusters.forEach((cluster, index) => {
    const keywords = clusterKeywords(cluster, orphanClusters.filter((other) => other !== cluster));
    const samples = cluster.samples.slice(0, 3).map((sample) => sample.title);
    ops.push({
      type: "add",
      params: {
        parentId: scope.id,
        name: placeholderName(keywords, index),
      },
      evidence: {
        orphanCount: cluster.samples.length,
        keywords,
        samples,
        note: "scope 样本的 standardCategory.id 不在本范围 enabled 末级集合内（含 standardCategory 缺失），疑似悬空/错挂（名称为占位，审批时定名）",
      },
    });
    reportLines.push(`- 悬空 ${cluster.samples.length} 条（线索：${keywords.join("、") || "无"}）：${samples.map((title) => `「${title}」`).join("")}`);
  });
  reportLines.push(``);

  const counts = {
    merge: mergePairs.length,
    split: splitOps.length,
    disable: disabled.length,
    add: orphanClusters.length,
  };
  reportLines.push(`---`, `合计：merge ${counts.merge}，split ${counts.split}，disable ${counts.disable}，add ${counts.add}`);
  return { ops, report: `${reportLines.join("\n")}\n` };
}
