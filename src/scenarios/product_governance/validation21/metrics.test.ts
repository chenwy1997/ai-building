import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '../runtime/storage.ts';
import { adjudicateRow, assembleDataset } from './assemble.ts';
import { buildReviewPackages, preparationOptions, prepareReview, reviewProgress } from './prepare-review.ts';
import { missingBreakdown, samplingSummary, summarizeMetrics, type MetricField, type MetricRow } from './metrics.ts';
import { MODELS, type CodexReview, type LoadedReview, type RunContext } from './review-schema.ts';
import { reviewedOpinionVersions, trustedVisualIds } from './review-inputs.ts';

function context(): RunContext {
  const category = { id: 'cat', name: '测试类', path: '父类>测试类', isLeaf: true };
  const product = { key: 'C01-01', id: 'sku', categoryId: 'cat', categoryName: category.name, categoryPath: category.path, title: '干态商品', sampleRank: 1, evidence: [{ id: 'T', productId: 'sku', kind: 'title', text: '干态商品；80片/包；卷式' }] };
  const standard = { categories: [category], definitions: [{ id: 'state', name: '状态', type: '选项', enum: ['干式（用法未注明）'], selection: '单选' }], bindings: [{ categoryId: 'cat', attributeId: 'state', required: true }], requirementGroups: [], conditionFactDefinitions: [{ fact: 'roll' }] };
  const result: RunContext = { runDir: '/synthetic', runId: 'synthetic', standard, standardHash: digest(standard), products: [product], productsHash: digest([product]), leaves: [category, { id: 'other', name: '其他类', path: '父类>其他类', isLeaf: true }], treeHash: 'complete-v2-hash', modelAttempts: [], modelDiagnostics: [], manifests: {}, universeBlockers: [], visualRegistry: [], brandNames: [] };
  result.modelAttempts = MODELS.map((model, i) => ({ key: product.key, model, sourceFile: `normalized/mock-${model}.json`, stage: 'validate21-mock', modifiedAt: i, opinion: { key: product.key, category: { status: 'matched' }, fields: { state: { value: '模型共同猜测', status: 'filled' } } } }));
  return result;
}
function review(extra: Partial<CodexReview> = {}): CodexReview {
  return { key: 'C01-01', category: { status: 'matched', targetId: 'cat', targetName: '测试类', targetConfirmed: true, reason: '本SKU标题明确为当前测试对象，独立核对用途。' }, fields: { state: { value: '干式（用法未注明）', status: 'filled', evidenceId: 'T', quote: '干态商品', reason: '原文明确干态，未说明用法，人工保留用法未注明。' } }, conditionFacts: [], reviewNotes: ['已阅读精确原文与四模型意见，独立裁定。'], ...extra };
}
const loaded = (r = review()): LoadedReview[] => [{ review: r, sourceFile: 'analysis/codex-reviews/synthetic.json' }];
const proof = () => ({ attributeId: 'state', code: 'SEMANTIC_MAPPING_REQUIRES_REVIEW', decision: 'accepted' as const, reason: '原文干态商品明确销售状态，未声明只能干用；保留用法未注明，不能按模型多数猜测。', evidence: [{ evidenceId: 'T', quote: '干态商品' }] });

test('四模型一致也不能代替逐件Codex裁定，未审时没有final和率', () => {
  const result = assembleDataset(context(), []);
  expect(result.final).toBeNull(); expect(result.readiness.status).toBe('blocked-no-rates');
  expect(result.readiness.missingCodexKeys).toEqual(['C01-01']); expect(Object.hasOwn(result.readiness, 'metrics')).toBe(false);
});

test('模型新文件若仅规范化外壳且原意见相同可保留已读引用', () => {
  const c = context(), prior = c.modelAttempts[0]!;
  const r = review({ modelReviewSources: Object.fromEntries(c.modelAttempts.map(a => [a.model, a.sourceFile])) });
  c.modelAttempts.push({ ...prior, modifiedAt: 100, sourceFile: 'normalized/contract-recovered-deepseek.json', opinion: structuredClone(prior.opinion) });
  const audit = reviewedOpinionVersions(c, r);
  expect(audit.blockers).toEqual([]); expect(audit.records[0]?.status).toBe('identical_opinion_new_file');
  expect(audit.records[0]?.reviewedOpinionDigest).toBe(audit.records[0]?.selectedOpinionDigest);
});

