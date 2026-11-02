import { Database } from 'bun:sqlite';
import { digest } from '../contracts.ts';

/**
 * Faithful aggregation of contextual candidates into per-name evidence packages.
 *
 * This module deliberately performs no semantic work: no name normalisation, no
 * suffix stripping, no token overlap, no unit-based merging, no synonym guessing.
 * Which candidate names denote the same concept is decided by the model against
 * the accumulated dictionary; the program only counts, packages and validates.
 * Ranking uses distinct leaf-category count, which is a property of the data and
 * not a judgement about correctness or importance.
 */

export interface Variant {
  description: string | null;
  type: string | null;
  unit: string | null;
  format: string | null;
  requiredCount: number;
  count: number;
  samplePaths: string[][];
}

export interface NameEvidence {
  rank: number;
  name: string;
  leafCategories: number;
  candidates: number;
  firstLevelSpread: Array<{ firstLevel: string; leafCategories: number }>;
  /** Most frequent variants, then an evenly spaced sample of the remainder. */
  variants: Variant[];
  variantsTotal: number;
  variantsSampled: number;
  optionSamples: string[];
  optionSamplesTruncated: boolean;
}

export interface ExtractResult {
  schema: 'sanheng-canonical-evidence-v1';
  namespace: string;
  sourceDictionaryHash: string;
  /** Path segments shared by every category, dropped from the reported spread. */
  commonPathPrefix: string[];
  totals: { leafCategories: number; candidates: number; distinctNames: number };
  /** Cumulative share of (name, leaf-category) pairs covered by the top N ranks. */
  coverage: Array<{ throughRank: number; cumulativeShare: number }>;
  names: NameEvidence[];
}

interface Row { category_id: string; path: string; name: string; property: string }

const VARIANT_HEAD = 30;
const VARIANT_SPREAD = 30;
const OPTION_CAP = 40;
const SAMPLE_PATH_CAP = 2;

/**
 * Head by frequency plus an evenly spaced sample of the tail. A name such as 材质
 * carries thousands of variants; showing only the most frequent ones would hide the
 * range of described objects the model has to distinguish. Even spacing is a
 * deterministic sample of the data, not a judgement about which variants matter.
 */
function sampleVariants(sorted: Variant[]): Variant[] {
  if (sorted.length <= VARIANT_HEAD + VARIANT_SPREAD) return sorted;
  const head = sorted.slice(0, VARIANT_HEAD);
  const tail = sorted.slice(VARIANT_HEAD);
  const step = tail.length / VARIANT_SPREAD;
  const spread: Variant[] = [];
  for (let index = 0; index < VARIANT_SPREAD; index += 1) spread.push(tail[Math.floor(index * step)]!);
  return [...head, ...spread];
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() ? value : null;
  return String(value);
}

