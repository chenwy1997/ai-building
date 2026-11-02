import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeRestorationName, restorationEligibility, optionalRestorationAllowed } from './restoration';
import { validateAttribute, validateDictionaries, validateSharedDefinitions, stableJson } from './attribute-contract.mjs';

export const readJson = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const fileHash = async (file: string) => hash(await fs.readFile(file));
export const writeJson = async (file: string, value: unknown) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
};
const semanticFields = ['name', 'type', 'unit', 'required', 'scope', 'definition', 'rules', 'shortRule', 'purpose', 'valueDomain', 'enumValues'];
export const semanticHash = (p: any) => {
  const fields = semanticFields.map(k => [k, p[k] ?? null]);
  // Old definitions retain their historical digest; typed additions are substantive changes.
  for (const k of ['definitionId', 'definitionVersion', 'typing', 'valueExamples']) if (p[k] !== undefined) fields.push([k, JSON.parse(stableJson(p[k]))]);
  return hash(JSON.stringify(fields));
};
export const identity = (p: any) => p.categoryId + ':' + (p.key || p.name);
export function compareBaseline(before: any[], after: any[]) {
  const current = new Map(after.map(p => [identity(p), p]));
  return before.map(p => ({ categoryId: p.categoryId, name: p.name, key: p.key,
    beforeHash: semanticHash(p), afterHash: current.has(identity(p)) ? semanticHash(current.get(identity(p))) : null,
    status: !current.has(identity(p)) ? 'removed' : semanticHash(p) === semanticHash(current.get(identity(p))) ? 'preserved' : 'modified' }));
}

// A database column/default key is evidence of implementation, not of effective form scope.
export function carrierVerified(e: any, expectedCategoryId?: string) {
  return !!(e && e.categoryInstanceId && e.propertyInstanceId && e.effectiveVersion &&
    e.sameMeaning === true && e.visibleInput === true && e.verifiedAt && e.source &&
    (!expectedCategoryId || e.categoryId === expectedCategoryId));
}
export function ownership(name: string, policy: any, evidence?: any) {
  if (policy.explicitExcludedNames.includes(name)) return 'explicit_business_exclusion';
  if (carrierVerified(evidence)) return 'same_scoped_carrier';
  return 'candidate_allowed_scope_pending';
}
export function validateQuantityMapping(m: any, categoryId?: string) {
  if (!m || !m.object || !m.denominator || !m.unit || !['same', 'different', 'unresolved'].includes(m.relationship)) return false;
  return m.relationship !== 'same' || (!!categoryId && carrierVerified(m.carrier, categoryId) && !!m.nativeKey);
}

const normalizeName = normalizeRestorationName;
export function dynamicFieldDecision(d: any, policy: any) {
  const explicit = [...policy.explicitExcludedNames, ...(policy.rules ?? []).filter((r: any) => r.currentPolicy === 'explicit_business_exclusion').flatMap((r: any) => [...r.names, r.key])].map(normalizeName);
  if ([d.sourceName, d.canonicalName].filter(Boolean).map(normalizeName).some(n => explicit.includes(n))) return false;
  const names = [d.sourceName, d.candidateName, d.canonicalName, ...(d.sourceNames ?? [])].filter(Boolean).map(normalizeName);
  const aliases = [...policy.dynamicReviewNames, ...(policy.rules ?? []).filter((r: any) => ['scope_verification_required', 'attribute_candidate_allowed'].includes(r.currentPolicy)).flatMap((r: any) => [...r.names, r.key])].map(normalizeName);
  return names.some(n => aliases.includes(n));
}

export function isHistoricalCarrierExclusion(d: any, policy?: any) {
  const reason = String(d.decision) + ' ' + (d.reason ?? '');
  // These keys identify a historical carrier claim, not proof that the carrier exists in this directory.
  const keys: string[] = [...(policy?.rules ?? []).map((r: any) => r.key), ...(policy?.historicalCarrierReasonKeys ?? [])].filter(Boolean);
  const keyClaim = keys.some(k => new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(reason));
  return (d.decision === 'exclude' || String(d.decision).startsWith('排除')) &&
    (d.exclusionBasis === 'duplicate_carrier' || keyClaim || /原生|warranty|originPlace|weight|职责|默认.*映射|物流|基础字段|基础信息|数据库|已有字段|标准商品|(?:现有|已有|既有).*(?:销售规格|包装组合)/i.test(reason));
}

