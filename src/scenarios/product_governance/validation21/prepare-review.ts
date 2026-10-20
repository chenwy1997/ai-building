import { join } from 'node:path';
import { digest, save } from '../runtime/storage.ts';
import { normalizeForComparison } from '../expansion/rules.ts';
import { attemptsFor, cliOptions, loadContext, modelCoverage, selectedOpinion, trustedVisualIds } from './review-inputs.ts';
import { MODELS, type RunContext } from './review-schema.ts';
import { samplingSummary } from './metrics.ts';

export interface PreparationOptions { categories?: string[]; readyOnly?: boolean }
export function preparationOptions(args = process.argv.slice(2)): PreparationOptions {
  const selected = args.flatMap((arg, i) => arg === '--category' ? (args[i + 1] ?? '').split(',').filter(Boolean) : []);
  return { categories: selected.length ? selected : undefined, readyOnly: args.includes('--ready-only') };
}

export function buildReviewPackages(context: RunContext) {
  return context.standard.categories.map((category, categoryIndex) => {
    const code = `C${String(categoryIndex + 1).padStart(2, '0')}`, products = context.products.filter(p => p.categoryId === category.id).sort((a, b) => (a.sampleRank ?? 0) - (b.sampleRank ?? 0) || a.key.localeCompare(b.key));
    const bindings = context.standard.bindings.filter(b => b.categoryId === category.id), ids = new Set(bindings.map(b => b.attributeId));
    const sourceFile = `analysis/review-packages/${code}/sources.json`;
    const sources = { schema: 'validation21-review-sources-v1', standardHash: context.standardHash, products: products.map(p => ({ key: p.key, productHash: digest(p), product: p, modelAttempts: attemptsFor(context, p.key) })) };
    const compact = products.map((p, i) => {
      const modelOpinions = Object.fromEntries(MODELS.map(model => {
        const selected = selectedOpinion(context, p.key, model);
        return [model, selected ? { sourceFile: selected.sourceFile, opinionDigest: digest(selected.opinion), modelIdentity: selected.modelIdentity, sourceRecord: selected.sourceRecord, requestHash: selected.requestHash, stage: selected.stage, category: selected.opinion.category, fields: selected.opinion.fields, conditionFacts: selected.opinion.conditionFacts, reviewNotes: selected.opinion.reviewNotes, attemptCount: attemptsFor(context, p.key, model).length } : null];
      }));
      const differingAttributes = bindings.map(b => b.attributeId).filter(id => new Set(MODELS.map(m => normalizeForComparison((modelOpinions[m] as any)?.fields?.[id] ?? null))).size > 1);
      const missingModels = MODELS.filter(model => !modelOpinions[model]);
      return { key: p.key, oldKey: p.oldKey, id: p.id, productHash: digest(p), title: p.title, saleSpec: p.saleSpec, brand: p.brand, images: p.images, mainImageLocal: p.mainImageLocal, sourcePointer: `${sourceFile}#/products/${i}/product`, trustedVisualEvidenceIds: trustedVisualIds(p, context), evidenceIndex: p.evidence.map((e, j) => ({ id: e.id, kind: e.kind, scope: e.scope, source: e.source, sourceRef: e.sourceRef, characters: e.text.length, preview: e.text.slice(0, 350), previewTruncated: e.text.length > 350, fullSource: `${sourceFile}#/products/${i}/product/evidence/${j}` })), modelOpinions, missingModels, fourModelsReady: missingModels.length === 0, differingAttributes, agreementIsNotAdjudication: true };
    });
    const batches = Array.from({ length: Math.ceil(compact.length / 5) }, (_, i) => {
      const rows = compact.slice(i * 5, i * 5 + 5);
      return { file: `analysis/review-packages/${code}/${code}-${String(i * 5 + 1).padStart(2, '0')}-${String(Math.min(i * 5 + 5, compact.length)).padStart(2, '0')}.review.json`, data: { schema: 'validation21-compact-review-v1', category: { id: category.id, name: category.name, path: category.path }, standardHash: context.standardHash, overview: `analysis/review-packages/${code}/overview.json`, sources: sourceFile, readyForFourModelReview: rows.every(p => p.fourModelsReady), readyKeys: rows.filter(p => p.fourModelsReady).map(p => p.key), products: rows } };
    });
    return { code, sourceFile, sources, overview: { schema: 'validation21-category-review-overview-v1', category, standardHash: context.standardHash, sample: products.length, bindings, definitions: context.standard.definitions.filter(d => ids.has(d.id!)), requirementGroups: context.standard.requirementGroups?.filter(g => g.categoryId === category.id) ?? [], conditionFactDefinitions: context.standard.conditionFactDefinitions, packages: batches.map(b => b.file), reviewRequirements: ['逐件阅读精确原证据并独立裁定；模型一致或多数不是终审。', '证据preview仅索引，引用和计算必须读取完整sources。四模型原始JSON及每次重试完整保留。', 'matched必须填写全部当前绑定；wrong/uncertain fields可空，全部排除原类计率。', '未知条件用null/unknown，不当false；NA必须由真实适用条件为假支持。', '规则review若实证可接受，ruleDecisions须明确属性、code、理由及精确证据；不默默降低正确值。'] }, batches };
  });
}

