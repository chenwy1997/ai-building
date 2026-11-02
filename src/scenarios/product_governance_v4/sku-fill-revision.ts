import { createHash } from 'node:crypto';
import { validateSkuFill } from './sku-fill-contract';
import type { SkuFillRow, SkuFillReport, SkuIdentity, SkuSource } from './sku-fill-contract';
import { applyReviewDeltas } from './scripts/assemble-sku-fill';

/** Assemble a frozen offline batch. All data sources remain those of the baseline. */
export interface RevisionReference { path: string; sha256: string }
export interface RevisionReferences {
  baseline: RevisionReference;
  contract: RevisionReference;
  tree: RevisionReference;
  currentAuthor: RevisionReference;
  routing: RevisionReference;
  targetAuthor: RevisionReference;
  review?: RevisionReference;
  deltas?: RevisionReference;
}
export interface RevisionInput {
  references: RevisionReferences;
  baseline: any;
  baselineContractText: string;
  contractText: string;
  tree: any;
  currentAuthor: any;
  routing: any;
  targetAuthor: any;
  review?: any;
  deltas?: any;
}

export interface IncrementalRevisionReferences {
  baseline: RevisionReference;
  contract: RevisionReference;
  patches: RevisionReference[];
  supplementalSources?: RevisionReference;
  routingPatch?: RevisionReference;
  tree?: RevisionReference;
  review?: RevisionReference;
  deltas?: RevisionReference;
}
export interface IncrementalRevisionInput {
  references: IncrementalRevisionReferences;
  baseline: any;
  contractText: string;
  patches: any[];
  supplementalSources?: any;
  routingPatch?: any;
  tree?: any;
  review?: any;
  deltas?: any;
}

export class RevisionError extends Error {
  constructor(message: string, public readonly stage: string, public readonly report?: unknown) {
    super(message);
    this.name = 'RevisionError';
  }
}

const nonempty = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
const object = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const hash = (x: string | Uint8Array) => createHash('sha256').update(x).digest('hex');
const key = (...x: string[]) => JSON.stringify(x);
const jsonBytes = (x: unknown) => JSON.stringify(x, null, 2) + '\n';
function fail(stage: string, message: string, report?: unknown): never { throw new RevisionError(message, stage, report); }
const requireArray = (value: unknown, stage: string, field: string): any[] => {
  if (!Array.isArray(value)) fail(stage, `${field} must be an array`);
  return value as any[];
};

function checkReport(stage: string, report: SkuFillReport): void {
  if (!report.structureValid) fail(stage, `${stage}: SKU fill checks failed`, report);
}

function contractIndex(text: string, expected: string, stage: string): { contract: any; byCategory: Map<string, any[]>; keys: Set<string> } {
  if (!/^[a-f0-9]{64}$/.test(expected) || hash(text) !== expected) fail(stage, `${stage}: stale contract hash`);
  let contract: any;
  try { contract = JSON.parse(text); } catch { return fail(stage, `${stage}: invalid contract JSON`); }
  if (!object(contract) || contract.attributeContractVersion !== 1 || !Array.isArray(contract.proposals) || !contract.proposals.length) {
    fail(stage, `${stage}: invalid attribute contract`);
  }
  const byCategory = new Map<string, any[]>(), keys = new Set<string>();
  for (const p of contract.proposals) {
    if (!object(p) || !nonempty(p.categoryId) || !nonempty(p.key)) fail(stage, `${stage}: invalid category or attribute key`);
    const k = key(p.categoryId, p.key);
    if (keys.has(k)) fail(stage, `${stage}: duplicate category/attribute`);
    keys.add(k);
    const attrs = byCategory.get(p.categoryId) ?? [];
    attrs.push(p); byCategory.set(p.categoryId, attrs);
  }
  return { contract, byCategory, keys };
}

/** Only oldNodes' enabled leaf mall IDs are accepted, never standardCategoryId. */
function treeIndex(tree: any): Map<string, { category: string; path: string }> {
  const result = new Map<string, { category: string; path: string }>();
  for (const n of requireArray(tree?.oldNodes, 'tree', 'tree.oldNodes')) {
    if (!object(n) || n.enabled !== true || n.isLeaf !== true) continue;
    if (!nonempty(n.id) || !nonempty(n.mallCategoryId) || n.id !== n.mallCategoryId || !nonempty(n.path)) {
      fail('tree', 'Enabled leaf needs matching id and mallCategoryId and a path');
    }
    const segments = n.path.split('>');
    if (segments.some((s: string) => !s.trim()) || result.has(n.id)) fail('tree', 'Invalid or duplicate enabled leaf');
    result.set(n.id, { category: segments[segments.length - 1]!, path: n.path });
  }
  if (!result.size) fail('tree', 'No enabled leaf categories in oldNodes');
  return result;
}

function checkRef(ref: any, label: string): void {
  if (!object(ref) || !nonempty(ref.path) || !/^[a-f0-9]{64}$/.test(ref.sha256 ?? '')) fail('references', `${label} needs a path and SHA-256`);
}