export function migrateLegacyDecision(d: any, policy: any) {
  const hasHumanExclusion = /不要|排除/.test(d.humanReview ?? '');
  const explicit = policy.explicitExcludedNames.includes(d.sourceName);
  if (isHistoricalCarrierExclusion(d, policy) && !hasHumanExclusion && !explicit && !carrierVerified(d.carrierEvidence, d.categoryId)) {
    return { ...d, historicalDecision: d.decision, historicalReason: d.reason, decision: 'defer',
      reason: '历史仅凭字段职责排除；v4须核目标目录实例、版本、有效继承配置及语义。未自动新增属性。原理由：' + d.reason,
      migrationDisposition: 'unverified_carrier_reopened' };
  }
  return { ...d, migrationDisposition: hasHumanExclusion ? 'explicit_human_exclusion_preserved' : 'legacy_decision_retained' };
}

// Reopening an unsupported exclusion for review is not approval to restore it as an attribute.
export function checkRestorations(baseline: any, proposals: any[], decisions: any[], policy: any) {
  const approval = policy.restorationPolicy;
  if (!approval) return { errors: [], decisions, restored: 0, pending: 0, eligible: 0, excluded: 0 };
  const oldDecisions = new Map<string, any>(baseline.candidateDecisions.map((d: any) => [d.categoryId + ':' + d.sourceName, d]));
  const oldProposals = new Set(baseline.proposals.map(identity));
  const errors: any[] = [];
  const blocked = new Set<string>();
  const deny = (p: any) => {
    if (blocked.has(identity(p))) return;
    blocked.add(identity(p));
    errors.push({ kind: 'restoration_not_approved', category: p.category, attribute: p.name,
      message: '恢复需符合当前用户选择、选填要求及测量对象；包装/物流字段不得改名进入本体属性' });
  };
  const historicalConcepts = new Map<string, any[]>();
  for (const d of baseline.candidateDecisions.filter((d: any) => isHistoricalCarrierExclusion(d, policy))) {
    for (const n of [d.sourceName, d.candidateName, d.canonicalName].filter(Boolean)) {
      const key = d.categoryId + ':' + normalizeName(n);
      historicalConcepts.set(key, [...(historicalConcepts.get(key) ?? []), d]);
    }
  }
  // A newly labelled web/family source cannot bypass an existing same-concept exclusion.
  // Do not equate e.g. net content with gross weight, or product size with shipping dimensions.
  for (const p of proposals.filter(p => !oldProposals.has(identity(p)))) {
    const eligibility = restorationEligibility(p, policy);
    if (eligibility.matched && eligibility.state === 'excluded_by_user') deny(p);
    const prior = [p.name, p.canonicalName].filter(Boolean).flatMap(n => historicalConcepts.get(p.categoryId + ':' + normalizeName(n)) ?? []);
    if (prior.some(d => !optionalRestorationAllowed(p, d, policy))) deny(p);
  }
  for (const d of decisions.filter(d => ['keep', 'merge'].includes(d.decision))) {
    const p = proposals.find(p => p.categoryId === d.categoryId && p.name === d.candidateName);
    if (!p) continue;
    const old = oldDecisions.get(d.categoryId + ':' + d.sourceName);
    const unchangedAcceptedEdge = oldProposals.has(identity(p)) && old?.candidateName === d.candidateName && old?.decision === d.decision &&
      JSON.stringify(old?.restorationScope ?? null) === JSON.stringify(d.restorationScope ?? null) && (old?.humanReview ?? '') === (d.humanReview ?? '');
    if (unchangedAcceptedEdge) continue;
    const sourceChoice = restorationEligibility({ ...d, candidateName: undefined, canonicalName: undefined }, policy);
    if (/不要|排除/.test(d.humanReview ?? '') || (sourceChoice.matched && sourceChoice.state === 'excluded_by_user')) deny(p);
  }
  let restored = 0, pending = 0, eligible = 0, excluded = 0;
  const reviewed = decisions.map(d => {
    const old = oldDecisions.get(d.categoryId + ':' + d.sourceName);
    if (!old || !isHistoricalCarrierExclusion(old, policy)) return d;
    if (d.decision === 'defer') {
      const choice = /不要|排除/.test((old.humanReview ?? '') + ' ' + (d.humanReview ?? ''))
        ? { state: 'excluded_by_user', concept: null, reason: '保留该候选的明确人工排除意见；组级恢复不撤销逐项排除。' }
        : restorationEligibility(d, policy);
      if (choice.state === 'pending_user') pending++;
      else if (choice.state === 'excluded_by_user') excluded++;
      else eligible++;
      return { ...d, decision: choice.state === 'excluded_by_user' ? 'exclude' : 'defer',
        exclusionBasis: choice.state === 'excluded_by_user' ? 'explicit_policy' : d.exclusionBasis,
        previousDecision: d.decision, previousReason: d.reason,
        reason: choice.reason, restorationState: choice.state, restorationConcept: choice.concept,
        historicalDecision: old.decision, historicalReason: old.reason };
    }
    if (!['keep', 'merge'].includes(d.decision)) return d;
    const p = proposals.find(p => p.categoryId === d.categoryId && p.name === d.candidateName);
    if (!p || oldProposals.has(identity(p))) return d;
    if (!optionalRestorationAllowed(p, { ...old, restorationScope: d.restorationScope ?? old.restorationScope,
      humanReview: (old.humanReview ?? '') + ' ' + (d.humanReview ?? '') }, policy)) {
      deny(p);
      return d;
    }
    restored++;
    return { ...d, restorationState: 'allowed_optional_candidate', historicalDecision: old.decision, historicalReason: old.reason };
  });
  return { errors, decisions: reviewed, restored, pending, eligible, excluded };
}

