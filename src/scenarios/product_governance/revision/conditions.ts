import { validateEvidenceReference, type EvidenceReference, type FieldClaim, type ProductRecord } from '../expansion/rules.ts';

export const CONDITION_CONTRACT_VERSION = 'revision-condition-v1';
export type TruthValue = boolean | 'unknown';
export type Condition = { fact: string; equals?: boolean } | { all: readonly Condition[] } | { any: readonly Condition[] };
export interface ConditionFact {
  fact: string;
  value: boolean | null | 'unknown';
  status?: 'known' | 'unknown' | 'conflict';
  evidenceId?: string | null;
  quote?: string | null;
}
export interface FactDefinition { fact: string }
export interface ConditionIssue {
  code: string;
  message: string;
  fact?: string;
  attributeId?: string;
  evidenceId?: string;
}
/** These IDs must come from the caller's independent source/review registry, never model output. */
export interface EvaluationOptions {
  factDefinitions?: readonly FactDefinition[];
  allowedEvidenceIds?: readonly string[];
  verifiedVisualEvidenceIds?: readonly string[];
}
export interface FactEvaluation {
  fact: string;
  value: TruthValue;
  reason: 'known' | 'missing' | 'unknown' | 'conflict' | 'invalid_evidence' | 'unregistered';
  evidence: EvidenceReference[];
  issues: ConditionIssue[];
}
export interface ConditionEvaluation {
  value: TruthValue;
  unknownFacts: string[];
  conflictFacts: string[];
  factResults: FactEvaluation[];
  evidence: EvidenceReference[];
  issues: ConditionIssue[];
}
export interface ConditionalBinding {
  attributeId: string;
  categoryId?: string;
  required: boolean;
  applicabilityCondition?: Condition;
  requiredWhen?: Condition;
  requirednessMode?: 'independent' | 'measurement_group';
  requirementGroupId?: string;
  /** Migration reference only. The revision never silently executes the legacy AST. */
  applicabilityRule?: unknown;
}
export interface BindingEvaluation {
  attributeId: string;
  declaredRequired: boolean;
  requirednessMode: 'independent' | 'measurement_group';
  requirementGroupId?: string;
  applicabilityState: TruthValue;
  requiredWhenState: TruthValue;
  requirednessState: TruthValue;
  independentRequirednessState: TruthValue;
  required: boolean;
  conditionTriggered: boolean;
  applicabilityUnknown: boolean;
  conditionalRequirednessUnknown: boolean;
  inDenominator: boolean;
  inRequiredDenominator: boolean;
  conservativeDenominator: boolean;
  applicability: ConditionEvaluation;
  conditionalRequiredness: ConditionEvaluation;
  issues: ConditionIssue[];
}
export interface RequirementPath {
  id: string;
  attributes: readonly string[];
  applicabilityCondition?: Condition;
}
export interface RequirementGroup {
  id: string;
  categoryId?: string;
  applicabilityCondition?: Condition;
  paths?: readonly RequirementPath[];
  /** Compatibility projection; if both representations exist, they must agree. */
  atLeastOne?: readonly (readonly string[])[];
  applicabilityRule?: unknown;
  reason?: string;
}
export interface FilledEvaluation { filled: boolean; issues: ConditionIssue[] }
export interface PathEvaluation {
  id: string;
  attributes: string[];
  applicabilityState: TruthValue;
  complete: boolean;
  status: 'complete' | 'incomplete' | 'applicability_unknown' | 'not_applicable';
  members: Array<{ attributeId: string; binding: BindingEvaluation | null; fieldStatus: string | null; filled: boolean }>;
  issues: ConditionIssue[];
}
export interface GroupEvaluation {
  groupId: string;
  applicabilityState: TruthValue;
  status: 'complete' | 'incomplete' | 'applicability_unknown' | 'not_applicable';
  complete: boolean;
  inDenominator: boolean;
  conservativeDenominator: boolean;
  completedPathIds: string[];
  paths: PathEvaluation[];
  issues: ConditionIssue[];
}

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];
const problem = (code: string, message: string, extra: Partial<ConditionIssue> = {}): ConditionIssue => ({ code, message, ...extra });
export const allTruth = (values: readonly TruthValue[]): TruthValue => values.includes(false) ? false : values.includes('unknown') ? 'unknown' : true;
export const anyTruth = (values: readonly TruthValue[]): TruthValue => values.includes(true) ? true : values.includes('unknown') ? 'unknown' : false;
const constant = (value: TruthValue): ConditionEvaluation => ({ value, unknownFacts: [], conflictFacts: [], factResults: [], evidence: [], issues: [] });

