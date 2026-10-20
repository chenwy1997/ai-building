import { readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { digest, read } from '../runtime/storage.ts';
import { MODELS, isObject, type CodexReview, type LoadedReview, type ModelAttempt, type ModelId, type RunContext, type SourceProduct, type V2Leaf } from './review-schema.ts';

export const DEFAULT_RUN = resolve('outputs/product-governance/clean-paper-all21-validation-20261019');
export const DEFAULT_TREE = resolve('scratch-category-baseline-20261010/mapped-tree.json');
export function cliOptions(args = process.argv.slice(2)) {
  const value = (flag: string, fallback: string) => { const i = args.indexOf(flag); return i < 0 ? fallback : resolve(args[i + 1] ?? fallback); };
  return { runDir: value('--run', DEFAULT_RUN), treePath: value('--tree', DEFAULT_TREE), standardPath: value('--standard', join(value('--run', DEFAULT_RUN), 'design/standard.json')) };
}
export async function optionalJson(path: string, fallback: any) { return await Bun.file(path).exists() ? read<any>(path) : fallback; }
export async function jsonFiles(dir: string): Promise<string[]> { try { return (await readdir(dir)).filter(f => f.endsWith('.json')).sort(); } catch (e: any) { if (e.code === 'ENOENT') return []; throw e; } }
export function attemptsFor(context: RunContext, key: string, model?: ModelId) { return context.modelAttempts.filter(a => a.key === key && (!model || a.model === model)).sort((a, b) => a.modifiedAt - b.modifiedAt || a.sourceFile.localeCompare(b.sourceFile)); }
export function selectedOpinion(context: RunContext, key: string, model: ModelId) { return attemptsFor(context, key, model).at(-1); }
export function availableOpinionPolicy(context: RunContext) {
  const p = context.deliveryPolicy;
  return !!p && p.id === 'available-opinions-20261020' && p.standardHash === context.standardHash && p.productsHash === context.productsHash
    && p.requiredModels?.join(',') === 'deepseek,glm' && p.optionalModels?.join(',') === 'kimi,qwen' && !!p.authorization?.trim();
}
/** A changed filename alone does not invalidate an actual read; a changed product opinion does. */
export function reviewedOpinionVersions(context: RunContext, review: CodexReview) {
  const declared = isObject(review.modelReviewSources) ? review.modelReviewSources : null;
  const legacy = isObject(review.modelReview) && Array.isArray(review.modelReview.refs) ? review.modelReview.refs : null;
  const blockers: Record<string, any>[] = [], records: Record<string, any>[] = [];
  const permitted = availableOpinionPolicy(context), missing = MODELS.filter(m => !selectedOpinion(context, review.key, m));
  if (permitted && missing.length) {
    if (review.reviewPolicy !== context.deliveryPolicy!.id || JSON.stringify([...(Array.isArray(review.missingModelReviews) ? review.missingModelReviews : [])].sort()) !== JSON.stringify([...missing].sort()))
      blockers.push({ code: 'MISSING_MODEL_DISCLOSURE_REQUIRED', key: review.key, message: '须逐件声明真实缺失模型及本轮交付策略。' });
    if (!declared && !legacy) blockers.push({ code: 'AVAILABLE_MODEL_REFERENCES_REQUIRED', key: review.key, message: '已有意见仍须有实际已读引用，不得省略。' });
  }
  if (!declared && !legacy) return { blockers, records };
  for (const model of MODELS) {
    const raw = declared?.[model] ?? legacy?.find((ref: any) => ref?.model === model);
    const sourceFile = typeof raw === 'string' ? raw : raw?.sourceFile ?? raw?.file;
    const declaredDigest = typeof raw === 'object' && raw ? raw.opinionDigest : undefined;
    const reviewed = typeof sourceFile === 'string' ? attemptsFor(context, review.key, model).find(a => a.sourceFile === sourceFile) : undefined;
    const selected = selectedOpinion(context, review.key, model);
    const base = { key: review.key, model, reviewedSourceFile: sourceFile ?? null, selectedSourceFile: selected?.sourceFile ?? null, reviewedOpinionDigest: reviewed ? digest(reviewed.opinion) : null, selectedOpinionDigest: selected ? digest(selected.opinion) : null };
    if (permitted && !selected && !raw && context.deliveryPolicy!.optionalModels.includes(model)) {
      records.push({ ...base, status: 'cross_review_pending' }); continue;
    }
    if (!reviewed || !selected) {
      blockers.push({ code: 'REVIEWED_MODEL_SOURCE_NOT_FOUND', ...base, message: '声明已读的模型文件须含当前商品和对应模型原意见；不得把未找到的引用当完成对照。' });
      records.push({ ...base, status: 'source_not_found' }); continue;
    }
    if (declaredDigest && declaredDigest !== base.reviewedOpinionDigest) {
      blockers.push({ code: 'REVIEWED_MODEL_DIGEST_MISMATCH', ...base, declaredDigest, message: '已读模型意见文件内容与裁定保存的digest不同，需重新阅读确认。' });
      records.push({ ...base, status: 'reviewed_file_changed' }); continue;
    }
    if (base.reviewedOpinionDigest !== base.selectedOpinionDigest) {
      blockers.push({ code: 'MODEL_OPINION_CHANGED_AFTER_REVIEW', ...base, message: '当前展示模型意见与声明已读原意见内容不同，须重读后显式更新审查引用；不会自动改商品裁定。' });
      records.push({ ...base, status: 'reread_required' }); continue;
    }
    records.push({ ...base, status: sourceFile === selected.sourceFile ? 'same_source' : 'identical_opinion_new_file', modelIdentity: selected.modelIdentity ?? null });
  }
  return { blockers, records };
}
export interface Coverage { productsWithResponse: number; expected: number; missingKeys: string[]; attempts: number }
export function modelCoverage(context: RunContext): Record<ModelId, Coverage> {
  const selectedKeys = new Set(context.products.map(p => p.key));
  return Object.fromEntries(MODELS.map(model => { const attempts = context.modelAttempts.filter(a => a.model === model && selectedKeys.has(a.key)), keys = new Set(attempts.map(a => a.key)); const missingKeys = context.products.filter(p => !keys.has(p.key)).map(p => p.key); return [model, { productsWithResponse: context.products.length - missingKeys.length, expected: context.products.length, missingKeys, attempts: attempts.length }]; })) as Record<ModelId, Coverage>;
}
export function trustedVisualIds(product: SourceProduct, context: RunContext): string[] {
  return context.visualRegistry.filter(r => r.productId === product.id && r.key === product.key && r.imageSha256 && r.imageSha256 === product.imageSha256 && product.evidence.some(e => e.id === r.evidenceId && e.productId === product.id && digest(e.text) === r.evidenceHash && e.sourceRef === r.sourceRef)).map(r => r.evidenceId);
}
export async function loadContext(options: { runDir?: string; treePath?: string; standardPath?: string } = {}): Promise<RunContext> {
  const runDir = options.runDir ?? DEFAULT_RUN;
  const [standard, products, tree, brand, visual] = await Promise.all([
    read<any>(options.standardPath ?? join(runDir, 'design/standard.json')), read<SourceProduct[]>(join(runDir, 'inputs/model-products.json')),
    read<any>(options.treePath ?? DEFAULT_TREE), optionalJson(join(runDir, 'inputs/brand-reference.json'), { items: [] }), optionalJson(join(runDir, 'inputs/verified-visual-evidence.json'), { records: [] }),
  ]);
  if (!Array.isArray(products)) throw new Error('model-products.json必须是纯商品数组');
  const standardHash = digest(standard), productsHash = digest(products), universeBlockers: Record<string, any>[] = [], manifests: Record<string, any> = {};
  const deliveryPolicy = await optionalJson(join(runDir, 'analysis/delivery-policy.json'), undefined);
  if (deliveryPolicy && !availableOpinionPolicy({ deliveryPolicy, standardHash, productsHash } as RunContext)) universeBlockers.push({ code: 'INVALID_DELIVERY_POLICY', message: '交付策略必须绑定当前样本与标准，不能更改必需模型。' });
  const categoryIds = new Set(standard.categories.map((c: any) => c.id)), keys = new Set<string>(), ids = new Set<string>();
  for (const p of products) {
    if (!p.key || keys.has(p.key)) universeBlockers.push({ code: 'DUPLICATE_OR_MISSING_KEY', key: p.key }); keys.add(p.key);
    if (!p.id || ids.has(p.id)) universeBlockers.push({ code: 'DUPLICATE_OR_MISSING_PRODUCT_ID', key: p.key, id: p.id }); ids.add(p.id);
    if (!categoryIds.has(p.categoryId)) universeBlockers.push({ code: 'SOURCE_CATEGORY_NOT_IN_STANDARD', key: p.key });
    if (Object.hasOwn(p, 'fields') || Object.hasOwn(p, 'category') || Object.hasOwn(p, 'models')) universeBlockers.push({ code: 'ANSWERS_IN_SOURCE_INPUT', key: p.key });
  }
  for (const cohort of ['historical', 'new13']) {
    const m = await optionalJson(join(runDir, 'manifests', `${cohort}.json`), null); manifests[cohort] = m;
    if (!m) { universeBlockers.push({ code: 'COHORT_NOT_FROZEN', cohort }); continue; }
    const subset = products.filter(p => p.cohort === cohort);
    if (m.standardHash !== standardHash) universeBlockers.push({ code: 'MANIFEST_STANDARD_HASH_MISMATCH', cohort });
    if (m.productCount !== subset.length || m.productsHash !== digest(subset)) universeBlockers.push({ code: 'MANIFEST_PRODUCT_HASH_MISMATCH', cohort, manifestCount: m.productCount, actual: subset.length });
  }
  for (const category of standard.categories) if (!products.some(p => p.categoryId === category.id)) universeBlockers.push({ code: 'CATEGORY_NOT_SAMPLED', categoryId: category.id });
  const modelAttempts: ModelAttempt[] = [], modelDiagnostics: Record<string, any>[] = [];
  for (const file of await jsonFiles(join(runDir, 'normalized'))) {
    const path = join(runDir, 'normalized', file); let data: any;
    try { data = await read<any>(path); } catch (e) { modelDiagnostics.push({ file: `normalized/${file}`, issue: 'JSON_PARSE_ERROR', message: String(e) }); continue; }
    if (typeof data.stage !== 'string' || !data.stage.startsWith('validate21-')) continue;
    if (!MODELS.includes(data.model)) { modelDiagnostics.push({ file, issue: 'UNKNOWN_MODEL', model: data.model }); continue; }
    if (!Array.isArray(data.content?.products)) { modelDiagnostics.push({ file, issue: 'NO_PRODUCTS_RESPONSE' }); continue; }
    const modifiedAt = (await stat(path)).mtimeMs;
    for (const opinion of data.content.products) {
      if (!isObject(opinion) || !keys.has(opinion.key)) { modelDiagnostics.push({ file, issue: 'UNKNOWN_PRODUCT_KEY', key: opinion?.key }); continue; }
      if (!isObject(opinion.fields) || !isObject(opinion.category)) modelDiagnostics.push({ file, issue: 'MODEL_ROW_SCHEMA_WARNING', key: opinion.key });
      modelAttempts.push({ key: opinion.key, model: data.model, sourceFile: `normalized/${file}`, sourceRecord: data.sourceRecord, stage: data.stage, requestHash: data.requestHash, originalStatus: data.originalStatus, syntaxRecovery: data.syntaxRecovery, modelIdentity: data.modelIdentity, modifiedAt, opinion });
    }
  }
  const nodes = Array.isArray(tree) ? tree : tree.nodes;
  if (!Array.isArray(nodes)) throw new Error('V2树必须包含nodes');
  return { runDir, runId: basename(runDir), deliveryPolicy, standard, standardHash, products, productsHash, leaves: nodes.filter((n: V2Leaf) => n.isLeaf), treeHash: digest(tree), modelAttempts, modelDiagnostics, manifests, universeBlockers, visualRegistry: visual.records ?? [], brandNames: (brand.items ?? []).map((x: any) => x.name) };
}
export async function loadCodexReviews(context: RunContext): Promise<{ reviews: LoadedReview[]; diagnostics: Array<Record<string, any>> }> {
  const reviews: LoadedReview[] = [], diagnostics: Record<string, any>[] = [];
  for (const file of await jsonFiles(join(context.runDir, 'analysis/codex-reviews'))) {
    const sourceFile = `analysis/codex-reviews/${file}`; let data: any;
    try { data = await read<any>(join(context.runDir, sourceFile)); } catch (e) { diagnostics.push({ sourceFile, code: 'REVIEW_JSON_INVALID', message: String(e) }); continue; }
    if (!isObject(data) || !Array.isArray(data.products) || (data.reviewer !== undefined && data.reviewer !== 'Codex')) { diagnostics.push({ sourceFile, code: 'CODEX_REVIEW_ENVELOPE_INVALID' }); continue; }
    for (const review of data.products) reviews.push({ review, sourceFile, envelopeStandardHash: data.standardHash });
  }
  return { reviews, diagnostics };
}