export function checkAttributeTypes(proposals: any[], dictionaries: any = { version: 1, dictionaries: [] }, baseline: any[] = [], inspectLegacy = false) {
  const errors: any[] = [...validateDictionaries(dictionaries)], warnings: any[] = [];
  if (!Array.isArray(proposals) || !Array.isArray(baseline)) errors.push({ kind: 'attribute_type', path: 'proposals', message: '方案和基线必须含 proposals 数组' });
  if (errors.length) return { errors, warnings, checked: 0, legacy: 0 };
  const before = new Map(baseline.filter(p => p && typeof p === 'object' && !Array.isArray(p)).map(p => [identity(p), p]));
  let checked = 0, legacy = 0;
  for (const [i, p] of proposals.entries()) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      errors.push({ kind: 'attribute_type', path: `proposals[${i}]`, message: '属性必须是对象' }); continue;
    }
    const old = before.get(identity(p));
    if (!p.typing && (inspectLegacy || old && semanticHash(old) === semanticHash(p))) {
      legacy++;
      warnings.push({ kind: 'legacy_type_unreviewed', category: p.category, attribute: p.name, path: `proposals[${i}]`, message: '沿用历史定义；尚未按新类型合同复核，不算新合同验收通过' });
      continue;
    }
    checked++;
    errors.push(...validateAttribute(p, dictionaries).map(e => ({ ...e, category: p.category, attribute: p.name, path: `proposals[${i}].${e.path}` })));
  }
  errors.push(...validateSharedDefinitions(proposals));
  return { errors, warnings, checked, legacy };
}