function referenceIssues(product: ProductRecord, ref: Partial<EvidenceReference>, options: EvaluationOptions): ConditionIssue[] {
  const issues: ConditionIssue[] = validateEvidenceReference(product, ref).map(i => problem(i.code, i.message, { evidenceId: ref.evidenceId }));
  if (issues.length) return issues;
  const evidence = product.evidence.find(e => e.id === ref.evidenceId)!;
  if (options.allowedEvidenceIds && !options.allowedEvidenceIds.includes(evidence.id)) issues.push(problem('EVIDENCE_NOT_IN_TRUSTED_REGISTRY', '证据不在调用方独立提供的来源注册表中。', { evidenceId: evidence.id }));
  const kind = evidence.kind ?? '';
  if (/model|generated|self[_ -]?report|inference/iu.test(kind)) issues.push(problem('MODEL_ASSERTION_IS_NOT_SOURCE', '模型输出或自述判断不能充当原始条件证据。', { evidenceId: evidence.id }));
  if (/ocr/iu.test(kind)) issues.push(problem('OCR_NOT_CONDITION_EVIDENCE', 'OCR仅作线索；条件真/假须引用独立核验后的证据记录。', { evidenceId: evidence.id }));
  if (/image|visual/iu.test(kind) && !options.verifiedVisualEvidenceIds?.includes(evidence.id)) issues.push(problem('VISUAL_VERIFICATION_NOT_REGISTERED', '图像核验须由调用方独立注册；kind或模型imageVerified自称不构成授权。', { evidenceId: evidence.id }));
  return issues;
}

/** Citation validity is checked here; semantic fact adjudication remains the caller's responsibility. */
export function evaluateFact(fact: string, product: ProductRecord, facts: readonly ConditionFact[] = [], options: EvaluationOptions = {}): FactEvaluation {
  if (options.factDefinitions && !options.factDefinitions.some(d => d.fact === fact)) return { fact, value: 'unknown', reason: 'unregistered', evidence: [], issues: [problem('FACT_NOT_REGISTERED', '条件事实名不在本版本事实词典中。', { fact })] };
  const assertions = facts.filter(f => f.fact === fact), accepted: Array<{ value: boolean; ref: EvidenceReference }> = [], issues: ConditionIssue[] = [];
  let explicitlyConflicted = false;
  for (const assertion of assertions) {
    if (assertion.status === 'conflict') explicitlyConflicted = true;
    if (assertion.status !== undefined && !['known', 'unknown', 'conflict'].includes(assertion.status)) {
      issues.push(problem('FACT_STATUS_INVALID', '条件事实状态未注册。', { fact }));
      continue;
    }
    if (assertion.status === 'unknown' || assertion.value === null || assertion.value === 'unknown') continue;
    if (typeof assertion.value !== 'boolean') {
      issues.push(problem('FACT_BOOLEAN_REQUIRED', '已知条件事实必须是true/false；字符串、置信度和缺项不能代替。', { fact }));
      continue;
    }
    const ref = { evidenceId: assertion.evidenceId ?? undefined, quote: assertion.quote ?? undefined };
    const invalid = referenceIssues(product, ref, options);
    issues.push(...invalid.map(i => ({ ...i, fact })));
    if (!invalid.length && assertion.status !== 'conflict') accepted.push({ value: assertion.value, ref: ref as EvidenceReference });
  }
  const values = unique(accepted.map(a => a.value));
  const evidence = accepted.map(a => a.ref);
  if (explicitlyConflicted || values.length > 1) return { fact, value: 'unknown', reason: 'conflict', evidence, issues: [...issues, problem('FACT_CONFLICT', '同一事实的真/假矛盾尚未解除，不能按多数或来源顺序选边。', { fact })] };
  if (values.length === 1) return { fact, value: values[0]!, reason: 'known', evidence, issues };
  return { fact, value: 'unknown', reason: !assertions.length ? 'missing' : issues.length ? 'invalid_evidence' : 'unknown', evidence: [], issues };
}