function checkCitation(ref: any, skuId: string, sources: Map<string, SkuSource>, label: string): void {
  if (!object(ref) || !nonempty(ref.sourceId)) fail('routing', `${label}: invalid evidence reference`);
  const source = sources.get(ref.sourceId);
  if (!source) fail('routing', `${label}: unknown source`);
  if (source.skuId !== skuId) fail('routing', `${label}: cross-SKU evidence`);
  if (/image|ocr|visual/i.test(`${source.kind ?? ''} ${(source as any).extractionMethod ?? ''} ${source.field ?? ''}`)) {
    fail('routing', `${label}: category decisions require product text or web text; image evidence is reference only`);
  }
  if (!['available', 'truncated'].includes(source.readState) || typeof source.text !== 'string') fail('routing', `${label}: source has no readable text`);
  if (!Number.isInteger(ref.start) || !Number.isInteger(ref.end) || ref.start < 0 || ref.end <= ref.start ||
      ref.end > source.text.length || !nonempty(ref.quote) || source.text.slice(ref.start, ref.end) !== ref.quote) {
    fail('routing', `${label}: evidence span or quote mismatch`);
  }
  if (ref.sourceSha256 !== undefined && ref.sourceSha256 !== source.sha256) fail('routing', `${label}: source SHA-256 mismatch`);
  if (ref.field !== undefined && ref.field !== source.field) fail('routing', `${label}: source field mismatch`);
  if (ref.locator !== undefined && ref.locator !== source.locator) fail('routing', `${label}: source locator mismatch`);
}

function noAuthorSources(author: any, label: string): void {
  if (!object(author) || !Array.isArray(author.rows)) fail('author', `${label}.rows must be an array`);
  for (const field of ['sources', 'additionalSources']) {
    if (author[field] !== undefined && (!Array.isArray(author[field]) || author[field].length)) {
      fail('author', `${label} cannot add sources; use baseline sources only`);
    }
  }
  if (author.skuNotes !== undefined && !Array.isArray(author.skuNotes)) fail('author', `${label}.skuNotes must be an array`);
}

/** The exact serialized authorRows bytes form part of the independent-review binding. */
export function serializeRevisionJson(value: unknown): string { return jsonBytes(value); }