export function extract(db: Database, options: { namespace?: string; topNames?: number } = {}): ExtractResult {
  const namespace = options.namespace ?? 'sanheng';
  const rows = db.query<Row, [string]>(
    'SELECT category_id, path, name, property FROM candidates_v1 WHERE namespace=? ORDER BY name, category_id, id',
  ).all(namespace);
  if (!rows.length) throw new Error(`命名空间没有候选记录: ${namespace}`);

  interface Bucket {
    name: string;
    leaves: Set<string>;
    candidates: number;
    firstLevel: Map<string, Set<string>>;
    variants: Map<string, Variant>;
    options: Set<string>;
    optionsTruncated: boolean;
  }
  const buckets = new Map<string, Bucket>();
  const allLeaves = new Set<string>();

  // Every category shares a synthetic root; report the spread from the first segment
  // that actually varies rather than assuming a fixed depth or a known root name.
  const paths = rows.map((row) => JSON.parse(row.path) as string[]);
  let prefix = 0;
  while (prefix < (paths[0]?.length ?? 0) - 1 && paths.every((path) => path[prefix] === paths[0]![prefix])) prefix += 1;

  for (const [position, row] of rows.entries()) {
    const path = paths[position]!;
    const property = JSON.parse(row.property) as Record<string, unknown>;
    allLeaves.add(row.category_id);
    let bucket = buckets.get(row.name);
    if (!bucket) {
      bucket = {
        name: row.name, leaves: new Set(), candidates: 0,
        firstLevel: new Map(), variants: new Map(), options: new Set(), optionsTruncated: false,
      };
      buckets.set(row.name, bucket);
    }
    bucket.leaves.add(row.category_id);
    bucket.candidates += 1;

    const first = path[prefix] ?? '（无上级类目）';
    let firstSet = bucket.firstLevel.get(first);
    if (!firstSet) { firstSet = new Set(); bucket.firstLevel.set(first, firstSet); }
    firstSet.add(row.category_id);

    const description = str(property.description);
    const type = str(property.type);
    const unit = str(property.unit);
    const format = str(property.format);
    const key = digest({ description, type, unit, format });
    let variant = bucket.variants.get(key);
    if (!variant) {
      variant = { description, type, unit, format, requiredCount: 0, count: 0, samplePaths: [] };
      bucket.variants.set(key, variant);
    }
    variant.count += 1;
    if (property.required === true) variant.requiredCount += 1;
    if (variant.samplePaths.length < SAMPLE_PATH_CAP) variant.samplePaths.push(path);

    const options = property.options;
    if (Array.isArray(options)) {
      for (const option of options) {
        const text = str(option);
        if (text === null) continue;
        if (bucket.options.size >= OPTION_CAP) { bucket.optionsTruncated = true; break; }
        bucket.options.add(text);
      }
    }
  }

  const ordered = [...buckets.values()].sort(
    (a, b) => b.leaves.size - a.leaves.size || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const totalPairs = ordered.reduce((sum, bucket) => sum + bucket.leaves.size, 0);

  const coverage: ExtractResult['coverage'] = [];
  let running = 0;
  const marks = new Set([100, 300, 500, 800, 1000, 1500, 2000, 3000, 5000, ordered.length]);
  ordered.forEach((bucket, index) => {
    running += bucket.leaves.size;
    if (marks.has(index + 1)) coverage.push({ throughRank: index + 1, cumulativeShare: running / totalPairs });
  });

  const limit = options.topNames ?? ordered.length;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('topNames必须为正整数');

  const names: NameEvidence[] = ordered.slice(0, limit).map((bucket, index) => {
    const variants = [...bucket.variants.values()].sort(
      (a, b) => b.count - a.count || ((a.description ?? '') < (b.description ?? '') ? -1 : 1),
    );
    const sampled = sampleVariants(variants);
    return {
      rank: index + 1,
      name: bucket.name,
      leafCategories: bucket.leaves.size,
      candidates: bucket.candidates,
      firstLevelSpread: [...bucket.firstLevel.entries()]
        .map(([firstLevel, leaves]) => ({ firstLevel, leafCategories: leaves.size }))
        .sort((a, b) => b.leafCategories - a.leafCategories || (a.firstLevel < b.firstLevel ? -1 : 1)),
      variants: sampled,
      variantsTotal: variants.length,
      variantsSampled: sampled.length,
      optionSamples: [...bucket.options].sort(),
      optionSamplesTruncated: bucket.optionsTruncated,
    };
  });

  const sourceRow = db.query<{ h: string }, []>(
    "SELECT group_concat(id) h FROM (SELECT id FROM sources_v1 ORDER BY id)",
  ).get();

  return {
    schema: 'sanheng-canonical-evidence-v1',
    namespace,
    sourceDictionaryHash: digest(sourceRow?.h ?? null),
    commonPathPrefix: paths[0]!.slice(0, prefix),
    totals: { leafCategories: allLeaves.size, candidates: rows.length, distinctNames: ordered.length },
    coverage,
    names,
  };
}

/**
 * Rank-based batching. Frequency rank is a deterministic, non-semantic cut, so the
 * program never decides which names belong together; the model sees each batch
 * alongside the whole accumulated dictionary and proposes the merges itself.
 */
export function batch(result: ExtractResult, size: number): NameEvidence[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('批次大小必须为正整数');
  const batches: NameEvidence[][] = [];
  for (let index = 0; index < result.names.length; index += size) {
    batches.push(result.names.slice(index, index + size));
  }
  return batches;
}