function mergeCondition(value: TruthValue, children: ConditionEvaluation[]): ConditionEvaluation {
  const results = new Map<string, FactEvaluation>();
  for (const child of children) for (const fact of child.factResults) results.set(fact.fact, fact);
  return { value, unknownFacts: unique(children.flatMap(c => c.unknownFacts)), conflictFacts: unique(children.flatMap(c => c.conflictFacts)), factResults: [...results.values()], evidence: children.flatMap(c => c.evidence), issues: children.flatMap(c => c.issues) };
}

/** Strong Kleene logic: false AND unknown=false; true OR unknown=true. Empty/malformed ASTs are invalid. */
export function evaluateCondition(condition: Condition, product: ProductRecord, facts: readonly ConditionFact[] = [], options: EvaluationOptions = {}): ConditionEvaluation {
  const visit = (node: unknown, ancestors: Set<object>, depth: number): ConditionEvaluation => {
    const invalid = () => ({ ...constant('unknown'), issues: [problem('CONDITION_INVALID', '条件必须是非空all/any或fact布尔谓词，不能用旧optional策略或任意文字代替。')] });
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 64 || ancestors.has(node)) return invalid();
    const n = node as Record<string, unknown>, keys = Object.keys(n), operators = ['fact', 'all', 'any'].filter(k => Object.hasOwn(n, k));
    if (operators.length !== 1) return invalid();
    if (operators[0] === 'fact') {
      if (keys.some(k => !['fact', 'equals'].includes(k)) || typeof n.fact !== 'string' || !n.fact.trim() || (n.equals !== undefined && typeof n.equals !== 'boolean')) return invalid();
      const result = evaluateFact(n.fact, product, facts, options), expected = n.equals ?? true;
      return { value: result.value === 'unknown' ? 'unknown' : result.value === expected, unknownFacts: result.value === 'unknown' ? [result.fact] : [], conflictFacts: result.reason === 'conflict' ? [result.fact] : [], factResults: [result], evidence: result.evidence, issues: result.issues };
    }
    const operator = operators[0] as 'all' | 'any', nodes = n[operator];
    if (keys.length !== 1 || !Array.isArray(nodes) || !nodes.length) return invalid();
    const next = new Set(ancestors).add(node), children = nodes.map(c => visit(c, next, depth + 1));
    const value = children.some(c => c.issues.some(i => i.code === 'CONDITION_INVALID')) ? 'unknown' : operator === 'all' ? allTruth(children.map(c => c.value)) : anyTruth(children.map(c => c.value));
    return mergeCondition(value, children);
  };
  return visit(condition, new Set(), 0);
}

function applicabilityOf(entity: { applicabilityCondition?: Condition; applicabilityRule?: unknown }, product: ProductRecord, facts: readonly ConditionFact[], options: EvaluationOptions): ConditionEvaluation {
  if (entity.applicabilityCondition !== undefined) return evaluateCondition(entity.applicabilityCondition, product, facts, options);
  if (entity.applicabilityRule !== undefined) return { ...constant('unknown'), issues: [problem('LEGACY_APPLICABILITY_REQUIRES_MIGRATION', '旧applicabilityRule仅作迁移参照；须显式提供canonical applicabilityCondition。')] };
  return constant(true);
}

export function evaluateBinding(binding: ConditionalBinding, product: ProductRecord, facts: readonly ConditionFact[] = [], options: EvaluationOptions = {}): BindingEvaluation {
  const applicability = applicabilityOf(binding, product, facts, options);
  const conditionalRequiredness = binding.requiredWhen === undefined ? constant(false) : evaluateCondition(binding.requiredWhen, product, facts, options);
  const issues = [...applicability.issues, ...conditionalRequiredness.issues];
  const mode = binding.requirednessMode ?? 'independent';
  if (!['independent', 'measurement_group'].includes(mode) || (mode === 'measurement_group' && !binding.requirementGroupId)) issues.push(problem('BINDING_GROUP_CONFIGURATION_INVALID', '计量组成员必须明确measurement_group模式及requirementGroupId。', { attributeId: binding.attributeId }));
  if (typeof binding.required !== 'boolean') issues.push(problem('BINDING_REQUIRED_BOOLEAN', '绑定的required须为布尔值。', { attributeId: binding.attributeId }));
  // requiredWhen adds an obligation. A core required=true is never downgraded by missing conditions.
  const obligation: TruthValue = binding.required === true ? true : typeof binding.required !== 'boolean' ? 'unknown' : conditionalRequiredness.value;
  const requirednessState = allTruth([applicability.value, obligation]);
  const independentRequirednessState = mode === 'measurement_group' ? false : requirednessState;
  return {
    attributeId: binding.attributeId, declaredRequired: binding.required, requirednessMode: mode, ...(binding.requirementGroupId ? { requirementGroupId: binding.requirementGroupId } : {}),
    applicabilityState: applicability.value, requiredWhenState: conditionalRequiredness.value, requirednessState, independentRequirednessState,
    required: independentRequirednessState === true, conditionTriggered: conditionalRequiredness.value === true,
    applicabilityUnknown: applicability.value === 'unknown', conditionalRequirednessUnknown: binding.required !== true && conditionalRequiredness.value === 'unknown' && applicability.value !== false,
    inDenominator: applicability.value !== false, inRequiredDenominator: mode !== 'measurement_group' && applicability.value !== false && requirednessState !== false,
    conservativeDenominator: applicability.value === 'unknown' || requirednessState === 'unknown', applicability, conditionalRequiredness, issues,
  };
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return !!value.trim();
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (Array.isArray(value)) return value.length > 0 && value.every(hasValue);
  return typeof value === 'boolean';
}