export function assembleSkuFillRevision(input: RevisionInput): { result: any; checks: any; authorRows: any; reviewBindings: any } {
  const { baseline, tree, currentAuthor, routing, targetAuthor, references } = input;
  for (const name of ['baseline', 'contract', 'tree', 'currentAuthor', 'routing', 'targetAuthor'] as const) checkRef(references?.[name], name);
  if (!!references.review !== !!references.deltas || !!input.review !== !!input.deltas || !!references.review !== !!input.review) {
    fail('review', 'review and deltas must be supplied together');
  }
  if (references.review) { checkRef(references.review, 'review'); checkRef(references.deltas, 'deltas'); }
  if (!object(baseline)) fail('baseline', 'baseline must be an object');
  const skus = requireArray(baseline.skus, 'baseline', 'baseline.skus') as SkuIdentity[];
  const sources = requireArray(baseline.sources, 'baseline', 'baseline.sources') as SkuSource[];
  const baselineRows = requireArray(baseline.rows, 'baseline', 'baseline.rows') as SkuFillRow[];
  if (!skus.length) fail('baseline', 'baseline must contain SKU identities');
  const old = contractIndex(input.baselineContractText, baseline.contractSha256, 'baseline contract');
  const revised = contractIndex(input.contractText, references.contract.sha256, 'contract');
  if (old.keys.size !== revised.keys.size || [...old.keys].some(k => !revised.keys.has(k))) {
    fail('contract', 'Revision must preserve the baseline category/attribute set');
  }
  const oldReport = validateSkuFill({ contractText: input.baselineContractText, expectedContractSha256: baseline.contractSha256, skus, sources, rows: baselineRows });
  checkReport('baseline', oldReport);
  const leaves = treeIndex(tree), skuMap = new Map<string, SkuIdentity>();
  for (const sku of skus) {
    if (!object(sku) || !nonempty(sku.skuId) || skuMap.has(sku.skuId)) fail('baseline', 'SKU identities must be unique and nonempty');
    const node = leaves.get(sku.categoryId);
    if (!node || sku.category !== node.category || sku.path !== node.path) fail('baseline', `Unknown or mismatched original category for ${sku.skuId}`);
    skuMap.set(sku.skuId, sku);
  }
  const sourceMap = new Map(sources.map(s => [s.sourceId, s]));
  noAuthorSources(currentAuthor, 'currentAuthor'); noAuthorSources(targetAuthor, 'targetAuthor');
  for (const [name, author] of [['currentAuthor', currentAuthor], ['targetAuthor', targetAuthor]] as const) {
    for (const field of ['priorResultSha256', 'baselineSha256']) {
      if (author[field] !== undefined && author[field] !== references.baseline.sha256) fail('author', `${name}: baseline hash is stale`);
    }
    if (author.routingSha256 !== undefined && author.routingSha256 !== references.routing.sha256) fail('author', `${name}: routing hash is stale`);
    if (author.contractSha256 !== undefined && ![baseline.contractSha256, references.contract.sha256].includes(author.contractSha256)) {
      fail('author', `${name}: contract hash is stale`);
    }
  }
  const currentReport = validateSkuFill({ contractText: input.contractText, expectedContractSha256: references.contract.sha256, skus, sources, rows: currentAuthor.rows });
  checkReport('currentAuthor', currentReport);

  checkRef(routing?.treeSource, 'routing.treeSource'); checkRef(routing?.contractSource, 'routing.contractSource');
  if (routing.treeSource.sha256 !== references.tree.sha256) fail('routing', 'Routing tree hash is stale');
  if (![baseline.contractSha256, references.contract.sha256].includes(routing.contractSource.sha256)) fail('routing', 'Routing contract hash is stale');
  const requiredDecisions = new Set(baselineRows.filter(r => r.status === 'identity_review').map(r => r.skuId));
  const decisions = new Map<string, any>();
  const routeStats: any = { total: 0, baselineIdentityReviewSkus: requiredDecisions.size, byDecision: { suggest: 0, keep: 0, unresolved: 0 }, suggestedTargets: {}, governedSuggested: 0, ungovernedSuggested: 0, notEvaluated: 0 };
  for (const [i, d] of requireArray(routing?.decisions, 'routing', 'routing.decisions').entries()) {
    if (!object(d) || !nonempty(d.skuId) || decisions.has(d.skuId)) fail('routing', `Decision ${i}: unknown or duplicated SKU`);
    const sku = skuMap.get(d.skuId);
    if (!sku || d.originalCategoryId !== sku.categoryId) fail('routing', `Decision ${i}: original SKU/category mismatch`);
    if ((d.originalCategory !== undefined && d.originalCategory !== sku.category) || (d.originalPath !== undefined && d.originalPath !== sku.path)) {
      fail('routing', `Decision ${i}: original category name/path mismatch`);
    }
    if (!['suggest', 'keep', 'unresolved'].includes(d.decision) || !nonempty(d.reason)) fail('routing', `Decision ${i}: invalid decision or reason`);
    const evidence = requireArray(d.evidence, 'routing', `decisions[${i}].evidence`);
    if (!evidence.length) fail('routing', `Decision ${i}: evidence required`);
    evidence.forEach((e, j) => checkCitation(e, d.skuId, sourceMap, `Decision ${i}, evidence ${j}`));
    let suggested: any = null;
    if (d.suggestedCategoryId !== undefined && d.suggestedCategoryId !== null) {
      const node = leaves.get(d.suggestedCategoryId);
      if (!node || d.suggestedCategoryId === sku.categoryId || d.suggestedCategory !== node.category || d.suggestedPath !== node.path) {
        fail('routing', `Decision ${i}: suggested category must match a different enabled real leaf`);
      }
      const count = revised.byCategory.get(d.suggestedCategoryId)?.length ?? 0;
      suggested = { categoryId: d.suggestedCategoryId, ...node, hasGovernedAttributes: count > 0, governedAttributeCount: count };
    } else if (d.suggestedCategory !== undefined || d.suggestedPath !== undefined) {
      fail('routing', `Decision ${i}: incomplete suggested category`);
    }
    if (d.decision === 'suggest' && !suggested) fail('routing', `Decision ${i}: suggestion required`);
    if (d.decision === 'keep' && suggested) fail('routing', `Decision ${i}: keep cannot also suggest a category`);
    const alternatives = requireArray(d.alternatives ?? [], 'routing', `decisions[${i}].alternatives`).map((a, j) => {
      if (!object(a) || !nonempty(a.categoryId)) fail('routing', `Decision ${i}, alternative ${j}: category ID required`);
      const node = leaves.get(a.categoryId);
      if (!node || (a.category !== undefined && a.category !== node.category) || (a.path !== undefined && a.path !== node.path)) {
        fail('routing', `Decision ${i}, alternative ${j}: unknown or mismatched enabled real leaf`);
      }
      const count = revised.byCategory.get(a.categoryId)?.length ?? 0;
      return { ...a, category: node.category, path: node.path, hasGovernedAttributes: count > 0, governedAttributeCount: count };
    });
    decisions.set(d.skuId, { ...d, suggested, alternatives });
    routeStats.total++; routeStats.byDecision[d.decision]++;
    if (d.decision === 'suggest') {
      routeStats.suggestedTargets[suggested.path] = (routeStats.suggestedTargets[suggested.path] ?? 0) + 1;
      if (suggested.hasGovernedAttributes) routeStats.governedSuggested++; else routeStats.ungovernedSuggested++;
    }
  }
  for (const id of requiredDecisions) if (!decisions.has(id)) fail('routing', `Missing baseline identity-review SKU ${id}`);
  routeStats.notEvaluated = skus.length - decisions.size;

  const activeSkus = skus.map(sku => {
    const d = decisions.get(sku.skuId), s = d?.suggested;
    const swap = d?.decision === 'suggest' && !!s?.hasGovernedAttributes;
    const pending = d?.decision === 'unresolved' || (d?.decision === 'suggest' && !s?.hasGovernedAttributes);
    const relevantCount = d?.decision === 'suggest' ? s.governedAttributeCount : (revised.byCategory.get(sku.categoryId)?.length ?? 0);
    return { ...structuredClone(sku), originalCategoryId: sku.categoryId, originalCategory: sku.category, originalPath: sku.path,
      categoryId: swap ? s.categoryId : sku.categoryId, category: swap ? s.category : sku.category, path: swap ? s.path : sku.path,
      categoryDecision: d?.decision ?? 'not_evaluated', categoryReason: d?.reason ?? '', categoryEvidence: structuredClone(d?.evidence ?? []),
      categoryAlternatives: structuredClone(d?.alternatives ?? []), suggestedCategoryId: s?.categoryId ?? null, suggestedCategory: s?.category ?? null,
      suggestedPath: s?.path ?? null, hasGovernedAttributes: relevantCount > 0, governedAttributeCount: relevantCount,
      activeAttributeBasis: swap ? 'suggested_governed' : pending ? 'original_pending_category' : 'original' };
  });
  const targetSkus = activeSkus.filter(s => s.activeAttributeBasis === 'suggested_governed');
  const targetIds = new Set(targetSkus.map(s => s.skuId));
  let targetReport: SkuFillReport | null = null;
  if (!targetSkus.length) {
    if (targetAuthor.rows.length) fail('targetAuthor', 'Target rows supplied without a governed suggested category');
  } else {
    targetReport = validateSkuFill({ contractText: input.contractText, expectedContractSha256: references.contract.sha256,
      skus: targetSkus, sources: sources.filter(s => targetIds.has(s.skuId)), rows: targetAuthor.rows });
    checkReport('targetAuthor', targetReport);
  }
  function groupRows(rows: SkuFillRow[]): Map<string, SkuFillRow[]> {
    const grouped = new Map<string, SkuFillRow[]>();
    for (const row of rows) { const list = grouped.get(row.skuId) ?? []; list.push(row); grouped.set(row.skuId, list); }
    return grouped;
  }
  const currentRows = groupRows(currentAuthor.rows), targetRows = groupRows(targetAuthor.rows);
  const authorRows = { version: 1, skus: activeSkus, rows: activeSkus.flatMap(s => structuredClone((targetIds.has(s.skuId) ? targetRows : currentRows).get(s.skuId) ?? [])) };
  const bindings = { baselineSha256: references.baseline.sha256, contractSha256: references.contract.sha256, treeSha256: references.tree.sha256,
    currentAuthorSha256: references.currentAuthor.sha256, routingSha256: references.routing.sha256, targetAuthorSha256: references.targetAuthor.sha256,
    authorRowsSha256: hash(jsonBytes(authorRows)) };
  const reviewBindings = { version: 1, bindings, reviewedSkuCount: skus.length, reviewedRows: authorRows.rows.length,
    proposedReviewed: authorRows.rows.filter(r => r.status === 'proposed').length };
  let rows = authorRows.rows as SkuFillRow[];
  if (input.review) {
    for (const [name, record] of [['review', input.review], ['deltas', input.deltas]] as const) {
      if (!object(record) || !object(record.bindings) || Object.entries(bindings).some(([k, v]) => record.bindings[k] !== v)) {
        fail('review', `${name} bindings do not match the current authors, routing, contract, tree and baseline`);
      }
    }
    const review = input.review;
    if (review.reviewType !== 'independent' || !(nonempty(review.reviewer) || (object(review.reviewer) && Object.keys(review.reviewer).length)) || !nonempty(review.method)) {
      fail('review', 'Independent review requires reviewType, reviewer and method');
    }
    for (const field of ['reviewedSkuCount', 'reviewedRows', 'proposedReviewed'] as const) {
      if (review[field] !== reviewBindings[field]) fail('review', `Independent review coverage mismatch: ${field}`);
    }
    if (!Array.isArray(input.deltas.changes)) fail('review', 'deltas.changes must be an array');
    try { rows = applyReviewDeltas(rows, input.deltas.changes); }
    catch (error) { fail('review', error instanceof Error ? error.message : 'Invalid review delta'); }
  }
  const finalReport = validateSkuFill({ contractText: input.contractText, expectedContractSha256: references.contract.sha256, skus: activeSkus, sources, rows });
  checkReport('final', finalReport);
  const byAttribute = new Map(revised.contract.proposals.map((p: any) => [key(p.categoryId, p.key), p]));
  const bySku = new Map(activeSkus.map(s => [s.skuId, s]));
  const changedThisReview = new Set((input.deltas?.changes ?? []).map((c: any) => key(c.skuId, c.attributeKey)));
  const counts: Record<string, number> = {}, categories: any[] = [];
  for (const sku of activeSkus) {
    let c = categories.find(x => x.categoryId === sku.categoryId);
    if (!c) { c = { categoryId: sku.categoryId, category: sku.category, skus: 0, rows: 0, statuses: {}, summaryRead: 0 }; categories.push(c); }
    c.skus++; if ((sku as SkuIdentity).summaryStatus === 'ok') c.summaryRead++;
  }
  const enriched = rows.map((r, i) => {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    const c = categories.find(x => x.categoryId === r.categoryId)!;
    c.rows++; c.statuses[r.status] = (c.statuses[r.status] ?? 0) + 1;
    const p: any = byAttribute.get(key(r.categoryId, r.attributeKey));
    // An author row may carry a review change from the old batch. Keep that
    // provenance, but reserve independentChange for this revision's review.
    const { independentChange, ...rest } = r;
    const priorChange = authorRows.rows[i]?.independentChange;
    return { ...rest, ...(priorChange === undefined ? {} : { previousIndependentChange: priorChange }),
      ...(changedThisReview.has(key(r.skuId, r.attributeKey)) ? { independentChange } : {}),
      attribute: p.name, definitionId: p.definitionId, definitionVersion: p.definitionVersion, type: p.type,
      mode: p.typing?.choice?.mode ?? null, unit: p.unit ?? null, definition: p.definition, rule: p.shortRule ?? p.rules?.join('；') ?? '',
      activeAttributeBasis: bySku.get(r.skuId)!.activeAttributeBasis, programStatus: finalReport.rows[i]!.programStatus, humanDecision: '' };
  });
  const reviewState = input.review ? 'reviewed' : 'draft';
  const limitations = [...(Array.isArray(baseline.limitations) ? baseline.limitations : []),
    '本次类目及属性值仅为离线建议，活动类目变化不代表实际重挂；原类目始终保留。',
    '原类属性用于待核类目时不代表目标类目属性；来源未读部分不能推断为不存在。',
    reviewState === 'draft' ? '本轮结果尚未经过独立审校。' : '独立审校与程序检查不等于人工金标准或准确率。',
    '未获取完整既有参数值，不能直接作为生产写入差异补丁。'];
  const result = { version: 1, createdAt: new Date().toISOString(), contractPath: references.contract.path, contractSha256: references.contract.sha256,
    selectionSha256: baseline.selectionSha256, sampling: baseline.sampling, supplemental: baseline.supplemental ?? null,
    inputs: Object.values(references), authors: [currentAuthor.author, targetAuthor.author].filter(x => x !== undefined),
    reviewState, review: input.review ?? null, changes: input.deltas?.changes ?? [], skus: activeSkus, sources: structuredClone(sources),
    skuNotes: [...(currentAuthor.skuNotes ?? []), ...(targetAuthor.skuNotes ?? [])], rows: enriched,
    summary: { skus: skus.length, attributes: rows.length, statuses: counts, categories, humanReviewed: 0, accuracy: null,
      candidateCoverage: { numerator: counts.proposed ?? 0, denominator: rows.length } },
    revision: { baseline: references.baseline, sources: structuredClone(references), routingSummary: routeStats, reviewBindings: bindings },
    limitations, productionWrites: 0, deepseekRequests: 0, adoption: 'pending_human' };
  const checks = { version: 1, structureValid: true, reviewState, baseline: oldReport, currentAuthor: currentReport,
    targetAuthor: targetReport, final: finalReport, routing: routeStats,
    limitation: '程序仅校验结构、出处与部分确定性转换，不证明类目裁决或属性值语义正确。' };
  return { result, checks, authorRows, reviewBindings };
}