test('已读模型引用变为不同意见须重读，不能靠旧终审出数', () => {
  const c = context(), prior = c.modelAttempts[0]!;
  const r = review({ ruleDecisions: [proof()], modelReview: { status: 'four_models_reviewed', refs: c.modelAttempts.map(a => ({ model: a.model, file: a.sourceFile })) } });
  c.modelAttempts.push({ ...prior, modifiedAt: 100, sourceFile: 'normalized/new-opinion.json', opinion: { ...prior.opinion, reviewNotes: ['新增语义意见，确需阅读。'] } });
  const result = assembleDataset(c, loaded(r));
  expect(result.final).toBeNull(); expect(result.readiness.blockers.some(b => b.code === 'MODEL_OPINION_CHANGED_AFTER_REVIEW')).toBe(true);
});

test('已读文件必须同商品同模型且可选意见digest相符', () => {
  const c = context();
  const refs = Object.fromEntries(c.modelAttempts.map(a => [a.model, { sourceFile: a.sourceFile, opinionDigest: digest(a.opinion) }]));
  const r = review({ modelReviewSources: refs }); expect(reviewedOpinionVersions(c, r).blockers).toEqual([]);
  refs.deepseek!.opinionDigest = 'wrong'; expect(reviewedOpinionVersions(c, r).blockers[0]?.code).toBe('REVIEWED_MODEL_DIGEST_MISMATCH');
  refs.deepseek!.sourceFile = 'normalized/not-containing-this-sku.json'; expect(reviewedOpinionVersions(c, r).blockers[0]?.code).toBe('REVIEWED_MODEL_SOURCE_NOT_FOUND');
});

test('review提示需Codex实证接受，接受后原值重新计入而非被guard静默降级', () => {
  const c = context(), raw = review(), before = JSON.stringify(raw);
  const blocked = assembleDataset(c, loaded(raw));
  expect(blocked.final).toBeNull(); expect(blocked.readiness.ruleChecksUnresolved).toBe(1);
  const accepted = assembleDataset(c, loaded({ ...raw, ruleDecisions: [proof()] }));
  expect(accepted.final?.metrics.overallFields).toEqual({ filled: 1, slots: 1, missing: 0, rate: 1 });
  expect(accepted.final?.rows[0]?.fields.state.value).toBe('干式（用法未注明）');
  expect(accepted.final?.ruleChecks[0]?.resolution).toBe('accepted_with_evidence'); expect(JSON.stringify(raw)).toBe(before);
});

test('泛泛接受、假引文、结构error不允许凭decision豁免', () => {
  for (const decision of [{ ...proof(), reason: '已核验' }, { ...proof(), evidence: [{ evidenceId: 'T', quote: '不存在的证据' }] }]) expect(assembleDataset(context(), loaded(review({ ruleDecisions: [decision] }))).final).toBeNull();
  const c = context(); c.standard.definitions = [{ id: 'state', name: '是否', type: '是否' }];
  const r = review({ fields: { state: { value: '否', status: 'filled', evidenceId: 'T', quote: '干态商品', reason: '错误字符串布尔回归。' } }, ruleDecisions: [{ ...proof(), code: 'BOOLEAN_TYPE_REQUIRED' }] });
  const result = assembleDataset(c, loaded(r)); expect(result.final).toBeNull(); expect(result.readiness.blockers.some(b => b.issueCode === 'BOOLEAN_TYPE_REQUIRED')).toBe(true);
});

test('Codex明确保留待补是有效裁定，模型共识不补其字段', () => {
  const r = review({ fields: { state: { value: null, status: 'needs_evidence', evidenceId: null, quote: null, reason: '当前SKU资料不足，不能确认状态。' } } });
  const result = assembleDataset(context(), loaded(r));
  expect(result.final?.metrics.overallFields.rate).toBe(0); expect(result.final?.metrics.independentRequiredFields.slots).toBe(1);
  expect(result.final?.rows[0]?.fields.state.value).toBeNull(); expect(result.final?.metrics.completeRequiredProducts).toBe(0);
});

test('matched漏字段/缺conditionFacts/重复Codex都阻断正式出数', () => {
  expect(assembleDataset(context(), loaded(review({ fields: {} }))).readiness.blockers.some(b => b.code === 'BOUND_FIELD_NOT_REVIEWED')).toBe(true);
  const r = review(); delete (r as any).conditionFacts;
  expect(assembleDataset(context(), loaded(r)).final).toBeNull();
  expect(assembleDataset(context(), [...loaded(), ...loaded()]).readiness.blockers.some(b => b.code === 'DUPLICATE_CODEX_REVIEW')).toBe(true);
});