export function reviewProgress(context: RunContext, packages = buildReviewPackages(context)) {
  const categories = packages.map(p => ({ code: p.code, categoryId: p.overview.category.id, category: p.overview.category.name, sample: p.overview.sample, fourModelsReady: p.batches.reduce((n, b) => n + b.data.readyKeys.length, 0), modelCoverage: modelCoverage({ ...context, products: p.sources.products.map(s => s.product) }), readyBatches: p.batches.filter(b => b.data.readyForFourModelReview).map(b => b.file), pendingBatches: p.batches.filter(b => !b.data.readyForFourModelReview).map(b => ({ file: b.file, readyKeys: b.data.readyKeys, pending: b.data.products.filter(p => !p.fourModelsReady).map(p => ({ key: p.key, missingModels: p.missingModels })) })) }));
  return { schema: 'validation21-review-progress-v1', checkedAt: new Date().toISOString(), standardHash: context.standardHash, productsHash: context.productsHash, products: context.products.length, fourModelsReady: categories.reduce((n, c) => n + c.fourModelsReady, 0), modelCoverage: modelCoverage(context), categories, policy: 'coverage仅指模型返回商品行；早就绪批次可先审，全部一致仍须Codex独立裁定。' };
}

export async function prepareReview(context: RunContext, options: PreparationOptions = {}) {
  const packages = buildReviewPackages(context);
  const selected = options.categories?.length ? packages.filter(p => options.categories!.some(q => q === p.code || q === p.overview.category.id || q === p.overview.category.name)) : packages;
  if (options.categories?.some(q => !selected.some(p => q === p.code || q === p.overview.category.id || q === p.overview.category.name))) throw new Error('不认识的--category：请用C01..C21、真实类目ID或类目名');
  for (const pack of selected) {
    await save(join(context.runDir, pack.sourceFile), pack.sources);
    await save(join(context.runDir, `analysis/review-packages/${pack.code}/overview.json`), pack.overview);
    for (const batch of pack.batches) if (!options.readyOnly || batch.data.readyForFourModelReview) await save(join(context.runDir, batch.file), batch.data);
  }
  const progress = reviewProgress(context, packages);
  await save(join(context.runDir, 'analysis/review-progress.json'), progress);
  const plan = { schema: 'validation21-review-plan-v1', status: 'review-preparation-only-no-adjudication', createdAt: new Date().toISOString(), standardHash: context.standardHash, productsHash: context.productsHash, sampling: samplingSummary(context), modelCoverage: progress.modelCoverage, fourModelsReady: progress.fourModelsReady, modelDiagnostics: context.modelDiagnostics, universeBlockers: context.universeBlockers, categories: packages.map(p => ({ code: p.code, categoryId: p.overview.category.id, category: p.overview.category.name, sample: p.overview.sample, preparedThisRun: selected.includes(p), readyBatches: p.batches.filter(b => b.data.readyForFourModelReview).map(b => b.file), overview: `analysis/review-packages/${p.code}/overview.json`, sources: p.sourceFile, packages: p.batches.map(b => b.file) })), policy: '仅汇总来源与模型意见，不写Codex裁定、不生成填充率。' };
  await save(join(context.runDir, 'analysis/review-plan.json'), plan);
  return plan;
}
if (import.meta.main) {
  const args = process.argv.slice(2), watch = args.includes('--watch'), intervalIndex = args.indexOf('--interval'), interval = Math.max(1000, Number(args[intervalIndex + 1]) || 30000);
  do {
    const plan = await prepareReview(await loadContext(cliOptions(args)), preparationOptions(args));
    console.log(JSON.stringify({ checkedAt: plan.createdAt, products: plan.sampling.actual, categoriesPrepared: plan.categories.filter(c => c.preparedThisRun).map(c => c.code), fourModelsReady: plan.fourModelsReady, readyBatches: plan.categories.reduce((n, c) => n + c.readyBatches.length, 0), modelCoverage: Object.fromEntries(MODELS.map(m => [m, { productsWithResponse: plan.modelCoverage[m].productsWithResponse, expected: plan.modelCoverage[m].expected }])), universeBlockers: plan.universeBlockers }));
    if (watch) await Bun.sleep(interval);
  } while (watch);
}