/** Field semantics/types must already be adjudicated. A filled label alone is never enough. */
export function evaluateFilledClaim(claim: FieldClaim | undefined, product: ProductRecord, options: EvaluationOptions = {}): FilledEvaluation {
  if (!claim || claim.status !== 'filled') return { filled: false, issues: [] };
  if (!hasValue(claim.value)) return { filled: false, issues: [problem('FILLED_VALUE_INVALID', '已填字段必须有有效非空值；false是有效布尔值，0/空白/无限不是有效数量。')] };
  const issues = referenceIssues(product, { evidenceId: claim.evidenceId ?? undefined, quote: claim.quote ?? undefined }, options);
  return { filled: issues.length === 0, issues };
}

function groupPaths(group: RequirementGroup): { paths: RequirementPath[]; issues: ConditionIssue[] } {
  const issues: ConditionIssue[] = [];
  if ((group.paths !== undefined && !Array.isArray(group.paths)) || (group.atLeastOne !== undefined && !Array.isArray(group.atLeastOne))) return { paths: [], issues: [problem('GROUP_PATH_CONFIGURATION_INVALID', '组路径清单必须是数组。')] };
  const paths: RequirementPath[] = group.paths ? [...group.paths] : (group.atLeastOne ?? []).map((attributes, i) => ({ id: `${group.id}:path-${i + 1}`, attributes }));
  if (paths.some(p => !p || typeof p !== 'object' || !Array.isArray(p.attributes))) return { paths: [], issues: [problem('GROUP_PATH_CONFIGURATION_INVALID', '每条组路径须明确attributes数组。')] };
  if (!paths.length || new Set(paths.map(p => p.id)).size !== paths.length || paths.some(p => !p.id || !Array.isArray(p.attributes) || !p.attributes.length || new Set(p.attributes).size !== p.attributes.length || p.attributes.some((a: unknown) => typeof a !== 'string' || !a))) issues.push(problem('GROUP_PATH_CONFIGURATION_INVALID', '组路径必须有唯一ID和非空、无重复的真实绑定字段清单。'));
  if (group.paths && group.atLeastOne && JSON.stringify(group.paths.map(p => p.attributes)) !== JSON.stringify(group.atLeastOne)) issues.push(problem('GROUP_COMPATIBILITY_PROJECTION_MISMATCH', 'paths与兼容atLeastOne字段清单不一致，须先修复标准。'));
  return { paths, issues };
}