test('wrong与uncertain全排除分母，零分母率为null而不是满分', () => {
  for (const category of [{ status: 'wrong', targetId: 'other', targetConfirmed: true, reason: '原SKU对象经独立审证属另一真实末级。' }, { status: 'uncertain', targetConfirmed: false, reason: '没有当前本体图形态，归属待补。' }]) {
    const result = assembleDataset(context(), loaded(review({ category, fields: {} })));
    expect(result.final?.metrics.eligible).toBe(0); expect(result.final?.metrics.overallFields.slots).toBe(0); expect(result.final?.metrics.overallFields.rate).toBeNull(); expect(result.final?.metrics.orGroups.rate).toBeNull();
  }
});

test('目标必须全V2末级，缺类需独立全树证据，不把资料不足当缺类', () => {
  const c = context(), invalid = review({ category: { status: 'wrong', targetId: 'invented', targetConfirmed: true, reason: '伪造目标ID回归。' }, fields: {} });
  expect(assembleDataset(c, loaded(invalid)).readiness.blockers.some(b => b.code === 'TARGET_NOT_V2_LEAF')).toBe(true);
  const pending = assembleDataset(c, loaded(review({ category: { status: 'uncertain', targetConfirmed: false, reason: '商品信息不足。' }, fields: {} })));
  expect(pending.final?.metrics.categoryIssues.needs_product_evidence).toBe(1);
  const strategy = assembleDataset(c, loaded(review({ category: { status: 'uncertain', targetConfirmed: false, categoryReasonCode: 'category_strategy_pending', reason: '固定跨类商品组成已明，尚未定义主商品/组套归属策略。' }, fields: {} })));
  expect(strategy.final?.metrics.categoryIssues.category_strategy_pending).toBe(1);
  expect(strategy.final?.metrics.categoryIssues.needs_product_evidence).toBeUndefined();
  const gap = review({ category: { status: 'wrong', targetConfirmed: false, reason: '对象已明确但全V2承接存在缺口。', gapAssessment: { status: 'confirmed_missing_category', proposedName: '待建专类', reason: '独立核对完整V2现有用途边界后记录缺口。', fullTreeChecked: true, treeHash: c.treeHash, evidence: [{ evidenceId: 'T', quote: '干态商品' }] } }, fields: {} });
  expect(assembleDataset(c, loaded(gap)).final?.metrics.categoryIssues.confirmed_category_gap).toBe(1);
  gap.category.gapAssessment!.treeHash = 'wrong-hash'; expect(assembleDataset(c, loaded(gap)).final).toBeNull();
});

test('OR组义务和独立核心分开，未选路径unknown保留字段缺项', () => {
  const c = context();
  c.standard.definitions = [{ id: 'count', name: '数量', type: '数值', unit: '片/包' }, { id: 'unit', name: '原计数单位', type: '文本' }, { id: 'per', name: '内包装', type: '文本' }, { id: 'length', name: '长度', type: '数值', unit: 'm/卷' }];
  c.standard.bindings = c.standard.definitions.map(d => ({ attributeId: d.id!, categoryId: 'cat', required: true, requirednessMode: 'measurement_group', requirementGroupId: 'g', ...(d.id === 'length' ? { applicabilityCondition: { fact: 'roll' } } : {}) }));
  c.standard.requirementGroups = [{ id: 'g', categoryId: 'cat', paths: [{ id: 'count', attributes: ['count', 'unit', 'per'] }, { id: 'length', attributes: ['length'] }] }];
  const r = review({ fields: { count: { value: 80, status: 'filled', unit: '片/包', evidenceId: 'T', quote: '80片/包', reason: '原文明确单包80片。' }, unit: { value: '片', status: 'filled', evidenceId: 'T', quote: '80片/包', reason: '保留原计数单位。' }, per: { value: '包', status: 'filled', evidenceId: 'T', quote: '80片/包', reason: '保留原包装单位。' }, length: { value: null, status: 'needs_evidence', evidenceId: null, quote: null, reason: '卷形和长度均未明确。' } } });
  const result = assembleDataset(c, loaded(r));
  expect(result.final?.metrics.overallFields).toEqual({ filled: 3, slots: 4, missing: 1, rate: 0.75 });
  expect(result.final?.metrics.independentRequiredFields.slots).toBe(0); expect(result.final?.metrics.orGroups).toEqual({ complete: 1, slots: 1, missing: 0, rate: 1, unknownApplicability: 0 });
  expect(result.final?.metrics.completeRequiredProducts).toBe(1); expect(result.final?.metrics.unknown.applicabilitySlots).toBe(1);
});

