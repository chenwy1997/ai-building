import type { NameEvidence } from './extract.ts';

/**
 * Compact, model-facing rendering of one evidence batch.
 *
 * The JSON packages keep every sampled variant with its full category paths, which is
 * the right shape for audit but runs to hundreds of thousands of tokens. For a model
 * request the same evidence is folded to one line per distinct (description, type,
 * unit) with a single example category, so the dictionary and the batch both fit in
 * context. This is aggregation and truncation only: no name normalisation, no
 * grouping, no synonym guessing. Counts and totals are reported so the reader can
 * see what was left out rather than being shown a silently trimmed list.
 */

export interface RenderOptions {
  /** Distinct description lines kept per attribute name. */
  variantLines?: number;
  /** First-level category counts kept per attribute name. */
  spread?: number;
  /** Sampled option values kept per attribute name. */
  options?: number;
}

interface Folded {
  description: string;
  type: string;
  unit: string;
  count: number;
  example: string;
}

function fold(entry: NameEvidence): { lines: Folded[]; distinct: number } {
  const merged = new Map<string, Folded>();
  for (const variant of entry.variants) {
    const description = variant.description ?? '（无说明）';
    const type = variant.type ?? '—';
    const unit = variant.unit ?? '—';
    const key = `${description}\u0000${type}\u0000${unit}`;
    const existing = merged.get(key);
    if (existing) {
      existing.count += variant.count;
      continue;
    }
    const path = variant.samplePaths[0] ?? [];
    merged.set(key, { description, type, unit, count: variant.count, example: path.slice(-2).join('/') });
  }
  const lines = [...merged.values()].sort((a, b) => b.count - a.count || (a.description < b.description ? -1 : 1));
  return { lines, distinct: lines.length };
}

export function renderName(entry: NameEvidence, options: RenderOptions = {}): string {
  const variantLines = options.variantLines ?? 18;
  const spread = options.spread ?? 6;
  const optionCount = options.options ?? 10;
  const { lines, distinct } = fold(entry);

  const out: string[] = [];
  out.push(`## ${entry.name}`);
  out.push(`涉及末级类目 ${entry.leafCategories}，历史变体总数 ${entry.variantsTotal}（已采样 ${entry.variantsSampled} 个，折叠为 ${distinct} 种说明）`);
  if (entry.firstLevelSpread.length) {
    const shown = entry.firstLevelSpread.slice(0, spread).map((item) => `${item.firstLevel} ${item.leafCategories}`);
    const rest = entry.firstLevelSpread.length - shown.length;
    out.push(`一级类目：${shown.join('，')}${rest > 0 ? `，另有 ${rest} 个一级类目` : ''}`);
  }
  if (entry.optionSamples.length) {
    const shown = entry.optionSamples.slice(0, optionCount);
    out.push(
      `值样本（采样，非封闭枚举）：${shown.join(' | ')}${entry.optionSamples.length > shown.length || entry.optionSamplesTruncated ? ' …' : ''}`,
    );
  }
  out.push('原始说明 [类型|单位] 频次 ← 示例类目：');
  for (const line of lines.slice(0, variantLines)) {
    out.push(`  ${line.count} [${line.type}|${line.unit}] ${line.description}${line.example ? ` ← ${line.example}` : ''}`);
  }
  if (lines.length > variantLines) out.push(`  （另有 ${lines.length - variantLines} 种说明未列出）`);
  return out.join('\n');
}

export function renderBatch(names: NameEvidence[], options: RenderOptions = {}): string {
  const header = [
    `本批 ${names.length} 个历史属性名，排名 ${names[0]?.rank ?? '?'} 到 ${names.at(-1)?.rank ?? '?'}。`,
    '证据是历史模板与采样的忠实聚合。同名不代表同义，值样本不代表封闭枚举，出现频次不证明必填或正确。',
    '说明里出现产品名或类目名时，先去掉它再判断剩下的概念；不要按名称字符串相似度归并。',
    '为控制篇幅，同一说明在不同格式下的记录已合并计数，格式列未列出；变体列表按频次截断，截断数量已标注。',
  ].join('\n');
  return [header, ...names.map((entry) => renderName(entry, options))].join('\n\n');
}