export function evaluateRequirementGroup(group: RequirementGroup, bindings: readonly ConditionalBinding[], fields: Record<string, FieldClaim>, product: ProductRecord, facts: readonly ConditionFact[] = [], options: EvaluationOptions = {}): GroupEvaluation {
  const applicability = applicabilityOf(group, product, facts, options), config = groupPaths(group);
  const categoryId = group.categoryId ?? product.categoryId;
  const local = bindings.filter(b => !b.categoryId || !categoryId || b.categoryId === categoryId);
  const paths: PathEvaluation[] = config.paths.map(path => {
    const pathCondition = applicabilityOf(path, product, facts, options), issues = [...pathCondition.issues];
    const members = path.attributes.map(attributeId => {
      const matches = local.filter(b => b.attributeId === attributeId), binding = matches[0];
      if (matches.length !== 1 || !binding || binding.requirednessMode !== 'measurement_group' || binding.requirementGroupId !== group.id) {
        issues.push(problem('GROUP_MEMBER_BINDING_INVALID', '路径成员须唯一存在于当前类目真实绑定，并声明属于当前计量组。', { attributeId }));
        return { attributeId, binding: null, fieldStatus: fields[attributeId]?.status ?? null, filled: false };
      }
      const evaluated = evaluateBinding(binding, product, facts, options), filled = evaluateFilledClaim(fields[attributeId], product, options);
      issues.push(...evaluated.issues, ...filled.issues.map(i => ({ ...i, attributeId })));
      return { attributeId, binding: evaluated, fieldStatus: fields[attributeId]?.status ?? null, filled: filled.filled };
    });
    const applicabilityState = allTruth([pathCondition.value, ...members.map(m => m.binding?.applicabilityState ?? 'unknown')]);
    const complete = applicability.value === true && applicabilityState === true && !config.issues.length && !issues.some(i => ['GROUP_MEMBER_BINDING_INVALID', 'BINDING_GROUP_CONFIGURATION_INVALID', 'BINDING_REQUIRED_BOOLEAN', 'CONDITION_INVALID'].includes(i.code)) && members.every(m => m.filled);
    const status: PathEvaluation['status'] = applicabilityState === false ? 'not_applicable' : applicabilityState === 'unknown' ? 'applicability_unknown' : complete ? 'complete' : 'incomplete';
    return { id: path.id, attributes: [...path.attributes], applicabilityState, complete, status, members, issues };
  });
  const complete = applicability.value === true && !config.issues.length && paths.some(p => p.complete);
  return { groupId: group.id, applicabilityState: applicability.value, status: applicability.value === false ? 'not_applicable' : applicability.value === 'unknown' ? 'applicability_unknown' : complete ? 'complete' : 'incomplete', complete, inDenominator: applicability.value !== false, conservativeDenominator: applicability.value === 'unknown', completedPathIds: paths.filter(p => p.complete).map(p => p.id), paths, issues: [...applicability.issues, ...config.issues, ...paths.flatMap(p => p.issues)] };
}