test('独立必填unknown保守计分母但不算达标，纯可选unknown不变成必填', () => {
  const c = context(); c.standard.bindings = [{ ...c.standard.bindings[0]!, applicabilityCondition: { fact: 'roll' } }];
  const r = review({ ruleDecisions: [proof()] });
  const result = assembleDataset(c, loaded(r));
  expect(result.final?.metrics.independentRequiredFields).toEqual({ filled: 0, slots: 1, missing: 1, rate: 0, confirmedSlots: 0, unknownSlots: 1 });
  expect(result.final?.metrics.overallFields.rate).toBe(0); expect(result.final?.metrics.completeRequiredProducts).toBe(0);
  c.standard.bindings[0]!.required = false;
  expect(assembleDataset(c, loaded(r)).final?.metrics.independentRequiredFields.slots).toBe(0);
});

test('缺失原因同时给缺失槽和总槽比例，单一主原因不重复膨胀', () => {
  const base: MetricField = { attributeId: 'a', inRate: true, filledForMetric: false, independentRequiredInRate: false, independentRequiredFilled: false, applicabilityState: true, requirednessState: false, requirednessMode: 'independent', missingReasonCode: 'needs_evidence', missingReason: '待补' };
  const result = missingBreakdown([base, { ...base, attributeId: 'b' }, { ...base, attributeId: 'c', missingReasonCode: 'source_conflict', missingReason: '冲突' }, { ...base, attributeId: 'd', filledForMetric: true }]);
  expect(result[0]).toEqual({ reasonCode: 'needs_evidence', reason: '待补', count: 2, shareOfMissingSlots: 2 / 3, shareOfAllSlots: 0.5 });
  expect(result.reduce((n, r) => n + r.count, 0)).toBe(3); expect(result.reduce((n, r) => n + r.shareOfMissingSlots!, 0)).toBe(1);
});

test('metrics自身也防错挂字段误入，不依赖上游先清空数组', () => {
  const field = { attributeId: 'a', inRate: true, filledForMetric: true, independentRequiredInRate: true, independentRequiredFilled: true, applicabilityState: true, requirednessState: true, requirednessMode: 'independent', missingReasonCode: '', missingReason: '' } as MetricField;
  const row: MetricRow = { key: 'x', categoryId: 'cat', category: { status: 'wrong', targetConfirmed: true }, excluded: true, fieldRecords: [field], groupRecords: [], completeRequired: true, allConditionsResolved: true };
  expect(summarizeMetrics([row]).overallFields.slots).toBe(0); expect(summarizeMetrics([row]).completeRequiredProducts).toBe(0);
});

test('样本按manifest实际短缺，不补造1050或外推总体', () => {
  const c = context(); c.standard.categories = Array.from({ length: 21 }, (_, i) => ({ id: `c${i}`, name: `类${i}`, path: `父>类${i}`, isLeaf: true }));
  c.products = c.standard.categories.flatMap((cat, i) => Array.from({ length: i === 20 ? 16 : 50 }, (_, rank) => ({ key: `${cat.id}-${rank}`, id: `${cat.id}-${rank}`, categoryId: cat.id, evidence: [] })));
  c.manifests = { new13: { shortfallSource: { categories: [{ categoryId: 'c20', population: 16 }] } } };
  const s = samplingSummary(c); expect(s.planned).toBe(1050); expect(s.actual).toBe(1016); expect(s.shortfalls[0]?.population).toBe(16); expect(s.shortfalls[0]?.shortfall).toBe(34);
});

test('审核包完整保留所有尝试与原文，紧凑候选绝不自动写Codex裁定', () => {
  const c = context(), earlier = c.modelAttempts[0]!; c.modelAttempts.push({ ...earlier, modifiedAt: 100, sourceFile: 'normalized/retry.json', opinion: { ...earlier.opinion, fields: { state: { value: '重试新意见' } } } });
  const before = JSON.stringify(c), packages = buildReviewPackages(c);
  expect(packages[0]?.sources.products[0]?.modelAttempts).toHaveLength(5); expect(packages[0]?.sources.products[0]?.product.evidence[0]?.text).toBe(c.products[0]?.evidence[0]?.text);
  expect(packages[0]?.batches[0]?.data.products[0]?.agreementIsNotAdjudication).toBe(true); expect(JSON.stringify(c)).toBe(before);
});