export function validateDraft(draft: any, pool: any, expectedIds: string[], policy: any, context: { dictionaries?: any; baseline?: any[] } = {}) {
  const errors: any[] = [], warnings: any[] = [];
  const add = (kind: string, category: string, attribute: string, message: string) => errors.push({ kind, category, attribute, message });
  const typing = checkAttributeTypes(draft.proposals, context.dictionaries, context.baseline);
  errors.push(...typing.errors); warnings.push(...typing.warnings);
  if (typing.checked && draft.attributeContractVersion !== 1) add('attribute_contract_version', '', '', '新稿需要 attributeContractVersion=1；不能用旧格式跳过类型检查');
  const ids = draft.categories.map((c: any) => c.categoryId);
  if (new Set(ids).size !== ids.length || JSON.stringify([...ids].sort()) !== JSON.stringify([...expectedIds].sort())) add('scope', '', '', '类目范围重复、遗漏或越界');
  if (draft.productionWrites || draft.deepseekRequests) add('execution_scope', '', '', '此运行仅授权Codex离线方案');
  for (const c of draft.categories) {
    const source = pool.categories.find((s: any) => s.id === c.categoryId);
    if (!source) { add('source_category', c.category, '', '缺本类候选池'); continue; }
    const ps = draft.proposals.filter((p: any) => p.categoryId === c.categoryId);
    const ds = draft.candidateDecisions.filter((d: any) => d.categoryId === c.categoryId);
    const evidence = new Map<string, any>(source.evidence.map((e: any) => [e.id, e]));
    const rawNames = source.pool.map((p: any) => p.name);
    if (evidence.size !== source.evidence.length || new Set(rawNames).size !== rawNames.length) add('duplicate_source', c.category, '', '候选名或证据ID重复');
    for (const name of rawNames) if (ds.filter((d: any) => d.sourceName === name).length !== 1) add('candidate_coverage', c.category, name, '每个原始候选应恰好有一个取舍');
    for (const d of ds) {
      if (!['keep', 'merge', 'exclude', 'defer'].includes(d.decision)) add('decision', c.category, d.sourceName, '取舍状态无效');
      if (!rawNames.includes(d.sourceName) && !(d.sourceReferences?.length && d.candidateOrigin)) add('source_provenance', c.category, d.sourceName, '补充候选缺显式来源与类型');
      if (['keep', 'merge'].includes(d.decision) && !ps.some((p: any) => p.name === d.candidateName)) add('decision_target', c.category, d.sourceName, '保留/归并没有属性定义');
      if (d.decision === 'exclude' && dynamicFieldDecision(d, policy)) {
        const nativeReason = d.exclusionBasis === 'duplicate_carrier' || /原生|warranty|已有字段|标准商品|基础字段|数据库|默认.*映射|职责.*承载|native/i.test(d.reason);
        const explicitRestorationPolicy = policy.restorationPolicy && d.exclusionBasis === 'explicit_policy' && restorationEligibility(d, policy).state === 'excluded_by_user';
        if (nativeReason && !explicitRestorationPolicy && !carrierVerified(d.carrierEvidence, c.categoryId)) add('unscoped_exclusion', c.category, d.sourceName, '动态字段不能仅凭原生映射或另一类目入口排除');
        if (!nativeReason && !['business_not_applicable', 'non_attribute', 'duplicate_candidate', 'explicit_policy'].includes(d.exclusionBasis)) warnings.push({ kind: 'legacy_exclusion_basis', category: c.category, attribute: d.sourceName, message: '历史排除理由待结构化归类；本次由独立审校核业务依据，不视为目录载体已核实' });
      }
      for (const key of d.evidenceKeys ?? []) if (!evidence.has(key)) add('evidence', c.category, d.sourceName, '证据ID不存在：' + key);
    }
    if (new Set(ps.map((p: any) => p.name)).size !== ps.length || new Set(ps.map((p: any) => p.key)).size !== ps.length) add('duplicate_attribute', c.category, '', '名称或key重复');
    for (const p of ps) {
      if (p.scope !== 'SKU' || typeof p.required !== 'boolean' || !['text', 'number', 'boolean', 'option', 'dictionary'].includes(p.type) || !p.definition || !p.purpose || !p.rules?.length) add('contract', c.category, p.name, '缺定义/用途/规则或类型、SKU维度、必填合同错误');
      if (p.humanDecision) add('human_authority', c.category, p.name, '新作者稿不得预填人工结论');
      if (ownership(p.name, policy) === 'explicit_business_exclusion') add('explicit_exclusion', c.category, p.name, '违反明确业务职责政策');
      if (!ds.some((d: any) => ['keep', 'merge'].includes(d.decision) && d.candidateName === p.name)) add('missing_decision', c.category, p.name, '属性没有保留或归并取舍');
      for (const key of p.evidenceKeys ?? []) if (!evidence.has(key)) add('evidence', c.category, p.name, '证据ID不存在：' + key);
      const observed = new Set((p.evidenceKeys ?? []).map((id: string) => evidence.get(id)).filter((e: any) => e?.sku || e?.spu).map((e: any) => String(e.spu || e.sku)));
      if (p.sourceSpuCount !== observed.size) add('evidence_count', c.category, p.name, `观察款声明${p.sourceSpuCount}，证据去重${observed.size}`);
      if (p.targetDirectEvidence && !observed.size) add('direct_evidence', c.category, p.name, '本类直接观察需本类商品证据');
      if (!observed.size && !p.sourceReferences?.length && !p.reuseReason) add('provenance', c.category, p.name, '无样本需补充来源或明确同族/常识依据');
      if (p.quantityMapping && !validateQuantityMapping(p.quantityMapping, c.categoryId)) add('quantity_mapping', c.category, p.name, '数量映射对象/分母/单位不全或载体不属于目标目录');
      if (/数量|净含量|单瓶净量/.test(p.name) && !p.quantityMapping) warnings.push({ kind: 'quantity_scope', category: c.category, attribute: p.name, message: '定义可供审阅；原生数量载体映射尚待目标目录核实，不能直接导入' });
    }
  }
  return { errors, warnings };
}

