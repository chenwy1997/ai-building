import { createHash } from 'node:crypto';
import { resolveDictionary, validateAttributeValue } from './attribute-contract.mjs';
import { formatSkuDimensions, projectSkuText } from './sku-value-normalization';
import type { TextProjectionRule } from './sku-value-normalization';

/**
 * Offline SKU proposals. Source text is untrusted data, never instructions. The
 * checks below establish structure, provenance, type and selected deterministic
 * transformations only; they cannot establish identity, applicability, meaning,
 * exhaustiveness, or accuracy. Every value remains subject to independent review.
 * Offsets are JavaScript UTF-16 code-unit offsets, start inclusive / end exclusive.
 */
export type SourceReadState = 'available' | 'empty' | 'image_only' | 'unread' | 'read_failed' | 'truncated';
export type FillStatus = 'proposed' | 'missing' | 'needs_evidence' | 'conflict' | 'identity_review' | 'out_of_domain' | 'not_applicable' | 'read_failed';
export type FillValue = string | number | boolean | string[] | null;

export interface SkuIdentity {
  skuId: string;
  categoryId: string;
  [metadata: string]: unknown;
}

export interface SkuSource {
  sourceId: string;
  skuId: string;
  kind: string;
  field: string;
  /** Additional upstream locator; kind and field still identify a source when omitted. */
  locator?: string;
  readState: SourceReadState;
  /** Original, unmodified text; null when no text was retrieved. */
  text: string | null;
  /** SHA-256 of the UTF-8 encoding of text; null when text is null. */
  sha256: string | null;
  [metadata: string]: unknown;
}

export interface EvidenceReference {
  sourceId: string;
  start: number;
  end: number;
  quote: string;
  [metadata: string]: unknown;
}

export type Normalization = (
  | { method: 'exact' }
  | { method: 'nfkc' }
  | { method: 'number'; evidenceIndex: number; token: string }
  | { method: 'boolean_literal'; evidenceIndex: number }
  | { method: 'semantic'; reason: string }
  | { method: 'category_inference'; packId: string; ruleId: string; reason: string; assumptions: string[] }
  | { method: 'text_projection'; evidenceIndex: number; rule: TextProjectionRule; scope?: string }
  | { method: 'dictionary_alias' }
  | { method: 'measurement_option'; mappings: Array<{ value: string; evidenceIndex: number; token: string }> }
) & { formatting?: { rule: 'dimensions'; inputValue: string } };

export interface SkuObservation {
  value: Exclude<FillValue, null>;
  normalization: Normalization;
  /** Optional human-readable context; does not establish semantic equivalence. */
  notes?: string;
}

export interface SkuFillRow {
  skuId: string;
  categoryId: string;
  attributeKey: string;
  value: FillValue;
  status: FillStatus;
  evidence: EvidenceReference[];
  normalization?: Normalization;
  observations?: SkuObservation[];
  notes?: string;
  [metadata: string]: unknown;
}

export interface CheckIssue {
  code: string;
  path: string;
  message: string;
}

export interface SkuFillInput {
  /** Exact bytes of the frozen JSON file, or its UTF-8 text. */
  contractText: string | Uint8Array;
  /** Expected SHA-256 obtained separately, not recalculated from a changed file. */
  expectedContractSha256: string;
  skus: SkuIdentity[];
  sources: SkuSource[];
  rows: SkuFillRow[];
}

export interface RowCheck {
  /** The original author output, including blocked candidates and all evidence. */
  original: SkuFillRow;
  blockingIssues: CheckIssue[];
  warnings: CheckIssue[];
  /** Verified here means only the declared conversion, never semantic correctness. */
  normalizationCheck: 'verified' | 'unverified' | 'failed' | 'not_applicable';
  programStatus: 'blocked' | 'awaiting_review' | 'unresolved';
  reviewRequired: true;
}

export interface SkuFillReport {
  version: 1;
  contractSha256: string | null;
  /** Entire batch passes structure/provenance checks; never a claim of semantic correctness. */
  structureValid: boolean;
  issues: CheckIssue[];
  coverage: { expected: number; submitted: number; missing: number; duplicates: number; unexpected: number };
  rows: RowCheck[];
  limitation: string;
}

