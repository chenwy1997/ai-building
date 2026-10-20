import { join } from 'node:path';
import { digest, save } from '../runtime/storage.ts';
import { validateEvidenceReference, type EvidenceReference, type ProductEvidence } from '../expansion/rules.ts';
import { evaluateFilledClaim, evaluateRequirements } from '../revision/conditions.ts';
import { validateRevisionRecord, type RevisionIssue, type RevisionRecord } from '../revision/semantic-guards.ts';
import { availableOpinionPolicy, cliOptions, loadCodexReviews, loadContext, modelCoverage, reviewedOpinionVersions, selectedOpinion, trustedVisualIds } from './review-inputs.ts';
import { adaptLegacyQuantityIssue } from './legacy-compat.ts';
import { MODELS, isObject, type CodexReview, type LoadedReview, type RuleDecision, type RunContext, type SourceProduct } from './review-schema.ts';
import { missingBreakdown, samplingSummary, summarizeMetrics, type MetricField, type MetricRow } from './metrics.ts';

const KNOWN_STATUSES = ['filled', 'needs_evidence', 'conflict', 'invalid', 'enum_candidate', 'not_applicable'];
const NO_WAIVER = new Set(['FIELD_NOT_APPLICABLE_UNPROVEN', 'NOT_APPLICABLE_UNSUPPORTED', 'VISUAL_VERIFICATION_NOT_REGISTERED', 'OCR_NOT_CONDITION_EVIDENCE', 'MODEL_ASSERTION_IS_NOT_SOURCE', 'EVIDENCE_NOT_IN_TRUSTED_REGISTRY']);
const problem = (code: string, key: string, message: string, extra: Record<string, any> = {}) => ({ code, key, message, ...extra });
function mergeEvidence(product: SourceProduct, review: CodexReview) {
  const evidence: ProductEvidence[] = [], diagnostics: Record<string, any>[] = [], byId = new Map<string, ProductEvidence>();
  for (const item of [...product.evidence, ...(review.evidence ?? []), ...(review.visualEvidence ?? [])]) {
    if (!isObject(item) || typeof item.id !== 'string' || item.productId !== product.id || typeof item.text !== 'string') { diagnostics.push(problem('CODEX_EVIDENCE_INVALID', product.key, '补充证据必须有唯一ID、当前SKU productId和原文。')); continue; }
    const prior = byId.get(item.id);
    if (prior) {
      if (prior.text !== item.text || prior.productId !== item.productId || prior.kind !== item.kind || prior.sourceRef !== item.sourceRef) diagnostics.push(problem('EVIDENCE_ID_CONFLICT', product.key, '同证据ID对应不同文本/来源，不可合并。', { evidenceId: item.id }));
      continue; // Identical references are registered once; all original files remain unchanged.
    }
    byId.set(item.id, item); evidence.push(item);
  }
  return { evidence, diagnostics };
}
function reviewShape(product: SourceProduct, loaded: LoadedReview, context: RunContext) {
  const r = loaded.review, errors: Record<string, any>[] = [], b = context.standard.bindings.filter(x => x.categoryId === product.categoryId && !x.retired && x.status !== 'retired');
  if (loaded.envelopeStandardHash && loaded.envelopeStandardHash !== context.standardHash || r.standardHash && r.standardHash !== context.standardHash) errors.push(problem('REVIEW_STANDARD_HASH_MISMATCH', product.key, '审查对应标准不是本轮冻结标准。'));
  if (r.productHash && r.productHash !== digest(product)) errors.push(problem('REVIEW_PRODUCT_HASH_MISMATCH', product.key, '该商品证据在审查后发生变化，需重新确认。'));
  if (!isObject(r.category) || !['matched', 'wrong', 'uncertain'].includes(r.category.status) || typeof r.category.reason !== 'string' || !r.category.reason.trim()) errors.push(problem('CATEGORY_REVIEW_INCOMPLETE', product.key, '每件须有独立类目状态和实证理由。'));
  if (!Array.isArray(r.conditionFacts)) errors.push(problem('CONDITION_FACT_REVIEW_MISSING', product.key, '须显式提供conditionFacts数组，未知可为空或null。'));
  if (!Array.isArray(r.reviewNotes) || !r.reviewNotes.some(x => typeof x === 'string' && x.trim())) errors.push(problem('CODEX_REVIEW_NOTES_MISSING', product.key, '逐件Codex裁定须有实际审证说明。'));
  if (!isObject(r.fields)) errors.push(problem('FIELDS_REVIEW_MISSING', product.key, 'fields必须是完整对象。'));
  else {
    if (r.category?.status === 'matched') for (const binding of b) if (!isObject(r.fields[binding.attributeId])) errors.push(problem('BOUND_FIELD_NOT_REVIEWED', product.key, 'matched商品必须逐字段裁定当前全部绑定；不能用模型默认值补齐。', { attributeId: binding.attributeId }));
    for (const [id, f] of Object.entries(r.fields)) if (!isObject(f) || !KNOWN_STATUSES.includes(f.status) || !Object.hasOwn(f, 'value') || typeof f.reason !== 'string' || !f.reason.trim()) errors.push(problem('FIELD_REVIEW_INCOMPLETE', product.key, '字段须明确value/status/reason；不得默认为已审。', { attributeId: id }));
  }
  return errors;
}
function decisionProof(decision: RuleDecision, issue: RevisionIssue, product: RevisionRecord, review: CodexReview, visualIds: string[]) {
  if (decision.decision !== 'accepted' || issue.severity !== 'review' || NO_WAIVER.has(issue.code) || typeof decision.reason !== 'string' || decision.reason.trim().length < 8 || /^(?:已核验|已确认|同意|接受|通过|模型一致)[。.!！\s]*$/u.test(decision.reason)) return null;
  const field = issue.attributeId ? review.fields[issue.attributeId] : undefined;
  const refs = decision.evidence?.length ? decision.evidence : decision.evidenceId && decision.quote ? [{ evidenceId: decision.evidenceId, quote: decision.quote }] : field?.evidenceId && field.quote ? [{ evidenceId: field.evidenceId, quote: field.quote }] : [];
  if (!refs.length || refs.some(ref => validateEvidenceReference(product, ref).length || !evaluateFilledClaim({ value: 'proof', status: 'filled', ...ref }, product, { verifiedVisualEvidenceIds: visualIds }).filled)) return null;
  return { reason: decision.reason, evidence: refs, proofFrom: decision.evidence?.length || decision.evidenceId ? 'decision' : 'field' };
}
function missingReason(field: any, binding: any): { code: string; label: string } {
  if (field.status === 'conflict') return { code: 'source_conflict', label: '来源冲突' };
  if (field.status === 'invalid') return { code: 'invalid_value_or_evidence', label: '取值或证据无效' };
  if (field.templateIssue || /属性(?:定义|建模).*待完善/u.test(field.reason ?? '')) return { code: 'template_issue', label: '属性定义口径待完善' };
  if (field.status === 'enum_candidate') return { code: 'enum_candidate', label: '枚举或原单位候选待审' };
  if (binding.applicabilityState === 'unknown') return { code: 'applicability_unknown', label: '适用条件待判' };
  if (field.status === 'not_applicable' && binding.applicabilityState !== false) return { code: 'unproven_not_applicable', label: '不适用缺少条件反证' };
  if (/单位|口径|范围|每包|每卷|单包|单卷/u.test(field.reason ?? '')) return { code: 'measurement_evidence_missing', label: '计量单位或范围待证' };
  return { code: 'needs_evidence', label: '未说明或缺少本SKU证据' };
}
function categoryIssueType(review: CodexReview, context: RunContext, product: RevisionRecord) {
  const gap = review.category.gapAssessment;
  if (gap) {
    const valid = gap.status === 'confirmed_missing_category' && gap.fullTreeChecked === true && gap.treeHash === context.treeHash && !!gap.proposedName?.trim() && !!gap.reason?.trim() && gap.evidence?.length && gap.evidence.every(ref => !validateEvidenceReference(product, ref).length);
    return valid ? 'confirmed_category_gap' : 'unverified_category_gap';
  }
  return review.category.status === 'matched' ? 'none' : review.category.status === 'uncertain' ? review.category.categoryReasonCode === 'category_strategy_pending' ? 'category_strategy_pending' : 'needs_product_evidence' : review.category.targetConfirmed === true ? 'wrong_existing_category' : 'target_unresolved';
}