export function validateFamilies(matrix: any, proposals: any[], categoryIds: string[]) {
  const errors: any[] = [], covered = new Set<string>();
  for (const family of matrix.families ?? []) {
    for (const member of family.members) {
      covered.add(member);
      if (!categoryIds.includes(member)) errors.push({ kind: 'family_scope', family: family.name, categoryId: member });
    }
    for (const concept of family.concepts) {
      const ids = concept.assessments.map((a: any) => a.categoryId);
      if (JSON.stringify([...ids].sort()) !== JSON.stringify([...family.members].sort())) errors.push({ kind: 'family_coverage', family: family.name, concept: concept.name });
      for (const a of concept.assessments) {
        if (!['applicable', 'conditional', 'not_applicable', 'unresolved'].includes(a.applicability) || !a.reason) errors.push({ kind: 'family_reason', family: family.name, concept: concept.name, categoryId: a.categoryId });
        for (const name of a.proposalNames ?? []) if (!proposals.some(p => p.categoryId === a.categoryId && p.name === name)) errors.push({ kind: 'family_reference', family: family.name, concept: concept.name, categoryId: a.categoryId, name });
      }
      const bindings = concept.assessments.flatMap((a: any) => (a.proposalNames ?? []).map((name: string) => ({ assessment: a, p: proposals.find(p => p.categoryId === a.categoryId && p.name === name) }))).filter((x: any) => x.p);
      if (bindings.some((x: any) => x.p.typing)) {
        const signatures = new Set(bindings.map((x: any) => JSON.stringify([x.p.type, x.p.unit ?? null, x.p.typing?.choice?.mode ?? null])));
        if (signatures.size > 1 && bindings.some((x: any) => !x.assessment.definitionDifferenceReason)) errors.push({ kind: 'family_type_conflict', family: family.name, concept: concept.name, message: '同族概念的类型、单位或单多选不一致，须逐成员提供 definitionDifferenceReason 并独立审校' });
      }
    }
  }
  const standalone = matrix.standaloneCategories ?? matrix.independentCategories ?? matrix.standalone ?? [];
  for (const s of standalone) {
    const id = typeof s === 'string' ? s : s.categoryId ?? s.id;
    covered.add(id);
    if (!categoryIds.includes(id)) errors.push({ kind: 'standalone_scope', categoryId: id });
  }
  for (const id of categoryIds) if (!covered.has(id)) errors.push({ kind: 'family_missing', categoryId: id });
  for (const p of proposals.filter(p => p.sourceKind === 'family')) {
    const references = (p.sourceReferences ?? []).filter((r: any) => typeof r === 'string' && r.startsWith('family:')).map((r: string) => r.slice(7));
    const externalRefs = (p.sourceReferences ?? []).some((r: any) => typeof r === 'object' && (r.url || r.path));
    const matched = (matrix.families ?? []).some((f: any) => (references.length ? references.includes(f.name) : externalRefs) && f.members.includes(p.categoryId) && f.concepts.some((c: any) => c.assessments.some((a: any) => a.categoryId === p.categoryId && (a.proposalNames ?? []).includes(p.name))));
    if (!matched) errors.push({ kind: 'family_provenance', categoryId: p.categoryId, attribute: p.name, message: '同族来源必须追到共同概念及本成员适用性；常识请另标model_prior' });
  }
  return errors;
}

