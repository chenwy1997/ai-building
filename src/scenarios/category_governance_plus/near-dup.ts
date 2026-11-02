import type { Category } from "../category_attributes_governance/types.ts";
import { GENERIC_NAME_WORDS, normalizeCategoryName } from "./audit.ts";
import { jaccard, tokenize } from "./suggest.ts";

/** 近似名重复扫描：归一化后不相同、但 bigram 相似度过阈值的末级对。纯函数，可测试。 */

export interface NearDupPair {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  aPath: string[];
  bPath: string[];
  similarity: number;
  /** 同一一级域（pathNames[1]）内；跨域高风险单独分组 */
  sameDomain: boolean;
}

export interface NearDupOptions {
  threshold?: number;
  /** 排除 id（如已在墓碑里的节点；输入来自最新版本树时自然满足，这里是防线） */
  excludeIds?: Set<string>;
  /** 跨域候选的倒排索引 df 上限：超常见 token 不可能撑起 ≥0.75 的相似度（默认 2000） */
  maxDocFreq?: number;
}

const domainOf = (leaf: Category): string => leaf.pathNames[1] ?? "";
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

interface Indexed {
  leaf: Category;
  normalized: string;
  tokens: Set<string>;
}

export function scanNearDuplicates(leaves: Category[], options: NearDupOptions = {}): NearDupPair[] {
  const threshold = options.threshold ?? 0.75;
  const maxDocFreq = options.maxDocFreq ?? 2000;
  const candidates: Indexed[] = [];
  for (const leaf of leaves) {
    if (!leaf.enabled || !leaf.isLeaf) continue;
    if (options.excludeIds?.has(leaf.id)) continue;
    if (GENERIC_NAME_WORDS.some((word) => leaf.name.includes(word))) continue;
    const normalized = normalizeCategoryName(leaf.name);
    if (!normalized) continue;
    candidates.push({ leaf, normalized, tokens: tokenize(normalized) });
  }

  const pairs = new Map<string, NearDupPair>();
  const record = (a: Indexed, b: Indexed): void => {
    if (a.normalized === b.normalized) return; // 归一化重名是 audit 的地盘
    const similarity = jaccard(a.tokens, b.tokens);
    if (similarity < threshold) return;
    const [first, second] = a.leaf.id < b.leaf.id ? [a, b] : [b, a];
    pairs.set(pairKey(a.leaf.id, b.leaf.id), {
      aId: first.leaf.id,
      bId: second.leaf.id,
      aName: first.leaf.name,
      bName: second.leaf.name,
      aPath: first.leaf.pathNames,
      bPath: second.leaf.pathNames,
      similarity: Number(similarity.toFixed(4)),
      sameDomain: domainOf(first.leaf) === domainOf(second.leaf),
    });
  };

  // 同域：组内两两比较（最大组 ~2.3k 叶，百万级对可接受）
  const byDomain = new Map<string, Indexed[]>();
  for (const item of candidates) {
    const domain = domainOf(item.leaf);
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), item]);
  }
  for (const group of byDomain.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) record(group[i]!, group[j]!);
    }
  }

  // 跨域：token 倒排索引，只比较共享 token 的对（df 封顶，超常见 token 撑不起 0.75）
  const index = new Map<string, Indexed[]>();
  for (const item of candidates) {
    for (const token of item.tokens) {
      index.set(token, [...(index.get(token) ?? []), item]);
    }
  }
  for (const postings of index.values()) {
    if (postings.length > maxDocFreq) continue;
    for (let i = 0; i < postings.length; i += 1) {
      for (let j = i + 1; j < postings.length; j += 1) {
        const a = postings[i]!;
        const b = postings[j]!;
        if (domainOf(a.leaf) === domainOf(b.leaf)) continue;
        const key = pairKey(a.leaf.id, b.leaf.id);
        if (pairs.has(key)) continue;
        record(a, b);
      }
    }
  }

  return [...pairs.values()].sort(
    (a, b) => b.similarity - a.similarity || a.aId.localeCompare(b.aId) || a.bId.localeCompare(b.bId),
  );
}