export const hashSourceText = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
export const hashContract = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const issue = (code: string, path: string, message: string): CheckIssue => ({ code, path, message });
const joinKey = (...parts: string[]) => JSON.stringify(parts);
const validStatuses = new Set<FillStatus>(['proposed', 'missing', 'needs_evidence', 'conflict', 'identity_review', 'out_of_domain', 'not_applicable', 'read_failed']);
const validReadStates = new Set<SourceReadState>(['available', 'empty', 'image_only', 'unread', 'read_failed', 'truncated']);
const incompleteReadStates = new Set<SourceReadState>(['image_only', 'unread', 'read_failed', 'truncated']);
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// These units denote actual physical conversions, not packaging or attribute
// equivalence. Counts intentionally have distinct dimensions (抽/张/层/只...).
const units: Record<string, { dimension: string; factor: number }> = {
  '1': { dimension: 'unitless', factor: 1 },
  '层': { dimension: 'layer', factor: 1 }, '抽': { dimension: 'pull', factor: 1 },
  '张': { dimension: 'sheet', factor: 1 }, '片': { dimension: 'piece', factor: 1 },
  '只': { dimension: 'item-zhi', factor: 1 }, '个': { dimension: 'item-ge', factor: 1 },
  '卷': { dimension: 'roll', factor: 1 }, '包': { dimension: 'pack', factor: 1 }, '盒': { dimension: 'box', factor: 1 },
  'g': { dimension: 'mass', factor: 1 }, '克': { dimension: 'mass', factor: 1 },
  'kg': { dimension: 'mass', factor: 1000 }, '千克': { dimension: 'mass', factor: 1000 },
  'mg': { dimension: 'mass', factor: 0.001 }, '毫克': { dimension: 'mass', factor: 0.001 },
  'mm': { dimension: 'length', factor: 1 }, '毫米': { dimension: 'length', factor: 1 },
  'cm': { dimension: 'length', factor: 10 }, '厘米': { dimension: 'length', factor: 10 },
  'm': { dimension: 'length', factor: 1000 }, '米': { dimension: 'length', factor: 1000 },
  'ml': { dimension: 'volume', factor: 1 }, '毫升': { dimension: 'volume', factor: 1 },
  'l': { dimension: 'volume', factor: 1000 }, '升': { dimension: 'volume', factor: 1000 },
  'g/m2': { dimension: 'surface-density', factor: 1 }, '克/平方米': { dimension: 'surface-density', factor: 1 },
};
const unitKey = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

// Limited unambiguous Chinese integers; deliberately no fuzzy numeral conversion.
function chineseInteger(raw: string): number | null {
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (Array.from(raw).every(c => c in digits)) return Number(Array.from(raw).map(c => digits[c]).join(''));
  if (!/^[一二两三四五六七八九]?十[一二三四五六七八九]?$/.test(raw)) return null;
  const [tens, ones] = raw.split('十');
  return (tens ? digits[tens]! : 1) * 10 + (ones ? digits[ones]! : 0);
}

function parseQuantity(token: string): { number: number; unit: string } | null {
  const normalized = token.normalize('NFKC').trim();
  const match = normalized.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+)|[零〇一二两三四五六七八九十]+)\s*([^\s]+)?$/);
  if (!match) return null;
  const value = /^[+-]?(?:\d|\.)/.test(match[1]!) ? Number(match[1]) : chineseInteger(match[1]!);
  if (value === null || !Number.isFinite(value)) return null;
  return { number: value, unit: unitKey(match[2] ?? '1') };
}

function numericEqual(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 8;
}