export async function loadSelection(manifestFile: string) {
  const config = await readJson(manifestFile), base = path.dirname(path.resolve(manifestFile));
  const files: any[] = [];
  const load = async (ref: any) => {
    if (!ref?.path || !ref.sha256) throw Error('Each input requires path and sha256');
    const file = path.resolve(base, ref.path), actual = await fileHash(file);
    if (actual !== ref.sha256) throw Error('Input changed after selection: ' + ref.path);
    files.push({ path: file, sha256: actual }); return readJson(file);
  };
  const scope = await load(config.scope), baseline = await load(config.baseline), baselineSources = await load(config.baselineSources);
  const dictionaries = config.dictionaries ? await load(config.dictionaries) : baseline.dictionaries ?? { version: 1, dictionaries: [] };
  const groups = [];
  for (const g of config.groups) groups.push({ ...g, draft: await load(g.draft), pool: await load(g.pool), matrix: await load(g.matrix) });
  const preservedMatrix = config.preservedMatrix ? await load(config.preservedMatrix) : { families: [] };
  let review = config.review ? await load(config.review) : null;
  for (const ref of config.reviewAmendments ?? []) {
    const amendment = await load(ref);
    review = { ...(review ?? {}), amendments: [...(review?.amendments ?? []), amendment] };
  }
  return { config, scope, baseline, baselineSources, groups, preservedMatrix, files, review, dictionaries };
}