test('历史视觉授信必须校验SKU、ID、文本、原图哈希和sourceRef，不看模型自称', () => {
  const c = context(), p = c.products[0]!; p.imageSha256 = 'image-hash';p.evidence.push({ id: 'V', productId: p.id, kind: 'image_verified', text: '实看原图', sourceRef: 'original-url' });
  c.visualRegistry = [{ key: p.key, productId: p.id, evidenceId: 'V', imageSha256: 'image-hash', evidenceHash: digest('实看原图'), sourceRef: 'original-url' }];
  expect(trustedVisualIds(p, c)).toEqual(['V']);p.evidence.at(-1)!.text = '被模型改写';expect(trustedVisualIds(p, c)).toEqual([]);
});

test('确认不适用槽没有缺失原因，未知适用槽仍保留', () => {
  const c = context(); c.products[0]!.evidence[0]!.text += '；平叠单张式';
  c.standard.bindings = [{ ...c.standard.bindings[0]!, applicabilityCondition: { fact: 'roll' } }];
  const r = review({ fields: { state: { value: null, status: 'not_applicable', reason: '明确平叠单张形态，不属于本合成回归的卷形适用条件。', applicability: { value: false, evidenceId: 'T', quote: '平叠单张式' } } }, conditionFacts: [{ fact: 'roll', value: false, evidenceId: 'T', quote: '平叠单张式' }] });
  const result = assembleDataset(c, loaded(r));
  expect(result.final?.fieldRecords[0]?.inRate).toBe(false);
  expect(result.final?.fieldRecords[0]?.missingReasonCode).toBe('');
  expect(result.final?.fieldRecords[0]?.requiredMissingReasonCode).toBe('');
  expect(result.final?.metrics.overallFields.slots).toBe(0);
});

test('已注册通用香型仅对精确清香/有香原词转review，保留旧error和Codex实证门禁', () => {
  for (const quote of ['清香', '清香型', '有香', '有香型']) {
    const c = context(); c.standard.definitions = [{ id: 'common.scent', name: '香型', type: '选项', enum: ['有香（未注明香型）'], rule: '明确清香但无具体香型可录有香（未注明香型）。' }];
    c.standard.bindings = [{ categoryId: 'cat', attributeId: 'common.scent', required: true }];
    c.products[0]!.evidence[0]!.text = quote;
    const r = review({ fields: { 'common.scent': { value: '有香（未注明香型）', status: 'filled', evidenceId: 'T', quote, reason: '仅有原文通用有香声明，无具体香名。' } } });
    const blocked = assembleDataset(c, loaded(r));
    expect(blocked.final).toBeNull(); expect(blocked.ruleChecks[0]?.severity).toBe('review');
    expect(blocked.ruleChecks[0]?.originalCheck.severity).toBe('error');
    r.ruleDecisions = [{ attributeId: 'common.scent', code: 'SCENT_VALUE_UNSUPPORTED', decision: 'accepted', reason: '该SKU合法引文只有清香或有香的通用声明，未声明任何具体香名，按冻结已注册通用枚举保留。', evidence: [{ evidenceId: 'T', quote }] }];
    expect(assembleDataset(c, loaded(r)).final?.metrics.overallFields.filled).toBe(1);
  }
});

test('茶花香、假引文、别SKU和未注册通用香型均不能走通用适配', () => {
  for (const mode of ['specific', 'fake_quote', 'wrong_sku', 'unregistered']) {
    const c = context(); c.standard.definitions = [{ id: 'common.scent', name: '香型', type: '选项', enum: mode === 'unregistered' ? ['茶香'] : ['有香（未注明香型）'], rule: '明确清香可录有香（未注明香型）。' }];
    c.standard.bindings = [{ categoryId: 'cat', attributeId: 'common.scent', required: true }];
    c.products[0]!.evidence[0]!.text = mode === 'specific' ? '茶花香' : '有香型';
    if (mode === 'wrong_sku') c.products[0]!.evidence[0]!.productId = 'other-sku';
    const quote = mode === 'specific' ? '茶花香' : mode === 'fake_quote' ? '清香型' : '有香型';
    const r = review({ fields: { 'common.scent': { value: '有香（未注明香型）', status: 'filled', evidenceId: 'T', quote, reason: '防止错误放宽的合成回归。' } }, ruleDecisions: [{ attributeId: 'common.scent', code: 'SCENT_VALUE_UNSUPPORTED', decision: 'accepted', reason: '即使写了长接受理由也不能绕过具体香型、同SKU引用和注册枚举边界。', evidence: [{ evidenceId: 'T', quote }] }] });
    const result = assembleDataset(c, loaded(r));
    expect(result.final).toBeNull(); expect(result.ruleChecks.some(x => x.adaptation === 'frozen_nonspecific_scent_mapping')).toBe(false);
  }
});