/** Revise any completed baseline without resampling or rewriting its sources. */
export function assembleIncrementalSkuFillRevision(input: IncrementalRevisionInput): { result: any; checks: any; authorRows: any; reviewBindings: any } {
  const { references: refs, baseline } = input;
  checkRef(refs?.baseline, 'baseline'); checkRef(refs?.contract, 'contract');
  if (!Array.isArray(refs?.patches) || !Array.isArray(input.patches) || refs.patches.length !== input.patches.length) {
    fail('references', 'patches references and files must be matching arrays');
  }
  refs.patches.forEach((ref, i) => checkRef(ref, `patches[${i}]`));
  for (const field of ['supplementalSources', 'routingPatch', 'tree', 'review', 'deltas'] as const) {
    if (!!refs[field] !== (input[field] !== undefined)) fail('references', `${field} reference and input must be supplied together`);
    if (refs[field]) checkRef(refs[field], field);
  }
  if ((input.review !== undefined) !== (input.deltas !== undefined)) fail('review', 'review and deltas must be supplied together');
  if (!object(baseline)) fail('baseline', 'baseline must be an object');
  const skus = requireArray(baseline.skus, 'baseline', 'baseline.skus') as SkuIdentity[];
  const originalSources = requireArray(baseline.sources, 'baseline', 'baseline.sources') as SkuSource[];
  const baselineRows = requireArray(baseline.rows, 'baseline', 'baseline.rows') as SkuFillRow[];
  if (!skus.length) fail('baseline', 'baseline must contain SKU identities');
  const revised = contractIndex(input.contractText, refs.contract.sha256, 'contract');
  const skuMap = new Map<string, SkuIdentity>();
  for (const sku of skus) {
    if (!object(sku) || !nonempty(sku.skuId) || !nonempty(sku.categoryId) || skuMap.has(sku.skuId)) {
      fail('baseline', 'SKU identities must be unique and nonempty');
    }
    skuMap.set(sku.skuId, sku);
  }
  const sourceMap = new Map<string, SkuSource>();
  for (const source of originalSources) {
    if (!object(source) || !nonempty(source.sourceId) || sourceMap.has(source.sourceId)) fail('baseline', 'Baseline source IDs must be unique and nonempty');
    sourceMap.set(source.sourceId, source);
  }
  const sources = structuredClone(originalSources);
  if (input.supplementalSources !== undefined) {
    if (!object(input.supplementalSources)) fail('sources', 'supplementalSources must be an object');
    for (const source of requireArray(input.supplementalSources.sources, 'sources', 'supplementalSources.sources')) {
      if (!object(source) || !nonempty(source.sourceId) || !skuMap.has(source.skuId)) fail('sources', 'Supplemental source must identify an existing SKU and a new sourceId');
      if (sourceMap.has(source.sourceId)) fail('sources', 'Supplemental sourceId cannot replace or duplicate a baseline or supplemental source');
      sourceMap.set(source.sourceId, source as SkuSource); sources.push(structuredClone(source as SkuSource));
    }
  }
  const rowsByKey = new Map<string, SkuFillRow>();
  for (const row of baselineRows) {
    if (!object(row) || !nonempty(row.skuId) || !nonempty(row.categoryId) || !nonempty(row.attributeKey) ||
        skuMap.get(row.skuId)?.categoryId !== row.categoryId) fail('baseline', 'Baseline rows must match an existing SKU and its active category');
    const k = key(row.skuId, row.categoryId, row.attributeKey);
    if (rowsByKey.has(k)) fail('baseline', 'Duplicate baseline SKU/category/attribute row');
    rowsByKey.set(k, structuredClone(row));
  }
  const patched = new Set<string>(), patchedSkus = new Set<string>();
  for (const [i, patch] of input.patches.entries()) {
    if (!object(patch) || patch.baselineSha256 !== refs.baseline.sha256) fail('patch', `patches[${i}]: baseline hash is stale`);
    for (const row of requireArray(patch.rows, 'patch', `patches[${i}].rows`)) {
      if (!object(row) || !nonempty(row.skuId) || !nonempty(row.categoryId) || !nonempty(row.attributeKey)) fail('patch', 'Patch must contain complete replacement rows');
      const k = key(row.skuId, row.categoryId, row.attributeKey);
      if (!rowsByKey.has(k) || patched.has(k)) fail('patch', 'Unknown or repeated patch SKU/category/attribute');
      rowsByKey.set(k, structuredClone(row as SkuFillRow)); patched.add(k); patchedSkus.add(row.skuId);
    }
  }
  const leaves = input.tree === undefined ? null : treeIndex(input.tree);
  const activeSkus = structuredClone(skus), activeById = new Map(activeSkus.map(s => [s.skuId, s]));
  const replacementRows = new Map<string, SkuFillRow[]>(), routed = new Set<string>();
  const routingStats = { total: 0, suggested: 0, switched: 0, pending: 0, notEvaluated: skus.length };
  if (input.routingPatch !== undefined) {
    if (!object(input.routingPatch)) fail('routing', 'routingPatch must be an object');
    for (const [i, route] of requireArray(input.routingPatch.rows, 'routing', 'routingPatch.rows').entries()) {
      if (!object(route) || !nonempty(route.skuId) || routed.has(route.skuId) || !activeById.has(route.skuId)) fail('routing', `Route ${i}: unknown or repeated SKU`);
      if (!['suggest', 'keep', 'unresolved'].includes(route.categoryDecision) || !nonempty(route.categoryReason)) fail('routing', `Route ${i}: valid categoryDecision and categoryReason are required`);
      const sku: any = activeById.get(route.skuId)!;
      const optionalId = (value: unknown) => value === undefined || value === null || nonempty(value);
      if (!optionalId(route.suggestedCategoryId) || !optionalId(route.activeCategoryId)) fail('routing', `Route ${i}: invalid category ID`);
      const suggestedId = route.suggestedCategoryId ?? null, activeId = route.activeCategoryId ?? null;
      if (route.categoryDecision === 'suggest' && !suggestedId && !activeId) fail('routing', `Route ${i}: suggested or active category is required`);
      if (route.categoryDecision === 'keep' && suggestedId && suggestedId !== sku.categoryId) fail('routing', `Route ${i}: keep cannot suggest a different category`);
      if ((suggestedId || activeId) && !leaves) fail('routing', `Route ${i}: real category tree required`);
      const suggested = suggestedId ? leaves!.get(suggestedId) : null;
      const target = activeId ? leaves!.get(activeId) : null;
      if ((suggestedId && !suggested) || (activeId && !target)) fail('routing', `Route ${i}: category must be an enabled real leaf`);
      if (suggestedId && activeId && suggestedId !== activeId) fail('routing', `Route ${i}: suggested and active category disagree`);
      const evidence = route.categoryEvidence === undefined ? [] : requireArray(route.categoryEvidence, 'routing', `routingPatch.rows[${i}].categoryEvidence`);
      evidence.forEach((e, j) => checkCitation(e, route.skuId, sourceMap, `Route ${i}, evidence ${j}`));
      if (route.categoryReviewNotes !== undefined && (!Array.isArray(route.categoryReviewNotes) || route.categoryReviewNotes.some((note: unknown) => !nonempty(note)))) fail('routing', `Route ${i}: invalid categoryReviewNotes`);
      const swap = !!activeId && activeId !== sku.categoryId;
      if (swap) {
        if (route.categoryDecision !== 'suggest') fail('routing', `Route ${i}: unresolved or keep decisions cannot switch the active category`);
        if (!revised.byCategory.has(activeId)) fail('routing', `Route ${i}: active target has no governed attributes`);
        if (patchedSkus.has(route.skuId)) fail('routing', `Route ${i}: patched current-category rows would be discarded by the category switch`);
        const replacements = requireArray(route.rows, 'routing', `routingPatch.rows[${i}].rows`) as SkuFillRow[];
        replacementRows.set(route.skuId, structuredClone(replacements));
      } else if (route.rows !== undefined) fail('routing', `Route ${i}: target rows require an active category switch`);
      const previousDecision: Record<string, unknown> = {};
      for (const field of ['categoryDecision', 'categoryReason', 'categoryEvidence', 'categoryReviewNotes', 'suggestedCategoryId', 'suggestedCategory', 'suggestedPath', 'activeAttributeBasis']) {
        if (sku[field] !== undefined) previousDecision[field] = structuredClone(sku[field]);
      }
      if (Object.keys(previousDecision).length) {
        if (sku.categoryDecisionHistory !== undefined && !Array.isArray(sku.categoryDecisionHistory)) fail('routing', `Route ${i}: categoryDecisionHistory must be an array`);
        sku.categoryDecisionHistory = [...(sku.categoryDecisionHistory ?? []), previousDecision];
      }
      if (sku.originalCategoryId === undefined) sku.originalCategoryId = sku.categoryId;
      if (sku.originalCategory === undefined && sku.category !== undefined) sku.originalCategory = sku.category;
      if (sku.originalPath === undefined && sku.path !== undefined) sku.originalPath = sku.path;
      sku.categoryDecision = route.categoryDecision; sku.categoryReason = route.categoryReason; sku.categoryEvidence = structuredClone(evidence);
      if (route.categoryReviewNotes !== undefined) sku.categoryReviewNotes = structuredClone(route.categoryReviewNotes);
      if (suggestedId) {
        sku.suggestedCategoryId = suggestedId; sku.suggestedCategory = suggested!.category; sku.suggestedPath = suggested!.path;
        sku.hasGovernedAttributes = revised.byCategory.has(suggestedId); sku.governedAttributeCount = revised.byCategory.get(suggestedId)?.length ?? 0;
      } else {
        sku.suggestedCategoryId = null; sku.suggestedCategory = null; sku.suggestedPath = null;
        sku.hasGovernedAttributes = revised.byCategory.has(sku.categoryId); sku.governedAttributeCount = revised.byCategory.get(sku.categoryId)?.length ?? 0;
      }
      if (swap) {
        sku.categoryId = activeId; sku.category = target!.category; sku.path = target!.path;
        sku.hasGovernedAttributes = true; sku.governedAttributeCount = revised.byCategory.get(activeId)!.length;
        sku.activeAttributeBasis = 'suggested_governed';
      } else sku.activeAttributeBasis = suggestedId && suggestedId !== sku.categoryId ? 'original_pending_category' : (sku.activeAttributeBasis ?? 'original');
      routed.add(route.skuId); routingStats.total++; if (suggestedId) routingStats.suggested++;
      if (swap) routingStats.switched++; else if (suggestedId) routingStats.pending++;
    }
    routingStats.notEvaluated = skus.length - routingStats.total;
  }
  const currentRows = [...rowsByKey.values()], inserted = new Set<string>();
  const orderedRows: SkuFillRow[] = [];
  for (const row of currentRows) {
    if (replacementRows.has(row.skuId)) {
      if (!inserted.has(row.skuId)) { orderedRows.push(...replacementRows.get(row.skuId)!); inserted.add(row.skuId); }
    } else orderedRows.push(row);
  }
  for (const [skuId, replacement] of replacementRows) if (!inserted.has(skuId)) orderedRows.push(...replacement);
  const baselineByKey = new Map(baselineRows.map(r => [key(r.skuId, r.categoryId, r.attributeKey), r]));
  // Retire past review changes before hashing the author snapshot, not just in
  // the final result; old records must never look like this round's review.
  const authorRows = { version: 1, skus: activeSkus, rows: orderedRows.map(row => {
    const old = baselineByKey.get(key(row.skuId, row.categoryId, row.attributeKey));
    const { independentChange, humanDecision, ...rest } = row;
    const history: unknown[] = [];
    for (const item of [...(Array.isArray(old?.independentChangeHistory) ? old.independentChangeHistory : []),
      ...(Array.isArray(rest.independentChangeHistory) ? rest.independentChangeHistory : []), old?.independentChange, independentChange]) {
      if (item !== undefined && !history.some(x => JSON.stringify(x) === JSON.stringify(item))) history.push(structuredClone(item));
    }
    const humanHistory: unknown[] = [];
    for (const item of [...(Array.isArray(old?.humanDecisionHistory) ? old.humanDecisionHistory : []),
      ...(Array.isArray(rest.humanDecisionHistory) ? rest.humanDecisionHistory : []), old?.humanDecision, humanDecision]) {
      if (item !== undefined && item !== null && item !== '' && !humanHistory.some(x => JSON.stringify(x) === JSON.stringify(item))) humanHistory.push(structuredClone(item));
    }
    return { ...rest, ...(rest.previousIndependentChange === undefined && old?.previousIndependentChange !== undefined ?
      { previousIndependentChange: structuredClone(old.previousIndependentChange) } : {}), ...(history.length ? { independentChangeHistory: history } : {}),
      ...(humanHistory.length ? { humanDecisionHistory: humanHistory } : {}), humanDecision: '' };
  }) };
  const authorReport = validateSkuFill({ contractText: input.contractText, expectedContractSha256: refs.contract.sha256, skus: activeSkus, sources, rows: authorRows.rows });
  checkReport('authorRows', authorReport);
  const bindings = { baselineSha256: refs.baseline.sha256, contractSha256: refs.contract.sha256,
    patchesSha256: refs.patches.map(ref => ref.sha256), supplementalSourcesSha256: refs.supplementalSources?.sha256 ?? null,
    routingPatchSha256: refs.routingPatch?.sha256 ?? null, treeSha256: refs.tree?.sha256 ?? null,
    authorRowsSha256: hash(jsonBytes(authorRows)) };
  const reviewBindings = { version: 2, bindings, reviewedSkuCount: skus.length, reviewedRows: authorRows.rows.length,
    proposedReviewed: authorRows.rows.filter(r => r.status === 'proposed').length };
  let rows = authorRows.rows as SkuFillRow[];
  if (input.review !== undefined) {
    for (const [name, record] of [['review', input.review], ['deltas', input.deltas]] as const) {
      if (!object(record) || !object(record.bindings) || Object.entries(bindings).some(([k, v]) => JSON.stringify(record.bindings[k]) !== JSON.stringify(v))) {
        fail('review', `${name} bindings do not match the current baseline, contract, patches, sources, routing, tree and author rows`);
      }
    }
    if (input.review.reviewType !== 'independent' || !(nonempty(input.review.reviewer) || (object(input.review.reviewer) && Object.keys(input.review.reviewer).length)) || !nonempty(input.review.method)) {
      fail('review', 'Independent review requires reviewType, reviewer and method');
    }
    for (const field of ['reviewedSkuCount', 'reviewedRows', 'proposedReviewed'] as const) {
      if (input.review[field] !== reviewBindings[field]) fail('review', `Independent review coverage mismatch: ${field}`);
    }
    if (!Array.isArray(input.deltas.changes)) fail('review', 'deltas.changes must be an array');
    try { rows = applyReviewDeltas(rows, input.deltas.changes); }
    catch (error) { fail('review', error instanceof Error ? error.message : 'Invalid review delta'); }
  }
  const finalReport = validateSkuFill({ contractText: input.contractText, expectedContractSha256: refs.contract.sha256, skus: activeSkus, sources, rows });
  checkReport('final', finalReport);
  const byAttribute = new Map(revised.contract.proposals.map((p: any) => [key(p.categoryId, p.key), p]));
  const changed = new Set((input.deltas?.changes ?? []).map((c: any) => key(c.skuId, c.attributeKey)));
  const counts: Record<string, number> = {}, categories: any[] = [];
  for (const sku of activeSkus) {
    let c = categories.find(x => x.categoryId === sku.categoryId);
    if (!c) { c = { categoryId: sku.categoryId, category: sku.category, skus: 0, rows: 0, statuses: {}, summaryRead: 0 }; categories.push(c); }
    c.skus++; if (sku.summaryStatus === 'ok') c.summaryRead++;
  }
  const enriched = rows.map((r, i) => {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    const c = categories.find(x => x.categoryId === r.categoryId)!; c.rows++; c.statuses[r.status] = (c.statuses[r.status] ?? 0) + 1;
    const p: any = byAttribute.get(key(r.categoryId, r.attributeKey));
    const { independentChange, ...rest } = r;
    const before = authorRows.rows[i]!, old = baselineByKey.get(key(r.skuId, r.categoryId, r.attributeKey));
    const history: unknown[] = [];
    for (const item of [...(Array.isArray(before.independentChangeHistory) ? before.independentChangeHistory : []),
      ...(Array.isArray(rest.independentChangeHistory) ? rest.independentChangeHistory : []), old?.independentChange]) {
      if (item !== undefined && !history.some(x => JSON.stringify(x) === JSON.stringify(item))) history.push(structuredClone(item));
    }
    return { ...rest, ...(history.length ? { independentChangeHistory: history } : {}),
      ...(changed.has(key(r.skuId, r.attributeKey)) ? { independentChange } : {}),
      attribute: p.name, definitionId: p.definitionId, definitionVersion: p.definitionVersion, type: p.type,
      mode: p.typing?.choice?.mode ?? null, unit: p.unit ?? null, definition: p.definition, rule: p.shortRule ?? p.rules?.join('；') ?? '',
      ...(activeById.get(r.skuId)?.activeAttributeBasis === undefined ? {} : { activeAttributeBasis: activeById.get(r.skuId)!.activeAttributeBasis }),
      programStatus: finalReport.rows[i]!.programStatus, humanDecision: '' };
  });
  const reviewState = input.review !== undefined ? 'reviewed' : 'draft';
  const patchAuthors = input.patches.flatMap(p => p.author === undefined ? [] : [structuredClone(p.author)]);
  // A recognized image is a specific inspected source, not a claim that every
  // product image was read. Never infer recognition from a URL alone.
  for (const sku of activeSkus) {
    const recognized = sources.filter((s: any) => s.skuId === sku.skuId && s.readState === 'available' &&
      s.kind === 'user_image_manual_observation' && nonempty(s.text) &&
      (nonempty(s.region) || (object(s.region) && Array.isArray(s.region.areas) && s.region.areas.length > 0)) &&
      /^[a-f0-9]{64}$/.test(s.imageSha256 ?? '') && s.extractionMethod === 'manual_visual_transcription');
    if (recognized.length) Object.assign(sku, { imageRecognized: true, imageReadScope: 'referenced_regions_only',
      recognizedImageSourceIds: recognized.map(s => s.sourceId), allImagesRecognized: false });
  }
  const result = { ...structuredClone(baseline), version: 1, createdAt: new Date().toISOString(), contractPath: refs.contract.path,
    contractSha256: refs.contract.sha256, inputs: [...(Array.isArray(baseline.inputs) ? structuredClone(baseline.inputs) : []),
      refs.baseline, refs.contract, ...refs.patches, ...[refs.supplementalSources, refs.routingPatch, refs.tree, refs.review, refs.deltas].filter(Boolean)],
    ...(Array.isArray(baseline.authors) || baseline.authors === undefined ? { authors: [...(baseline.authors ?? []), ...patchAuthors] } : {}),
    reviewState, review: input.review ?? null, changes: input.deltas?.changes ?? [], skus: activeSkus, sources, rows: enriched,
    summary: { ...(object(baseline.summary) ? structuredClone(baseline.summary) : {}), skus: skus.length, attributes: rows.length,
      statuses: counts, categories, humanReviewed: 0, accuracy: null, candidateCoverage: { numerator: counts.proposed ?? 0, denominator: rows.length } },
    revision: { version: 2, baseline: refs.baseline, sources: structuredClone(refs), reviewBindings: bindings, routingSummary: routingStats, patchAuthors,
      previousRevision: baseline.revision ?? null, previousReview: baseline.review ?? null, previousChanges: baseline.changes ?? null,
      previousSummary: baseline.summary ?? null, previousInputs: baseline.inputs ?? null, previousCreatedAt: baseline.createdAt ?? null,
      previousReviewState: baseline.reviewState ?? null, previousContract: { path: baseline.contractPath ?? null, sha256: baseline.contractSha256 ?? null } },
    limitations: [...(Array.isArray(baseline.limitations) ? baseline.limitations.filter((s: string) =>
      !(s === '未读取图片内容' && activeSkus.some(sku => sku.imageRecognized === true))) : []),
      ...(activeSkus.some(sku => sku.imageReadScope === 'referenced_regions_only') ?
        ['已读取补充图片的标记区域；其余图片与完整详情仍未全读，同图复用不算独立证据。'] : []),
      '增量结果和类目路由仅为离线建议；原类目与来源保留，语义仍须独立及人工审校。',
      reviewState === 'draft' ? '本轮结果尚未经过独立审校。' : '独立审校与程序检查不等于人工金标准或准确率。',
      '未获取完整既有参数值，不能直接作为生产写入差异补丁。'],
    productionWrites: 0, deepseekRequests: 0, adoption: 'pending_human' };
  const checks = { version: 2, structureValid: true, reviewState, authorRows: authorReport, final: finalReport, routing: routingStats,
    limitation: '程序仅校验结构、出处与部分确定性转换，不证明类目裁决或属性值语义正确。' };
  return { result, checks, authorRows, reviewBindings };
}