export function adjudicateRow(context: RunContext, source: SourceProduct, loaded: LoadedReview) {
  const review = loaded.review, blockers = reviewShape(source, loaded, context), merged = mergeEvidence(source, review);
  const modelReviewAudit = reviewedOpinionVersions(context, review);
  blockers.push(...modelReviewAudit.blockers);
  blockers.push(...merged.diagnostics);
  if (blockers.length) return { row: null, blockers, ruleChecks: [] as any[] };
  const rawCategory = structuredClone(review.category), category = { ...rawCategory }, leaf = category.targetId ? context.leaves.find(l => l.id === category.targetId) : null;
  if (category.targetId && !leaf) blockers.push(problem('TARGET_NOT_V2_LEAF', source.key, '目标ID必须存在于完整V2末级；不能仅在21类中猜一个节点。', { targetId: category.targetId }));
  if (leaf) { category.targetName = leaf.name; category.targetPath = leaf.path; }
  const visualIds = [...new Set([...trustedVisualIds(source, context), ...(review.imageVerified === true ? (review.visualEvidence ?? []).filter(e => e.kind === 'image_verified' && e.productId === source.id && !!e.sourceRef).map(e => e.id) : [])])];
  const product: RevisionRecord = { ...source, category, fields: structuredClone(review.fields), evidence: merged.evidence };
  const precheck = validateRevisionRecord(product, context.standard, { facts: review.conditionFacts, verifiedVisualEvidenceIds: visualIds, factDefinitions: context.standard.conditionFactDefinitions });
  const extraIssues: RevisionIssue[] = [];
  const brand = product.fields['common.brand'];
  if (category.status === 'matched' && brand?.status === 'filled' && context.brandNames.length && brand.value !== '无品牌' && !context.brandNames.includes(String(brand.value))) extraIssues.push({ code: 'BRAND_NOT_IN_REFERENCE', ruleId: 'V21-DICT', severity: 'error', attributeId: 'common.brand', message: '已填品牌须使用本轮品牌参考中的精确名称；字典外保留候选。' });
  if (brand?.status === 'filled' && brand.value === '无品牌' && !/无品牌|品牌[:：]?无|无牌/u.test(brand.quote ?? '')) extraIssues.push({ code: 'BRANDLESS_NOT_EXPLICIT', ruleId: 'V21-DICT', severity: 'review', attributeId: 'common.brand', message: '无品牌须有本SKU明确自称，空值/通用/未知不是无品牌。' });
  const adaptedIssues = precheck.issues.map(originalIssue => {
    const issue = adaptLegacyQuantityIssue(originalIssue, product, context.standard, visualIds);
    const field = issue.attributeId ? product.fields[issue.attributeId] : undefined;
    const def = context.standard.definitions.find(d => d.id === issue.attributeId);
    // The frozen card explicitly registers this one nonspecific mapping. Keep the legacy error for audit,
    // and require an evidence-backed Codex decision; no concrete scent is broadened by this adapter.
    if (issue.code === 'SCENT_VALUE_UNSUPPORTED' && field?.status === 'filled' && field.value === '有香（未注明香型）'
      && def?.id === 'common.scent' && def.enum?.includes(field.value) && def.rule?.includes(field.value)
      && typeof field.quote === 'string' && /^(?:清香(?:型)?|有香(?:型)?)$/u.test(field.quote.trim())
      && !validateEvidenceReference(product, { evidenceId: field.evidenceId ?? undefined, quote: field.quote ?? undefined }).length
      && evaluateFilledClaim(field, product, { verifiedVisualEvidenceIds: visualIds }).filled) {
      return { ...issue, severity: 'review' as const, message: '冻结定义允许明确清香/有香而未注明具体香型映射至已注册通用枚举；仍须Codex核对本SKU精确原词并实证接受。', originalCheck: { ...issue }, adaptation: 'frozen_nonspecific_scent_mapping' };
    }
    return issue;
  });
  const issues = [...new Map([...adaptedIssues, ...extraIssues].map(i => [`${i.attributeId}:${i.code}:${i.message}`, i])).values()];
  const ruleChecks = issues.map(issue => {
    const field = issue.attributeId ? review.fields[issue.attributeId] : undefined;
    const declaredUnresolved = issue.severity === 'review' && ((field && field.status !== 'filled' && !NO_WAIVER.has(issue.code)) || issue.code === 'FACT_CONFLICT' || issue.code === 'CATEGORY_EXCLUDED');
    const decision = review.ruleDecisions?.find(d => d.attributeId === (issue.attributeId ?? 'category') && d.code === issue.code);
    const proof = decision ? decisionProof(decision, issue, product, review, visualIds) : null;
    const resolution = declaredUnresolved ? 'resolved_by_status' : proof ? 'accepted_with_evidence' : 'unresolved';
    return { key: source.key, ...issue, resolution, decision: proof ? { ...decision, ...proof } : null };
  });
  const unresolved = ruleChecks.filter(c => c.resolution === 'unresolved');
  // No accepted review is discarded by the guard's internal conservative copy. Re-evaluate original adjudicated values.
  const effectiveFields = Object.fromEntries(Object.entries(product.fields).map(([id, field]) => {
    const blocking = unresolved.filter(i => i.attributeId === id || i.relatedAttributeIds?.includes(id));
    return [id, field.status === 'filled' && blocking.length ? { ...field, value: null, status: blocking.some(i => i.severity === 'error') ? 'invalid' : 'needs_evidence' } : field];
  }));
  const bindings = context.standard.bindings.filter(b => !b.retired && b.status !== 'retired');
  const requirements = evaluateRequirements(bindings, effectiveFields, context.standard.requirementGroups ?? [], { ...product, fields: effectiveFields }, review.conditionFacts, { verifiedVisualEvidenceIds: visualIds, factDefinitions: context.standard.conditionFactDefinitions });
  const issueType = categoryIssueType(review, context, product);
  if (issueType === 'unverified_category_gap') blockers.push(problem('CATEGORY_GAP_NOT_CONFIRMED', source.key, '缺类须有Codex独立全V2检查、树哈希及本SKU精确证据，不能把待补商品信息称为缺类。'));
  if (category.status === 'matched' && requirements.excluded) blockers.push(problem('MATCHED_CATEGORY_NOT_ADMITTED', source.key, 'matched须目标和当前类目一致且targetConfirmed=true。'));
  if (unresolved.length) blockers.push(...unresolved.map(i => problem('UNRESOLVED_RULE_ISSUE', source.key, i.message, { attributeId: i.attributeId, issueCode: i.code, severity: i.severity })));
  const fieldRecords: MetricField[] = requirements.excluded ? [] : requirements.bindings.map(b => {
    const field = product.fields[b.attributeId]!, def = context.standard.definitions.find(d => d.id === b.attributeId)!, missing = missingReason(field, b), evidence = product.evidence.find(e => e.id === field.evidenceId);
    const independentRequiredFilled = b.inRequiredDenominator && b.requirednessState === true && b.filled;
    const requiredMissing = b.requirednessState === 'unknown' ? { code: b.applicabilityState === 'unknown' ? 'applicability_unknown' : 'requiredness_unknown', label: b.applicabilityState === 'unknown' ? '适用条件待判' : '条件必填待判' } : missing;
    const models = Object.fromEntries(MODELS.flatMap(model => { const f = selectedOpinion(context, source.key, model)?.opinion.fields?.[b.attributeId]; return [[`${model}Value`, f?.value ?? null], [`${model}Status`, f?.status ?? (selectedOpinion(context, source.key, model) ? '未填' : '未取得意见')], [`${model}Unit`, f?.unit ?? null], [`${model}Per`, f?.per ?? null], [`${model}Quote`, f?.quote ?? '']]; }));
    return { key: source.key, oldKey: source.oldKey, productId: source.id, categoryId: source.categoryId, category: source.categoryName, categoryPath: source.categoryPath, categoryStatus: category.status, ...field, attributeId: b.attributeId, name: def.name ?? b.attributeId, source: evidence?.source ?? '', sourceRef: evidence?.sourceRef ?? '', declaredRequired: b.declaredRequired, requirednessMode: b.requirednessMode, requirementGroupId: b.requirementGroupId, applicabilityState: b.applicabilityState, requirednessState: b.requirednessState, conditionalRequirednessUnknown: b.conditionalRequirednessUnknown, inRate: b.inDenominator, filledForMetric: b.inDenominator && b.filled, independentRequiredInRate: b.inRequiredDenominator, independentRequiredFilled, missingReasonCode: !b.inDenominator || b.filled ? '' : missing.code, missingReason: !b.inDenominator || b.filled ? '' : missing.label, requiredMissingReasonCode: !b.inRequiredDenominator || independentRequiredFilled ? '' : requiredMissing.code, requiredMissingReason: !b.inRequiredDenominator || independentRequiredFilled ? '' : requiredMissing.label, reviewSource: loaded.sourceFile, acceptedRuleDecisions: ruleChecks.filter(c => c.attributeId === b.attributeId && c.resolution === 'accepted_with_evidence').map(c => c.decision), ...models };
  });
  const groupRecords = requirements.groups.map(g => ({ groupId: g.groupId, inRate: g.inDenominator, complete: g.complete, applicabilityState: g.applicabilityState, missingReason: g.applicabilityState === 'unknown' ? '组适用条件待判' : g.complete ? '' : '尚无适用且完整的路径', completedPathIds: g.completedPathIds, paths: g.paths }));
  const requiredFieldsComplete = fieldRecords.filter(f => f.independentRequiredInRate).every(f => f.independentRequiredFilled);
  const row: MetricRow = { ...source, category, rawCategory, categoryMetadata: leaf ? { source: '完整V2末级字典', targetId: leaf.id, targetName: leaf.name, targetPath: leaf.path } : null, categoryIssueType: issueType, fields: product.fields, conditionFacts: review.conditionFacts, evidence: product.evidence, verifiedVisualEvidenceIds: visualIds, imageVerified: review.imageVerified === true || visualIds.length > 0, reviewNotes: review.reviewNotes, reviewSource: loaded.sourceFile, modelReviewAudit: modelReviewAudit.records, adjudicator: 'Codex', excluded: requirements.excluded, fieldRecords, groupRecords, completeRequired: !requirements.excluded && requiredFieldsComplete && requirements.complete, allConditionsResolved: requirements.allConditionsResolved, requirements, models: Object.fromEntries(MODELS.map(m => [m, selectedOpinion(context, source.key, m)?.opinion ?? null])), ruleChecks };
  return { row, blockers, ruleChecks };
}