test('增量审核包只写指定类，进度仍保留全类，缺一模型不能标批次已齐', async () => {
  const c = context(), category = { id: 'second', name: '第二类', path: '父>第二类', isLeaf: true };
  c.standard.categories.push(category);
  const p = { ...structuredClone(c.products[0]!), key: 'C02-01', id: 'sku2', categoryId: category.id };
  c.products.push(p);
  const progress = reviewProgress(c);
  expect(progress.fourModelsReady).toBe(1); expect(progress.categories[0]?.readyBatches).toHaveLength(1); expect(progress.categories[1]?.readyBatches).toHaveLength(0);
  expect(progress.categories[1]?.pendingBatches[0]?.pending[0]?.missingModels).toEqual([...MODELS]);
  expect(preparationOptions(['--category', 'C01,C02', '--ready-only'])).toEqual({ categories: ['C01', 'C02'], readyOnly: true });
  c.runDir = await mkdtemp(join(tmpdir(), 'validation21-review-'));
  try {
    const plan = await prepareReview(c, { categories: ['C02'], readyOnly: true });
    expect(await Bun.file(join(c.runDir, 'analysis/review-packages/C02/sources.json')).exists()).toBe(true);
    expect(await Bun.file(join(c.runDir, 'analysis/review-packages/C01/sources.json')).exists()).toBe(false);
    expect(await Bun.file(join(c.runDir, 'analysis/review-packages/C02/C02-01-01.review.json')).exists()).toBe(false);
    expect(plan.categories.filter(x => x.preparedThisRun).map(x => x.code)).toEqual(['C02']);
    expect((await Bun.file(join(c.runDir, 'analysis/review-progress.json')).json()).categories).toHaveLength(2);
  } finally { await rm(c.runDir, { recursive: true, force: true }); }
});

function availablePolicy(c: RunContext) {
  c.deliveryPolicy = { id: 'available-opinions-20261020', standardHash: c.standardHash, productsHash: c.productsHash, requiredModels: ['deepseek','glm'], optionalModels: ['kimi','qwen'], authorization: '用户确认只用已有意见完成实证裁定。' };
  c.modelAttempts = c.modelAttempts.filter(a => a.model !== 'kimi');
  return review({ ruleDecisions: [proof()], reviewPolicy: c.deliveryPolicy.id, missingModelReviews: ['kimi'], modelReviewSources: Object.fromEntries(c.modelAttempts.map(a => [a.model, { sourceFile: a.sourceFile, opinionDigest: digest(a.opinion) }])) });
}
test('显式策略保留缺失交叉意见，默认仍须四模齐', () => {
  const c = context(), r = availablePolicy(c);
  const ok = assembleDataset(c, loaded(r));
  expect(ok.final?.pendingCrossReviews).toEqual([{ key:'C01-01',model:'kimi',status:'cross_review_pending' }]);
  expect(ok.final?.rows[0]?.modelReviewAudit.some((a:any) => a.model === 'kimi' && a.status === 'cross_review_pending')).toBe(true);
  delete c.deliveryPolicy;
  expect(assembleDataset(c, loaded(r)).final).toBeNull();
});
test('策略不允许遗漏已有意见、伪造缺失模型或缺少必须模型', () => {
  for (const mutation of [
    (c:RunContext,r:CodexReview) => { delete (r.modelReviewSources as any).qwen; },
    (c:RunContext,r:CodexReview) => { r.missingModelReviews = []; },
    (c:RunContext,r:CodexReview) => { (r.modelReviewSources as any).kimi = 'invented.json'; },
    (c:RunContext,r:CodexReview) => { c.modelAttempts = c.modelAttempts.filter(a => a.model !== 'deepseek'); r.missingModelReviews = ['deepseek','kimi']; },
    (c:RunContext,r:CodexReview) => { c.deliveryPolicy!.productsHash = 'other-run'; },
  ]) {
    const c=context(),r=availablePolicy(c); mutation(c,r);
    expect(assembleDataset(c,loaded(r)).final).toBeNull();
  }
});