export async function assemble(manifestFile: string, out: string, policy: any) {
  const { config, scope, baseline, baselineSources, groups, preservedMatrix, files, review, dictionaries } = await loadSelection(manifestFile);
  const preserve = new Set<string>(config.preserveCategoryIds);
  const categories = baseline.categories.filter((c: any) => preserve.has(c.categoryId));
  const proposals = baseline.proposals.filter((p: any) => preserve.has(p.categoryId));
  const candidateDecisions = baseline.candidateDecisions.filter((d: any) => preserve.has(d.categoryId)).map((d: any) => migrateLegacyDecision(d, policy));
  const sources = baselineSources.categories.filter((s: any) => preserve.has(s.id));
  const families = [...(preservedMatrix.families ?? [])];
  const standaloneCategories = [...(preservedMatrix.standaloneCategories ?? preservedMatrix.independentCategories ?? [])];
  const errors: any[] = [], warnings: any[] = [], openQuestions: any[] = [];
  for (const d of candidateDecisions) {
    const source = sources.find((s: any) => s.id === d.categoryId);
    for (const key of d.evidenceKeys ?? []) if (!source?.evidence.some((e: any) => e.id === key)) errors.push({ kind: 'legacy_evidence_reference', category: d.category, attribute: d.sourceName, key });
  }
  for (const g of groups) {
    const checks = validateDraft(g.draft, g.pool, g.categoryIds, policy, { dictionaries, baseline: baseline.proposals });
    errors.push(...checks.errors); warnings.push(...checks.warnings);
    errors.push(...validateFamilies(g.matrix, g.draft.proposals, g.categoryIds));
    categories.push(...g.draft.categories); proposals.push(...g.draft.proposals); candidateDecisions.push(...g.draft.candidateDecisions); sources.push(...g.pool.categories);
    families.push(...g.matrix.families); standaloneCategories.push(...(g.matrix.standaloneCategories ?? g.matrix.independentCategories ?? g.matrix.standalone ?? []));
    openQuestions.push(...(g.draft.openQuestions ?? []));
  }
  errors.push(...validateFamilies(preservedMatrix, proposals.filter((p: any) => preserve.has(p.categoryId)), [...preserve]));
  const expected = scope.categories.map((c: any) => c.id), actual = categories.map((c: any) => c.categoryId);
  if (JSON.stringify([...expected].sort()) !== JSON.stringify([...actual].sort())) errors.push({ kind: 'assembly_scope', message: '整合范围不等于选定范围' });
  const baselineDiff = compareBaseline(baseline.proposals.filter((p: any) => expected.includes(p.categoryId)), proposals);
  const requests = new Map<string, any>();
  for (const request of config.proposedBaselineChanges ?? []) {
    const id = identity(request);
    if (requests.has(id) || !request.reason || !request.beforeHash) errors.push({ kind: 'baseline_revision_request', ...request, message: '修改提案需唯一属性标识、旧定义哈希与原因' });
    requests.set(id, request);
  }
  for (const d of baselineDiff) if (d.status !== 'preserved') {
    const request = requests.get(identity(d));
    if (d.status !== 'modified' || request?.beforeHash !== d.beforeHash) errors.push({ kind: 'baseline_changed', ...d });
  }
  for (const id of requests.keys()) if (!baselineDiff.some(d => identity(d) === id && d.status === 'modified')) errors.push({ kind: 'baseline_revision_request', message: '修改清单不存在对应实质变更：' + id });
  const restoration = checkRestorations(baseline, proposals, candidateDecisions, policy);
  errors.push(...restoration.errors);
  const before = new Map(baseline.proposals.map((p: any) => [identity(p), p]));
  const order = new Map(scope.categories.map((c: any, i: number) => [c.id, i]));
  const sort = (a: any, b: any) => Number(order.get(a.categoryId)) - Number(order.get(b.categoryId));
  const merged = proposals.map((p: any) => {
    const old = before.get(identity(p));
    const changed = old && semanticHash(old) !== semanticHash(p);
    return { ...p, v4Disposition: changed ? '本轮修改待审' : old ? '既有已认可' : '本轮新增待审',
      baselineSemanticHash: old ? semanticHash(old) : null,
      ...(changed ? { revisionReason: requests.get(identity(p))?.reason, previousDefinition: old } : {}) };
  });
  const typeChecks = checkAttributeTypes(merged, dictionaries, baseline.proposals);
  errors.push(...typeChecks.errors);
  for (const warning of typeChecks.warnings) if (!warnings.some(w => w.kind === warning.kind && w.category === warning.category && w.attribute === warning.attribute)) warnings.push(warning);
  // Cross-group sharing is checked after joining, not just inside an author's group.
  errors.push(...validateFamilies({ families, standaloneCategories }, merged, expected));
  const cats = categories.map((c: any) => ({ ...c, path: scope.categories.find((s: any) => s.id === c.categoryId).path,
    attributes: merged.filter((p: any) => p.categoryId === c.categoryId).length,
    attributeNames: merged.filter((p: any) => p.categoryId === c.categoryId).map((p: any) => p.name) })).sort(sort);
  const plan = { version: 4, attributeContractVersion: 1, dictionaries, typeChecks,
    categories: cats, proposals: merged.sort(sort), candidateDecisions: restoration.decisions.sort(sort),
    families, standaloneCategories, openQuestions, baselineDiff, lineage: files,
    humanRecognition: config.humanRecognition, independentReview: review, policyRevision: config.policyRevision ?? null, programChecks: errors, warnings,
    restorationReview: { policy: policy.restorationPolicy, restoredDecisions: restoration.restored, pendingUserDecisions: restoration.pending,
      eligiblePendingDefinition: restoration.eligible, retainedExclusions: restoration.excluded },
    fieldOwnershipPolicyHash: hash(JSON.stringify(policy)),
    legacyVerification: { categoryIds: [...preserve], attributeContent: 'hash_compared_to_accepted_baseline',
      typeUnreviewedAttributeIds: merged.filter((p: any) => !p.typing && before.has(identity(p)) && semanticHash(before.get(identity(p))) === semanticHash(p)).map(identity),
      evidenceCounts: 'historical_summary_with_example_references; not recomputed from example keys',
      reopenedCarrierExclusions: candidateDecisions.filter((d: any) => d.migrationDisposition === 'unverified_carrier_reopened').length },
    deepseekRequests: 0, productionWrites: 0, providerUsage: 'Codex agent token/cache counters not available' };
  await writeJson(path.join(out, 'assembly-checks.json'), { errors, warnings, categories: cats.length, proposals: merged.length,
    preserved: baselineDiff.filter(d => d.status === 'preserved').length, modifiedPendingHuman: baselineDiff.filter(d => d.status === 'modified').length,
    typeChecked: typeChecks.checked, typeUnreviewed: typeChecks.legacy,
    added: merged.filter((p: any) => !before.has(identity(p))).length, families: families.length });
  if (errors.length) throw Error(`${errors.length} checks failed; see assembly-checks.json`);
  await writeJson(path.join(out, 'attribute-proposals.json'), plan);
  await writeJson(path.join(out, 'review-sources.json'), { categories: sources, ownSourceRecords: baselineSources.ownSourceRecords ?? [] });
  await writeJson(path.join(out, 'scope.json'), scope);
  return { categories: cats.length, proposals: merged.length, new: merged.length - baselineDiff.length, warnings: warnings.length };
}