/** OR completion never requires every alternative; unknown alternatives remain in the field denominator. */
export function evaluateRequirements(bindings: readonly ConditionalBinding[], fields: Record<string, FieldClaim>, groups: readonly RequirementGroup[], product: ProductRecord, facts: readonly ConditionFact[] = [], options: EvaluationOptions = {}) {
  const category = product.category;
  const admitted = category?.status === 'matched' && category.targetConfirmed === true && !!category.targetId && (!product.categoryId || category.targetId === product.categoryId);
  if (!admitted) {
    const exclusionReason = !category ? 'category_missing' : category.status === 'wrong' ? 'wrong_category' : category.status === 'uncertain' ? 'category_uncertain' : category.status !== 'matched' ? 'category_status_invalid' : category.targetConfirmed !== true ? 'category_unconfirmed' : 'category_target_inconsistent';
    return {
      contractVersion: CONDITION_CONTRACT_VERSION, excluded: true, exclusionReason, categoryState: category?.status ?? 'unknown', complete: false, allConditionsResolved: false,
      bindings: [], groups: [],
      counts: { fieldDenominator: 0, fieldFilled: 0, conservativeFieldSlots: 0, applicabilityUnknown: 0, conditionalRequirednessUnknown: 0, independentRequiredDenominator: 0, independentRequiredFilled: 0, requiredGroupDenominator: 0, requiredGroupsComplete: 0, requiredObligationsDenominator: 0, requiredObligationsFilled: 0 },
      issues: [problem('CATEGORY_EXCLUDED', '仅终审matched、targetConfirmed=true且目标等于当前类目的商品可进入要求及分母评估；错挂、待确认、归属缺失或矛盾不代表达标。')],
    };
  }
  const localBindings = bindings.filter(b => !b.categoryId || !product.categoryId || b.categoryId === product.categoryId);
  const localGroups = groups.filter(g => !g.categoryId || !product.categoryId || g.categoryId === product.categoryId);
  const groupResults = localGroups.map(g => evaluateRequirementGroup(g, localBindings, fields, product, facts, options));
  const issues: ConditionIssue[] = [];
  const bindingResults = localBindings.map(binding => {
    const evaluated = evaluateBinding(binding, product, facts, options), field = fields[binding.attributeId], filled = evaluateFilledClaim(field, product, options);
    const ownIssues = [...evaluated.issues, ...filled.issues.map(i => ({ ...i, attributeId: binding.attributeId }))];
    if (field?.status === 'not_applicable' && evaluated.applicabilityState !== false) ownIssues.push(problem('FIELD_NOT_APPLICABLE_UNPROVEN', '字段not_applicable不能代替绑定条件为假；未知仍留在分母。', { attributeId: binding.attributeId }));
    if (field?.status === 'filled' && evaluated.applicabilityState === false) ownIssues.push(problem('FILLED_WHEN_NOT_APPLICABLE', '已填状态与真实绑定不适用矛盾。', { attributeId: binding.attributeId }));
    const group = evaluated.requirednessMode === 'measurement_group' ? groupResults.filter(g => g.groupId === binding.requirementGroupId) : [];
    const belongsToPath = localGroups.some(g => g.id === binding.requirementGroupId && groupPaths(g).paths.some(p => p.attributes.includes(binding.attributeId)));
    const groupMemberInvalid = evaluated.requirednessMode === 'measurement_group' && (group.length !== 1 || !belongsToPath);
    if (groupMemberInvalid) ownIssues.push(problem('GROUP_MEMBERSHIP_UNRESOLVED', '组成员没有唯一且包含本字段的真实组，不能豁免独立要求。', { attributeId: binding.attributeId }));
    const satisfiedByGroup = evaluated.requirednessMode === 'measurement_group' && !groupMemberInvalid && (group[0]!.complete || group[0]!.applicabilityState === false);
    const blocksCompleteness = evaluated.requirednessMode === 'measurement_group'
      ? !satisfiedByGroup
      : evaluated.independentRequirednessState === 'unknown' || (evaluated.required && !filled.filled) || ownIssues.some(i => ['BINDING_GROUP_CONFIGURATION_INVALID', 'BINDING_REQUIRED_BOOLEAN', 'CONDITION_INVALID'].includes(i.code));
    return { ...evaluated, fieldStatus: field?.status ?? null, filled: evaluated.applicabilityState === true && filled.filled, unknownRetainedAfterGroupCompletion: satisfiedByGroup && (evaluated.applicabilityUnknown || evaluated.conditionalRequirednessUnknown), blocksCompleteness, issues: ownIssues };
  });
  if (new Set(localBindings.map(b => b.attributeId)).size !== localBindings.length) issues.push(problem('DUPLICATE_BINDING', '当前类目绑定字段重复。'));
  if (new Set(localGroups.map(g => g.id)).size !== localGroups.length) issues.push(problem('DUPLICATE_GROUP', '当前类目计量组ID重复。'));
  const denominator = bindingResults.filter(b => b.inDenominator), required = bindingResults.filter(b => b.inRequiredDenominator), countedGroups = groupResults.filter(g => g.inDenominator);
  return {
    contractVersion: CONDITION_CONTRACT_VERSION,
    excluded: false, exclusionReason: null, categoryState: 'matched',
    complete: !issues.length && !bindingResults.some(b => b.blocksCompleteness) && groupResults.every(g => g.complete || g.applicabilityState === false),
    allConditionsResolved: !bindingResults.some(b => b.applicabilityUnknown || b.conditionalRequirednessUnknown) && !groupResults.some(g => g.applicabilityState === 'unknown' || g.paths.some(p => p.applicabilityState === 'unknown')),
    bindings: bindingResults, groups: groupResults,
    counts: {
      fieldDenominator: denominator.length, fieldFilled: denominator.filter(b => b.filled).length,
      conservativeFieldSlots: denominator.filter(b => b.conservativeDenominator).length,
      applicabilityUnknown: bindingResults.filter(b => b.applicabilityUnknown).length,
      conditionalRequirednessUnknown: bindingResults.filter(b => b.conditionalRequirednessUnknown).length,
      independentRequiredDenominator: required.length, independentRequiredFilled: required.filter(b => b.filled).length,
      requiredGroupDenominator: countedGroups.length, requiredGroupsComplete: countedGroups.filter(g => g.complete).length,
      requiredObligationsDenominator: required.length + countedGroups.length,
      requiredObligationsFilled: required.filter(b => b.filled).length + countedGroups.filter(g => g.complete).length,
    },
    issues: [...issues, ...bindingResults.flatMap(b => b.issues), ...groupResults.flatMap(g => g.issues)],
  };
}