export function assembleDataset(context: RunContext, loaded: LoadedReview[], reviewDiagnostics: Record<string, any>[] = []) {
  const blockers = [...context.universeBlockers, ...reviewDiagnostics], known = new Set(context.products.map(p => p.key)), byKey = new Map<string, LoadedReview>();
  for (const r of loaded) {
    if (!r.review?.key || !known.has(r.review.key)) { blockers.push(problem('UNKNOWN_REVIEW_KEY', r.review?.key ?? '', '审查键不在本轮冻结样本中。', { sourceFile: r.sourceFile })); continue; }
    if (byKey.has(r.review.key)) { blockers.push(problem('DUPLICATE_CODEX_REVIEW', r.review.key, '每件只能有一份有效Codex终审，须先显式合并修订。')); continue; }
    byKey.set(r.review.key, r);
  }
  const missingCodexKeys = context.products.filter(p => !byKey.has(p.key)).map(p => p.key);
  if (missingCodexKeys.length) blockers.push({ code: 'CODEX_ADJUDICATION_INCOMPLETE', missingKeys: missingCodexKeys, message: '逐件Codex裁定未齐，不出正式填充率。' });
  const coverage = modelCoverage(context);
  for (const model of MODELS) if (coverage[model].missingKeys.length && !(availableOpinionPolicy(context) && context.deliveryPolicy!.optionalModels.includes(model))) blockers.push({ code: 'MODEL_COVERAGE_INCOMPLETE', model, missingKeys: coverage[model].missingKeys });
  const rows: MetricRow[] = [], ruleChecks: any[] = [];
  for (const source of context.products) { const review = byKey.get(source.key); if (!review) continue; const result = adjudicateRow(context, source, review); blockers.push(...result.blockers); ruleChecks.push(...result.ruleChecks); if (result.row) rows.push(result.row); }
  const pendingCrossReviews = MODELS.flatMap(model => coverage[model].missingKeys.map(key => ({ key, model, status: 'cross_review_pending' })));
  const readiness = { deliveryPolicy: context.deliveryPolicy ?? null, pendingCrossReviews, schema: 'validation21-readiness-v1', status: blockers.length ? 'blocked-no-rates' : 'ready', checkedAt: new Date().toISOString(), runId: context.runId, standardHash: context.standardHash, productsHash: context.productsHash, expectedActualProducts: context.products.length, codexReviewed: byKey.size, missingCodexKeys, modelCoverage: coverage, sampling: samplingSummary(context), blockers, ruleChecksObserved: ruleChecks.length, ruleChecksUnresolved: ruleChecks.filter(c => c.resolution === 'unresolved').length };
  if (blockers.length) return { readiness, ruleChecks, final: null };
  const fieldRecords = rows.flatMap(r => r.fieldRecords), metrics = summarizeMetrics(rows);
  const perAttribute = context.standard.bindings.filter(b => !b.retired && b.status !== 'retired').map(b => {
    const category = context.standard.categories.find(c => c.id === b.categoryId)!, def = context.standard.definitions.find(d => d.id === b.attributeId)!, fs = fieldRecords.filter(f => f.categoryId === b.categoryId && f.attributeId === b.attributeId), eligible = fs.filter(f => f.inRate), required = fs.filter(f => f.independentRequiredInRate);
    return { categoryId: category.id, category: category.name, categoryPath: category.path, attributeId: b.attributeId, name: def.name, requirednessMode: b.requirednessMode ?? 'independent', slots: eligible.length, filled: eligible.filter(f => f.filledForMetric).length, missing: eligible.filter(f => !f.filledForMetric).length, rate: eligible.length ? eligible.filter(f => f.filledForMetric).length / eligible.length : null, independentRequiredSlots: required.length, independentRequiredFilled: required.filter(f => f.independentRequiredFilled).length, applicabilityUnknown: eligible.filter(f => f.applicabilityState === 'unknown').length, requirednessUnknown: required.filter(f => f.requirednessState === 'unknown').length, missingReasons: missingBreakdown(fs) };
  });
  const final = { deliveryPolicy: context.deliveryPolicy ?? null, pendingCrossReviews, schema: 'validation21-final-v1', status: 'codex-adjudicated-offline-await-root-signoff', runId: context.runId, createdAt: new Date().toISOString(), standardHash: context.standardHash, sampling: samplingSummary(context), metrics, byCategory: context.standard.categories.map(c => ({ id: c.id, name: c.name, path: c.path, ...summarizeMetrics(rows.filter(r => r.categoryId === c.id)) })), perAttribute, missingReasons: missingBreakdown(fieldRecords), independentRequiredMissingReasons: missingBreakdown(fieldRecords, true), rows, fieldRecords, ruleChecks, modelCoverage: coverage, modelDiagnostics: context.modelDiagnostics, inputHashes: { products: context.productsHash, reviews: digest(loaded), tree: context.treeHash, brandNames: digest(context.brandNames), manifests: digest(context.manifests) }, metricPolicy: { overallFields: '仅matched且targetConfirmed=true；所有适用true/unknown的绑定槽，候选/冲突/未知不算filled；确认false才排除。', independentRequiredFields: '只含组外独立必填true/unknown槽；unknown留保守分母但不计必填达标。measurement_group成员不同时算独立核心。', orGroups: '每个适用true/unknown的OR组各计一义务；只有适用true且至少一路成员适用true并有效filled才完成。未选路径unknown保留字段缺项，不阻断该组。', reviewDecisions: 'Codex原值保留；review级提示须实证裁定接受或正式保留未决状态。结构error须修正；不得按模型一致率终裁。', rates: 'rate为0..1，分母0时null；缺失原因分别给缺失槽占比与总槽占比。', population: '样本分层定额且部分小总体全取；不外推21类商品总体。' }, operationsReview: 'not_reviewed', productionWrite: false };
  return { readiness, ruleChecks, final };
}