/** Validates input while preserving each original row; never fills or changes a value. */
export function validateSkuFill(input: SkuFillInput): SkuFillReport {
  const issues: CheckIssue[] = [];
  const rows = Array.isArray(input?.rows) ? input.rows : [];
  const skus = Array.isArray(input?.skus) ? input.skus : [];
  const sources = Array.isArray(input?.sources) ? input.sources : [];
  const checkedRows: RowCheck[] = rows.map(original => ({ original, blockingIssues: [], warnings: [], normalizationCheck: 'not_applicable', programStatus: 'unresolved', reviewRequired: true }));
  const addGlobal = (code: string, path: string, message: string) => issues.push(issue(code, path, message));
  const addRow = (i: number, code: string, path: string, message: string) => checkedRows[i]!.blockingIssues.push(issue(code, `rows[${i}]${path}`, message));
  const warnRow = (i: number, code: string, message: string) => checkedRows[i]!.warnings.push(issue(code, `rows[${i}]`, message));
  for (const field of ['skus', 'sources', 'rows'] as const) if (!Array.isArray(input?.[field])) addGlobal('input_shape', field, '必须是数组');
  if (Array.isArray(input?.skus) && !input.skus.length) addGlobal('empty_batch', 'skus', '批次必须包含至少一个 SKU');

  let contract: Record<string, any> | null = null;
  let actualHash: string | null = null;
  let contractUsable = false;
  try {
    if (typeof input?.contractText !== 'string' && !(input?.contractText instanceof Uint8Array)) throw new Error('合同需原始 UTF-8 文本或字节');
    actualHash = hashContract(input.contractText);
    if (!validHash(input.expectedContractSha256) || actualHash !== input.expectedContractSha256.toLowerCase()) {
      addGlobal('contract_hash', 'expectedContractSha256', '属性合同原始文件 SHA-256 与预先冻结值不一致');
    }
    const text = typeof input.contractText === 'string' ? input.contractText : new TextDecoder('utf-8', { fatal: true }).decode(input.contractText);
    const decoded: unknown = JSON.parse(text);
    if (!isObject(decoded) || decoded.attributeContractVersion !== 1 || !Array.isArray(decoded.proposals)) throw new Error('合同需 attributeContractVersion=1 和 proposals 数组');
    contract = decoded;
    contractUsable = validHash(input.expectedContractSha256) && actualHash === input.expectedContractSha256.toLowerCase();
  } catch (error) {
    addGlobal('contract_invalid', 'contractText', error instanceof Error ? error.message : '合同不可解析');
  }

  const attrs = new Map<string, Record<string, any>>();
  const attrsByCategory = new Map<string, Record<string, any>[]>();
  for (const [i, attribute] of (contract?.proposals ?? []).entries()) {
    if (!isObject(attribute) || !nonempty(attribute.categoryId) || !nonempty(attribute.key)) {
      addGlobal('contract_attribute', `contract.proposals[${i}]`, '冻结属性必须有类目 ID 和 key'); contractUsable = false; continue;
    }
    const k = joinKey(attribute.categoryId, attribute.key);
    if (attrs.has(k)) { addGlobal('contract_duplicate_attribute', `contract.proposals[${i}]`, '冻结类目中属性 key 重复'); contractUsable = false; continue; }
    attrs.set(k, attribute);
    const group = attrsByCategory.get(attribute.categoryId) ?? [];
    group.push(attribute); attrsByCategory.set(attribute.categoryId, group);
  }
  if (contract && !attrs.size) { addGlobal('contract_empty', 'contract.proposals', '冻结合同中没有可用属性'); contractUsable = false; }

  // Knowledge is scoped by real category IDs and definition IDs already present
  // in the frozen contract. It describes reasoning, not a value conversion.
  const knowledgePacks = new Map<string, Record<string, any>>();
  if (contract?.extractionKnowledge !== undefined) {
    const knowledge = contract.extractionKnowledge;
    if (!isObject(knowledge) || knowledge.version !== 1 || !Array.isArray(knowledge.packs)) {
      addGlobal('knowledge_shape', 'contract.extractionKnowledge', '品类知识须为 version=1 的包数组'); contractUsable = false;
    } else for (const [i, pack] of knowledge.packs.entries()) {
      const path = `contract.extractionKnowledge.packs[${i}]`;
      const versionOk = (typeof pack?.version === 'string' && nonempty(pack.version)) ||
        (Number.isInteger(pack?.version) && pack.version > 0);
      if (!isObject(pack) || !nonempty(pack.id) || !versionOk || !Array.isArray(pack.categoryIds) || !pack.categoryIds.length ||
          pack.categoryIds.some((id: unknown) => !nonempty(id) || !attrsByCategory.has(id as string)) ||
          new Set(pack.categoryIds).size !== pack.categoryIds.length || !Array.isArray(pack.rules) || !pack.rules.length || knowledgePacks.has(pack.id)) {
        addGlobal('knowledge_pack', path, '知识包须有唯一 ID、版本、已治理真实类目 ID 和非空规则'); contractUsable = false; continue;
      }
      const rules = new Map<string, Record<string, any>>();
      const availableDefinitions = new Set(pack.categoryIds.flatMap((id: string) => (attrsByCategory.get(id) ?? []).map(a => a.definitionId)).filter(nonempty));
      for (const [j, rule] of pack.rules.entries()) {
        if (!isObject(rule) || !nonempty(rule.id) || rules.has(rule.id) || !nonempty(rule.description) ||
            !Array.isArray(rule.definitionIds) || !rule.definitionIds.length ||
            rule.definitionIds.some((id: unknown) => !nonempty(id) || !availableDefinitions.has(id as string)) ||
            new Set(rule.definitionIds).size !== rule.definitionIds.length) {
          addGlobal('knowledge_rule', `${path}.rules[${j}]`, '规则须有唯一 ID、描述和包内已治理定义 ID'); contractUsable = false; continue;
        }
        rules.set(rule.id, rule);
      }
      knowledgePacks.set(pack.id, { ...pack, rulesById: rules });
    }
  }

  const skuById = new Map<string, SkuIdentity>();
  for (const [i, sku] of skus.entries()) {
    if (!isObject(sku) || !nonempty(sku.skuId) || !nonempty(sku.categoryId)) { addGlobal('sku_shape', `skus[${i}]`, 'SKU 必须含 skuId 和 categoryId'); continue; }
    if (skuById.has(sku.skuId)) { addGlobal('sku_duplicate', `skus[${i}].skuId`, 'SKU ID 重复，不能静默合并'); continue; }
    skuById.set(sku.skuId, sku as SkuIdentity);
    if (!attrsByCategory.has(sku.categoryId)) addGlobal('sku_category', `skus[${i}].categoryId`, '类目不在已冻结属性合同中');
  }

  const sourceById = new Map<string, SkuSource>();
  const invalidSourceIds = new Set<string>();
  const sourceBySku = new Map<string, SkuSource[]>();
  for (const [i, source] of sources.entries()) {
    const path = `sources[${i}]`;
    if (!isObject(source) || !nonempty(source.sourceId) || !nonempty(source.skuId)) { addGlobal('source_shape', path, '来源必须有 sourceId 和 skuId'); continue; }
    let bad = false;
    const fail = (code: string, field: string, message: string) => { addGlobal(code, `${path}${field}`, message); bad = true; };
    if (sourceById.has(source.sourceId)) { fail('source_duplicate', '.sourceId', 'sourceId 全批必须唯一'); invalidSourceIds.add(source.sourceId); }
    else sourceById.set(source.sourceId, source as SkuSource);
    const group = sourceBySku.get(source.skuId) ?? [];
    group.push(source as SkuSource); sourceBySku.set(source.skuId, group);
    if (!skuById.has(source.skuId)) fail('source_unknown_sku', '.skuId', '来源不属于本批 SKU');
    for (const field of ['kind', 'field']) if (!nonempty(source[field])) fail('source_shape', `.${field}`, '来源字段必须非空');
    if (source.locator !== undefined && !nonempty(source.locator)) fail('source_shape', '.locator', '提供定位时须为非空字符串');
    if (!validReadStates.has(source.readState)) fail('source_read_state', '.readState', '来源读取状态无效');
    if (source.text !== null && typeof source.text !== 'string') fail('source_text', '.text', '原文须为字符串或 null');
    else if (typeof source.text === 'string') {
      if (!validHash(source.sha256) || hashSourceText(source.text) !== source.sha256.toLowerCase()) fail('source_hash', '.sha256', '原文 SHA-256 不一致');
    } else if (source.sha256 !== null) fail('source_hash', '.sha256', '无原文时哈希须为 null');
    if (source.readState === 'available' && (typeof source.text !== 'string' || !source.text.trim())) fail('source_read_state', '.text', 'available 需要有效原文');
    if (source.readState === 'truncated' && (typeof source.text !== 'string' || !source.text)) fail('source_read_state', '.text', 'truncated 需要保留已取回的原文');
    if (source.readState === 'empty' && source.text !== null && (typeof source.text !== 'string' || source.text.trim())) fail('source_read_state', '.text', 'empty 须保留读取后为空的原文或空值');
    if (['image_only', 'unread', 'read_failed'].includes(source.readState) && source.text !== null && source.text !== '') fail('source_read_state', '.text', '此状态不应含文本；部分读取用 truncated');
    if (bad) invalidSourceIds.add(source.sourceId);
  }

  const expected = new Map<string, { skuId: string; categoryId: string; attributeKey: string }>();
  for (const sku of skuById.values()) for (const attr of attrsByCategory.get(sku.categoryId) ?? []) {
    const item = { skuId: sku.skuId, categoryId: sku.categoryId, attributeKey: attr.key };
    expected.set(joinKey(item.skuId, item.categoryId, item.attributeKey), item);
  }
  const rowIndices = new Map<string, number[]>();
  let unexpected = 0;
  for (const [i, row] of rows.entries()) {
    if (!isObject(row) || !nonempty(row.skuId) || !nonempty(row.categoryId) || !nonempty(row.attributeKey)) { addRow(i, 'row_shape', '', '建议行必须含 skuId、categoryId 和 attributeKey'); unexpected++; continue; }
    const k = joinKey(row.skuId, row.categoryId, row.attributeKey);
    const group = rowIndices.get(k) ?? []; group.push(i); rowIndices.set(k, group);
    if (!expected.has(k)) { addRow(i, 'unexpected_attribute', '', '不属于本批 SKU 的冻结类目属性；不新增或跨类填值'); unexpected++; }
  }
  let duplicates = 0;
  for (const indices of rowIndices.values()) if (indices.length > 1) {
    duplicates += indices.length - 1;
    for (const i of indices) addRow(i, 'duplicate_row', '', '同一 SKU/类目/属性的建议行重复');
  }
  let missing = 0;
  for (const [k, item] of expected) if (!rowIndices.has(k)) { missing++; addGlobal('missing_row', 'rows', `缺少 ${item.skuId} / ${item.categoryId} / ${item.attributeKey}`); }

  for (const [i, row] of rows.entries()) {
    if (!isObject(row)) continue;
    const p = attrs.get(joinKey(row.categoryId, row.attributeKey));
    const evidence = Array.isArray(row.evidence) ? row.evidence : [];
    const skuSources = sourceBySku.get(row.skuId) ?? [];
    if (!contractUsable) addRow(i, 'contract_unavailable', '', '冻结合同无效或哈希不匹配，建议不可使用');
    if (!validStatuses.has(row.status)) addRow(i, 'row_status', '.status', '无效建议状态');
    if (!Array.isArray(row.evidence)) addRow(i, 'evidence_shape', '.evidence', 'evidence 必须是数组');
    if (!('value' in row) || row.value === undefined) addRow(i, 'value_required', '.value', '未知必须显式为 null，不可省略');
    if (['missing', 'needs_evidence', 'conflict', 'identity_review', 'not_applicable', 'read_failed'].includes(row.status) && row.value !== null) addRow(i, 'unresolved_value', '.value', '未确定状态使用 null，原始候选可放在 observations');
    if (['proposed', 'out_of_domain'].includes(row.status) && (row.value === null || row.value === undefined)) addRow(i, 'candidate_missing_value', '.value', '候选值不能为 null');
    if (['proposed', 'out_of_domain', 'needs_evidence'].includes(row.status) && evidence.length === 0) addRow(i, 'evidence_required', '.evidence', '候选值或待补证线索必须有同 SKU 原文证据');
    if (['needs_evidence', 'identity_review', 'not_applicable', 'read_failed', 'conflict', 'out_of_domain'].includes(row.status) && !nonempty(row.notes)) addRow(i, 'reason_required', '.notes', '该状态需说明原因，不根据缺失自动判定');
    if (row.status === 'missing' && !skuSources.some(s => ['available', 'empty'].includes(s.readState) && !invalidSourceIds.has(s.sourceId))) {
      addRow(i, 'missing_without_read_source', '.status', '没有任何完整读取的文本来源，不能称在已读资料中未找到；保留读取状态');
    }
    if (row.status === 'missing' && skuSources.some(s => incompleteReadStates.has(s.readState) || invalidSourceIds.has(s.sourceId))) warnRow(i, 'incomplete_sources', 'missing 只表示已读资料中未找到；其他资料不完整，不能声称穷尽来源');
    if (row.status === 'read_failed' && skuSources.length && !skuSources.some(s => incompleteReadStates.has(s.readState))) addRow(i, 'read_state_mismatch', '.status', 'read_failed 需来源失败、未读取、截断或仅图片的记录');
    if (row.status === 'proposed' && skuSources.some(s => incompleteReadStates.has(s.readState))) warnRow(i, 'incomplete_sources', '部分资料不完整，可能隐藏相反证据，须在独立审校中处理');
    warnRow(i, 'semantic_review', '原文定位和确定性转换不能证明商品身份、属性对象、适用性、否定、完整性或语义；须独立审校');

    for (const [j, ref] of evidence.entries()) {
      const at = `.evidence[${j}]`;
      if (!isObject(ref) || !nonempty(ref.sourceId)) { addRow(i, 'evidence_shape', at, '证据引用必须有 sourceId、跨度和原文'); continue; }
      const source = sourceById.get(ref.sourceId);
      if (!source) { addRow(i, 'evidence_source_missing', at, '来源不存在'); continue; }
      if (invalidSourceIds.has(ref.sourceId)) addRow(i, 'evidence_source_invalid', at, '来源记录或哈希无效');
      if (source.skuId !== row.skuId) addRow(i, 'evidence_cross_sku', at, '证据必须归属于该 SKU，不能跨 SKU 传播');
      if (!['available', 'truncated'].includes(source.readState) || typeof source.text !== 'string') { addRow(i, 'evidence_unreadable', at, '该来源没有可定位的原文'); continue; }
      if (!Number.isInteger(ref.start) || !Number.isInteger(ref.end) || ref.start < 0 || ref.end <= ref.start || ref.end > source.text.length || !nonempty(ref.quote) || source.text.slice(ref.start, ref.end) !== ref.quote) {
        addRow(i, 'evidence_span', at, '原文跨度须为有效 UTF-16 偏移且与 quote 完全一致');
      }
    }

    const checkNormalization = (value: unknown, normalization: unknown, at: string) => {
      if (!p || value === null || value === undefined) return;
      if (!isObject(normalization) || !nonempty(normalization.method)) { addRow(i, 'normalization_required', at, '有值须记录可核查的规范化方式'); return; }
      if (normalization.formatting !== undefined) {
        const formatting = normalization.formatting;
        if (p.type !== 'text' || p.definitionId !== 'cleaning.dimensions' || !isObject(formatting) || formatting.rule !== 'dimensions' ||
            typeof formatting.inputValue !== 'string' || typeof value !== 'string') {
          addRow(i, 'formatting_contract', `${at}.formatting`, '尺寸格式仅用于尺寸文本，须保留原建议值');
        } else {
          const formatted = formatSkuDimensions(formatting.inputValue);
          if (formatted === null || formatted !== value) addRow(i, 'formatting_mismatch', `${at}.formatting`, '尺寸格式须由原建议值确定性生成，不能猜单位或改变量纲与顺序');
          // Run the original normalization against the prior value as well.
          value = formatting.inputValue;
        }
      }
      const selected = Array.isArray(value) ? value : [value];
      const indexed = (index: unknown) => Number.isInteger(index) && (index as number) >= 0 ? evidence[index as number] : undefined;
      const quoteFor = (index: unknown) => { const ref = indexed(index); return isObject(ref) && typeof ref.quote === 'string' ? ref.quote : null; };
      const checkQuantity = (number: unknown, index: unknown, token: unknown, targetUnit: unknown) => {
        const quote = quoteFor(index);
        if (typeof number !== 'number' || !Number.isFinite(number) || typeof token !== 'string' || !token || !quote || !quote.includes(token)) {
          addRow(i, 'number_token', at, '数值 token 必须逐字来自所引用证据'); return;
        }
        const parsed = parseQuantity(token);
        const targetKey = typeof targetUnit === 'string' && targetUnit.trim() ? unitKey(targetUnit) : null;
        const target = targetKey ? units[targetKey] ?? { dimension: `exact-unit:${targetKey}`, factor: 1 } : undefined;
        // Do not accept a numeric token sliced out of a larger number in the source.
        const ref = indexed(index);
        const source = isObject(ref) ? sourceById.get(ref.sourceId) : undefined;
        // A bare number is convertible only when the original field label
        // itself explicitly carries the unit, e.g. "层数（层）".
        const fieldUnit = typeof source?.field === 'string' ? source.field.normalize('NFKC').match(/(?:\(|\[)([^()[\]]+)(?:\)|\])\s*$/)?.[1] : undefined;
        const sourceKey = parsed && (parsed.unit === '1' && fieldUnit ? unitKey(fieldUnit) : parsed.unit);
        const sourceUnit = sourceKey ? units[sourceKey] ?? { dimension: `exact-unit:${sourceKey}`, factor: 1 } : undefined;
        const tokenAt = quote.indexOf(token);
        const absolute = isObject(ref) && Number.isInteger(ref.start) ? ref.start + tokenAt : -1;
        const before = source?.text && absolute > 0 ? source.text[absolute - 1] : '';
        const after = source?.text && absolute >= 0 ? source.text[absolute + token.length] : '';
        const numericCharacter = /[\d.０-９零〇一二两三四五六七八九十百千万]/;
        if ((before && numericCharacter.test(before)) || (parsed?.unit === '1' && after && numericCharacter.test(after))) { addRow(i, 'number_token_boundary', at, '数值 token 不能截取较大数值的一部分'); return; }
        if (!parsed || !sourceUnit || !target || sourceUnit.dimension !== target.dimension) { addRow(i, 'number_unit', at, '数值及单位不能按明确量纲转换到属性单位'); return; }
        if (!numericEqual(parsed.number * sourceUnit.factor / target.factor, number)) addRow(i, 'number_value', at, '候选值与原文数值及单位转换不一致');
      };
      switch (normalization.method) {
        case 'exact': case 'nfkc': {
          if (p.type !== 'text' && p.type !== 'option' && p.type !== 'dictionary') { addRow(i, 'normalization_type', at, '原文直取仅适用于文本、枚举或字典值'); break; }
          const quotes = evidence.flatMap((ref: unknown) => isObject(ref) && typeof ref.quote === 'string' ? [ref.quote] : []);
          if (!selected.length || selected.some(v => typeof v !== 'string' || !quotes.some(q => normalization.method === 'exact' ? q === v : q.normalize('NFKC') === v))) addRow(i, 'normalization_mismatch', at, '每个值须与一条原文跨度完全一致，或仅进行声明的 NFKC 规范化');
          break;
        }
        case 'number':
          if (p.type !== 'number') addRow(i, 'normalization_type', at, 'number 规范化只适用于数值属性');
          else checkQuantity(value, normalization.evidenceIndex, normalization.token, p.unit);
          break;
        case 'boolean_literal': {
          if (p.type !== 'boolean' || typeof value !== 'boolean') { addRow(i, 'normalization_type', at, 'boolean_literal 只适用于布尔属性'); break; }
          const quote = quoteFor(normalization.evidenceIndex)?.trim().toLowerCase();
          const literal = quote === '是' || quote === 'true' ? true : quote === '否' || quote === 'false' ? false : null;
          if (literal === null || literal !== value) addRow(i, 'boolean_literal', at, '只接受与值一致的明确 是/否 或 true/false；含义仍须审校');
          break;
        }
        case 'semantic':
          if (!nonempty(normalization.reason)) addRow(i, 'normalization_type', at, '语义解释须说明理由');
          else warnRow(i, 'semantic_normalization', '语义映射未被程序验证；原文命中不能证明该映射，需要独立审校');
          break;
        case 'category_inference': {
          const pack = knowledgePacks.get(normalization.packId);
          const rule = pack?.rulesById.get(normalization.ruleId);
          if (!nonempty(normalization.packId) || !nonempty(normalization.ruleId) || !pack || !rule ||
              !pack.categoryIds.includes(row.categoryId) || !nonempty(p.definitionId) || !rule.definitionIds.includes(p.definitionId)) {
            addRow(i, 'category_inference_scope', at, '知识包及规则必须存在且覆盖当前真实类目和属性定义');
          }
          if (!nonempty(normalization.reason) || !Array.isArray(normalization.assumptions) || !normalization.assumptions.length ||
              normalization.assumptions.some((s: unknown) => !nonempty(s))) {
            addRow(i, 'category_inference_reason', at, '品类推断须说明理由及至少一条非空假设');
          }
          if (!evidence.length) addRow(i, 'evidence_required', at, '品类推断仍须有同 SKU 可定位原文证据');
          warnRow(i, 'semantic_normalization', '品类知识推断的语义未经程序验证，须独立审校');
          break;
        }
        case 'text_projection': {
          const quote = quoteFor(normalization.evidenceIndex);
          const policy = p.valuePolicy ?? {};
          const allowed = normalization.rule === 'material_name' ? policy.materialNameOnly === true :
            normalization.rule === 'dimensions' ? policy.compactDimensions === true :
            normalization.rule === 'scoped_count' && Array.isArray(policy.quantityScopes) && policy.quantityScopes.includes(normalization.scope);
          if (p.type !== 'text' || !allowed || !quote || typeof value !== 'string') {
            addRow(i, 'text_projection_contract', at, '简化须对应合同中的材质、尺寸或数量对象规则及可定位原文'); break;
          }
          const projected = projectSkuText(normalization.rule, quote, normalization.scope);
          if (projected === null || projected !== value) addRow(i, 'text_projection_value', at, '简化结果不符；不能删物理单位、混合材料或改变计数词');
          break;
        }
        case 'dictionary_alias': {
          if (p.type !== 'dictionary') { addRow(i, 'normalization_type', at, 'dictionary_alias 只适用于字典属性'); break; }
          const resolved = resolveDictionary(p.typing?.dictionary, contract?.dictionaries);
          if (resolved.error) { addRow(i, 'dictionary_reference', at, resolved.error); break; }
          const quotes = evidence.flatMap((ref: unknown) => isObject(ref) && typeof ref.quote === 'string' ? [ref.quote.normalize('NFKC').trim().toLocaleLowerCase()] : []);
          if (selected.some(v => !resolved.dictionary.values.some((entry: any) => entry.id === v && entry.status === 'active' && [entry.label, ...entry.aliases].some((s: string) => quotes.includes(s.normalize('NFKC').trim().toLocaleLowerCase()))))) addRow(i, 'dictionary_alias', at, '每个字典 ID 须有版本化字典中的精确名称或别名原文');
          break;
        }
        case 'measurement_option': {
          const measurement = p.typing?.choice?.measurement;
          if (p.type !== 'option' || !isObject(measurement) || measurement.unit !== p.unit || !Array.isArray(measurement.values) || !Array.isArray(normalization.mappings)) { addRow(i, 'normalization_type', at, '数值枚举须使用合同中逐选项的数值和同单位映射'); break; }
          const mappings = normalization.mappings;
          if (mappings.length !== selected.length || selected.some(v => mappings.filter((m: unknown) => isObject(m) && m.value === v).length !== 1)) { addRow(i, 'measurement_mapping', at, '每个选项须且仅须一条来源映射'); break; }
          for (const mapping of mappings) {
            const entry = measurement.values.find((m: any) => m.option === mapping.value);
            if (!entry) addRow(i, 'measurement_mapping', at, '选项没有冻结数值映射');
            else checkQuantity(entry.value, mapping.evidenceIndex, mapping.token, measurement.unit);
          }
          break;
        }
        default: addRow(i, 'normalization_method', at, '未知规范化方式');
      }
    };

    if (p && row.value !== null && row.value !== undefined) {
      const valueErrors: string[] = validateAttributeValue(p, row.value, contract?.dictionaries);
      for (const message of valueErrors) {
        if (row.status === 'out_of_domain' && message.includes('值不在本类允许范围内')) continue;
        addRow(i, 'attribute_value', '.value', message);
      }
      if (row.status === 'out_of_domain' && (!['option', 'dictionary'].includes(p.type) || !valueErrors.some(message => message.includes('值不在本类允许范围内')))) addRow(i, 'out_of_domain_mismatch', '.status', '仅枚举或字典的实际域外值使用 out_of_domain');
      checkNormalization(row.value, row.normalization, '.normalization');
    }
    if (row.observations !== undefined && !Array.isArray(row.observations)) addRow(i, 'observation_shape', '.observations', 'observations 须为数组');
    const observations = Array.isArray(row.observations) ? row.observations : [];
    if (observations.length && !evidence.length) addRow(i, 'evidence_required', '.observations', '观察中的候选值同样需要原文证据');
    for (const [j, observation] of observations.entries()) {
      if (!isObject(observation) || observation.value === null || observation.value === undefined) { addRow(i, 'observation_shape', `.observations[${j}]`, '观察须有非空候选值和规范化'); continue; }
      if (p && observation.normalization?.method === 'category_inference') {
        for (const message of validateAttributeValue(p, observation.value, contract?.dictionaries) as string[]) {
          addRow(i, 'attribute_value', `.observations[${j}].value`, message);
        }
      }
      checkNormalization(observation.value, observation.normalization, `.observations[${j}].normalization`);
    }
    if (row.status === 'conflict' && (evidence.length < 2 || new Set(evidence.map((e: any) => isObject(e) ? JSON.stringify([e.sourceId, e.start, e.end, e.quote]) : '')).size < 2)) addRow(i, 'conflict_evidence', '.evidence', '冲突须保留至少两个不同原文跨度');
    if (row.status === 'proposed' && observations.length > 1 && observations.some((o: any) => !sameValue(o?.value, observations[0]?.value))) addRow(i, 'observed_conflict', '.observations', '已记录多个不同候选，不能选一个填值；标为 conflict 并保留证据');
    if (row.status === 'proposed' && observations.length && !sameValue(row.value, observations[0]?.value)) addRow(i, 'observed_conflict', '.value', '建议值与已记录候选不一致，不能静默覆盖');
  }

  for (const row of checkedRows) {
    row.programStatus = row.blockingIssues.length ? 'blocked' : row.original?.status === 'proposed' ? 'awaiting_review' : 'unresolved';
    const hasCandidate = row.original?.value != null || (Array.isArray(row.original?.observations) && row.original.observations.length > 0);
    row.normalizationCheck = !hasCandidate ? 'not_applicable' : row.blockingIssues.length ? 'failed' :
      row.warnings.some(w => w.code === 'semantic_normalization') ? 'unverified' : 'verified';
  }
  return {
    version: 1, contractSha256: actualHash,
    structureValid: issues.length === 0 && checkedRows.every(row => row.blockingIssues.length === 0),
    issues,
    coverage: { expected: expected.size, submitted: rows.length, missing, duplicates, unexpected },
    rows: checkedRows,
    limitation: '仅检查结构、出处与部分确定性转换；原文命中不等于事实成立。所有候选须独立审校，不代表准确率或生产写入许可。',
  };
}