export async function assemble(context: RunContext) {
  const loaded = await loadCodexReviews(context), result = assembleDataset(context, loaded.reviews, loaded.diagnostics);
  await save(join(context.runDir, 'analysis/readiness.json'), result.readiness);
  await save(join(context.runDir, 'analysis/rule-checks.json'), { schema: 'validation21-rule-checks-v1', checkedAt: result.readiness.checkedAt, standardHash: context.standardHash, productsHash: context.productsHash, checks: result.ruleChecks });
  if (result.final) await save(join(context.runDir, 'analysis/final.json'), result.final);
  return result;
}
if (import.meta.main) {
  const result = await assemble(await loadContext(cliOptions()));
  console.log(JSON.stringify(result.final ? { status: result.final.status, sampling: result.final.sampling, metrics: result.final.metrics } : { status: result.readiness.status, expected: result.readiness.expectedActualProducts, codexReviewed: result.readiness.codexReviewed, modelCoverage: Object.fromEntries(MODELS.map(m => [m, { productsWithResponse: result.readiness.modelCoverage[m].productsWithResponse, expected: result.readiness.modelCoverage[m].expected }])), blockerCodes: [...new Set(result.readiness.blockers.map(b => b.code))] }, null, 2));
  if (!result.final) process.exitCode = 2;
}
