import { expect, test } from 'bun:test';
import { allTruth, anyTruth, evaluateBinding, evaluateCondition, evaluateFact, evaluateFilledClaim, evaluateRequirementGroup, evaluateRequirements, type ConditionalBinding, type Condition, type ConditionFact, type RequirementGroup, type TruthValue } from './conditions.ts';
import type { FieldClaim, ProductRecord } from '../expansion/rules.ts';

const product: ProductRecord = {
  id: 'sku-a', categoryId: 'category-a', category: { status: 'matched', targetId: 'category-a', targetName: '测试类目', targetPath: '父类>测试类目', targetConfirmed: true }, evidence: [
    { id: 'T', productId: 'sku-a', kind: 'title', text: '卷式连续纸不分节，每卷20米；单包80片；仅正装无赠品；原生木浆。' },
    { id: 'S', productId: 'sku-a', kind: 'sale_spec', text: '平叠式单张纸；附赠1包；单包80片。' },
    { id: 'J', productId: 'sku-a', kind: 'upstream_detail', text: '当前SKU每卷20米，不分节。' },
    { id: 'I', productId: 'sku-a', kind: 'image_ocr', text: '单包80片' },
    { id: 'V', productId: 'sku-a', kind: 'image_verified', source: 'Codex主图视觉核验', text: '平叠式单张纸；单包80片。' },
    { id: 'M', productId: 'sku-a', kind: 'model_generated', text: '已经核验，平叠式单张纸' },
    { id: 'OTHER', productId: 'sku-b', kind: 'title', text: '卷式连续纸不分节' },
    { id: 'UNOWNED', kind: 'title', text: '卷式连续纸不分节' },
  ],
};
const fact = (name: string, value: boolean, evidenceId = 'T', quote = '卷式连续纸不分节'): ConditionFact => ({ fact: name, value, evidenceId, quote });
const filled = (value: unknown = 80, evidenceId = 'T', quote = '单包80片'): FieldClaim => ({ value, status: 'filled', evidenceId, quote });
const predicate = (name: string, equals = true): Condition => ({ fact: name, equals });
const member = (attributeId: string, extra: Partial<ConditionalBinding> = {}): ConditionalBinding => ({ attributeId, categoryId: 'category-a', required: true, requirednessMode: 'measurement_group', requirementGroupId: 'measure', ...extra });
const bindings: ConditionalBinding[] = [member('count'), member('unit'), member('per'), member('length', { applicabilityCondition: { all: [predicate('isRollFormat'), predicate('hasExplicitPerforation', false)] } })];
const group: RequirementGroup = { id: 'measure', categoryId: 'category-a', paths: [{ id: 'counted', attributes: ['count', 'unit', 'per'] }, { id: 'length', attributes: ['length'] }], atLeastOne: [['count', 'unit', 'per'], ['length']] };
const fields: Record<string, FieldClaim> = { count: filled(), unit: filled('片'), per: filled('包'), length: { value: null, status: 'needs_evidence' } };

test('完整三值AND/OR真值表，不把unknown当false', () => {
  const values: TruthValue[] = [true, false, 'unknown'];
  const and: TruthValue[][] = [[true, false, 'unknown'], [false, false, false], ['unknown', false, 'unknown']];
  const or: TruthValue[][] = [[true, true, true], [true, false, 'unknown'], [true, 'unknown', 'unknown']];
  for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) {
    expect(allTruth([values[i]!, values[j]!])).toBe(and[i]![j]!);
    expect(anyTruth([values[i]!, values[j]!])).toBe(or[i]![j]!);
  }
});

test('嵌套all/any/fact默认equals=true，false有独立实证才成立', () => {
  const facts = [fact('roll', true), fact('perforated', false), fact('gift', false, 'T', '仅正装无赠品')];
  const condition: Condition = { all: [{ fact: 'roll' }, { any: [predicate('perforated'), predicate('gift', false)] }] };
  expect(evaluateCondition(condition, product, facts).value).toBe(true);
  expect(evaluateCondition(predicate('missing', false), product, facts).value).toBe('unknown');
  expect(evaluateCondition({ all: [predicate('gift'), predicate('missing')] }, product, facts).value).toBe(false);
  expect(evaluateCondition({ any: [predicate('roll'), predicate('missing')] }, product, facts).value).toBe(true);
  expect(evaluateCondition({ all: [predicate('roll'), predicate('missing')] }, product, facts).unknownFacts).toEqual(['missing']);
});

test('同事实真/假矛盾、显式冲突均为unknown，不按多数和来源优先', () => {
  const trueFact = fact('roll', true), falseFact = fact('roll', false, 'S', '平叠式单张纸');
  const result = evaluateFact('roll', product, [trueFact, trueFact, falseFact]);
  expect(result.value).toBe('unknown');
  expect(result.reason).toBe('conflict');
  expect(result.evidence).toHaveLength(3);
  expect(evaluateCondition(predicate('roll', false), product, [trueFact, falseFact]).conflictFacts).toEqual(['roll']);
  expect(evaluateFact('roll', product, [{ ...trueFact, status: 'conflict' }]).value).toBe('unknown');
  expect(evaluateFact('roll', product, [{ fact: 'roll', value: null, status: 'unknown' }]).value).toBe('unknown');
});

test('缺证据、改写、外SKU、未归属、重复证据ID都不能建立事实真或假', () => {
  const cases: ConditionFact[] = [
    { fact: 'roll', value: false }, fact('roll', false, 'missing'), fact('roll', true, 'T', '已经核验卷纸'),
    fact('roll', true, 'OTHER'), fact('roll', false, 'UNOWNED'),
  ];
  for (const item of cases) expect(evaluateFact('roll', product, [item]).value).toBe('unknown');
  const duplicate = { ...product, evidence: [...product.evidence, product.evidence[0]!] };
  expect(evaluateFact('roll', duplicate, [fact('roll', true)]).issues.map(i => i.code)).toContain('EVIDENCE_ID_AMBIGUOUS');
  expect(evaluateFact('roll', product, [fact('roll', true), fact('roll', false, 'T', '改写的反证')]).value).toBe(true);
});

test('模型自称verified、imageVerified或kind=image_verified不能给视觉证据授信', () => {
  const asserted = { ...fact('roll', false, 'V', '平叠式单张纸'), verified: true, imageVerified: true };
  expect(evaluateFact('roll', product, [asserted]).value).toBe('unknown');
  expect(evaluateFact('roll', product, [asserted], { verifiedVisualEvidenceIds: ['V'] }).value).toBe(false);
  expect(evaluateFact('roll', product, [fact('roll', false, 'I', '单包80片')], { verifiedVisualEvidenceIds: ['I'] }).value).toBe('unknown');
  expect(evaluateFact('roll', product, [fact('roll', false, 'M', '平叠式单张纸')], { allowedEvidenceIds: ['M'] }).value).toBe('unknown');
  const inline = { fact: 'roll', value: true, evidenceId: 'invented', quote: '卷式', evidence: { id: 'invented', text: '卷式', productId: product.id }, verified: true } as ConditionFact;
  expect(evaluateFact('roll', product, [inline]).issues.map(i => i.code)).toContain('EVIDENCE_NOT_FOUND');
});

test('调用方可限定来源注册表和事实名词典，未登记一律unknown', () => {
  expect(evaluateFact('roll', product, [fact('roll', true)], { allowedEvidenceIds: ['J'] }).value).toBe('unknown');
  expect(evaluateFact('roll', product, [fact('roll', true)], { factDefinitions: [{ fact: 'perforated' }] }).reason).toBe('unregistered');
  expect(evaluateFact('roll', product, [fact('roll', true)], { factDefinitions: [{ fact: 'roll' }], allowedEvidenceIds: ['T'] }).value).toBe(true);
});

test('事实字符串false、数值置信度、非法状态不能冒充布尔事实', () => {
  for (const item of [{ ...fact('roll', true), value: 'false' }, { ...fact('roll', true), value: 1 }, { ...fact('roll', true), status: 'verified' }]) {
    expect(evaluateFact('roll', product, [item as unknown as ConditionFact]).value).toBe('unknown');
  }
});

test('空/混合/旧optional条件和循环对象安全返回unknown', () => {
  const malformed = [{ all: [] }, { any: [] }, { fact: 'roll', equals: 'false' }, { all: [predicate('roll')], any: [predicate('roll')] }, { fact: 'roll', false: 'optional' }, null];
  const cycle: { all: unknown[] } = { all: [] }; cycle.all.push(cycle); malformed.push(cycle as never);
  for (const condition of malformed) {
    const result = evaluateCondition(condition as unknown as Condition, product, [fact('roll', true)]);
    expect(result.value).toBe('unknown');
    expect(result.issues.map(i => i.code)).toContain('CONDITION_INVALID');
  }
});

test('只有适用true才确认必填；unknown适用保留分母并阻止完整', () => {
  const b: ConditionalBinding = { attributeId: 'material', required: true, applicabilityCondition: predicate('applies') };
  const unknown = evaluateBinding(b, product);
  expect(unknown.applicabilityState).toBe('unknown'); expect(unknown.requirednessState).toBe('unknown');
  expect(unknown.required).toBe(false); expect(unknown.inDenominator).toBe(true); expect(unknown.inRequiredDenominator).toBe(true); expect(unknown.conservativeDenominator).toBe(true);
  const record = evaluateRequirements([b], { material: filled('原生木浆', 'T', '原生木浆') }, [], product);
  expect(record.complete).toBe(false); expect(record.counts.fieldDenominator).toBe(1); expect(record.counts.independentRequiredDenominator).toBe(1);
  expect(record.counts.applicabilityUnknown).toBe(1); expect(record.counts.conditionalRequirednessUnknown).toBe(0);
  const known = evaluateBinding(b, product, [fact('applies', true)]); expect(known.required).toBe(true);
  const no = evaluateBinding(b, product, [fact('applies', false)]); expect(no.requirednessState).toBe(false); expect(no.inDenominator).toBe(false);
});

test('附加requiredWhen未知单列，选填字段仍不能绕过未知条件完整达标', () => {
  const b: ConditionalBinding = { attributeId: 'pack', required: false, requiredWhen: { any: [predicate('gift'), predicate('bonus')] } };
  const unknown = evaluateRequirements([b], { pack: filled('单包80片') }, [], product);
  expect(unknown.complete).toBe(false); expect(unknown.counts.conditionalRequirednessUnknown).toBe(1); expect(unknown.counts.independentRequiredDenominator).toBe(1);
  const no = evaluateBinding(b, product, [fact('gift', false), fact('bonus', false)]);
  expect(no.applicabilityState).toBe(true); expect(no.requirednessState).toBe(false); expect(no.inDenominator).toBe(true);
  const yes = evaluateBinding(b, product, [fact('gift', true), fact('bonus', false)]); expect(yes.required).toBe(true);
  const core = evaluateBinding({ ...b, required: true }, product);
  expect(core.requirednessState).toBe(true); expect(core.conditionalRequirednessUnknown).toBe(false);
});

test('旧false optional不转不适用，legacy AST未迁移不能默认为适用', () => {
  const legacy = evaluateBinding({ attributeId: 'length', required: true, applicabilityRule: { fact: 'roll', false: 'optional' } }, product);
  expect(legacy.applicabilityState).toBe('unknown'); expect(legacy.inDenominator).toBe(true);
  expect(legacy.issues.map(i => i.code)).toContain('LEGACY_APPLICABILITY_REQUIRES_MIGRATION');
  const ordinary = evaluateBinding({ attributeId: 'pack', required: false }, product);
  expect(ordinary.applicabilityState).toBe(true); expect(ordinary.inDenominator).toBe(true);
});

test('字段自己声称not_applicable不能从unknown分母消失', () => {
  const b: ConditionalBinding = { attributeId: 'length', required: true, applicabilityCondition: predicate('roll') };
  const claim: FieldClaim = { value: null, status: 'not_applicable', applicability: { value: false, evidenceId: 'S', quote: '平叠式单张纸' } };
  const unknown = evaluateRequirements([b], { length: claim }, [], product);
  expect(unknown.complete).toBe(false); expect(unknown.counts.fieldDenominator).toBe(1); expect(unknown.counts.independentRequiredDenominator).toBe(1);
  expect(unknown.issues.map(i => i.code)).toContain('FIELD_NOT_APPLICABLE_UNPROVEN');
  const no = evaluateRequirements([b], { length: claim }, [], product, [fact('roll', false, 'S', '平叠式单张纸')]);
  expect(no.complete).toBe(true); expect(no.counts.fieldDenominator).toBe(0);
});

test('有效filled须有值和合法证据，false可填，0/空白/候选/冲突均不完成', () => {
  expect(evaluateFilledClaim(filled(false, 'T', '仅正装无赠品'), product).filled).toBe(true);
  for (const value of [0, '', '  ', null, Infinity, [], {}]) expect(evaluateFilledClaim(filled(value), product).filled).toBe(false);
  for (const status of ['needs_evidence', 'conflict', 'enum_candidate', 'not_applicable']) expect(evaluateFilledClaim({ ...filled(), status }, product).filled).toBe(false);
  expect(evaluateFilledClaim(filled(80, 'OTHER', '卷式连续纸不分节'), product).filled).toBe(false);
  expect(evaluateFilledClaim(filled(80, 'T', '不存在的原文'), product).filled).toBe(false);
});

test('OR组一条完整适用路径即可，未选路径unknown仍留分母而不阻断该组', () => {
  const result = evaluateRequirements(bindings, fields, [group], product);
  expect(result.complete).toBe(true); expect(result.groups[0]?.complete).toBe(true); expect(result.groups[0]?.completedPathIds).toEqual(['counted']);
  expect(result.groups[0]?.paths[1]?.applicabilityState).toBe('unknown'); expect(result.groups[0]?.paths[1]?.complete).toBe(false);
  expect(result.counts.fieldDenominator).toBe(4); expect(result.counts.applicabilityUnknown).toBe(1);
  expect(result.bindings.find(b => b.attributeId === 'length')?.unknownRetainedAfterGroupCompletion).toBe(true);
  expect(result.counts.independentRequiredDenominator).toBe(0); expect(result.counts.requiredGroupDenominator).toBe(1); expect(result.counts.requiredGroupsComplete).toBe(1);
});

test('组外独立核心及条件必填unknown不被已完成OR路径豁免', () => {
  const core: ConditionalBinding = { attributeId: 'net_mass', required: true };
  expect(evaluateRequirements([...bindings, core], fields, [group], product).complete).toBe(false);
  const uncertain: ConditionalBinding = { attributeId: 'interface', required: false, applicabilityCondition: predicate('fit'), requiredWhen: predicate('hasExplicitInterfaceNeed') };
  const result = evaluateRequirements([...bindings, uncertain], fields, [group], product);
  expect(result.groups[0]?.complete).toBe(true); expect(result.complete).toBe(false); expect(result.counts.applicabilityUnknown).toBe(2);
});

test('纯可选字段适用unknown不阻断必填完整，仍占总槽分母且全部状态未确定', () => {
  const optional: ConditionalBinding = { attributeId: 'texture', required: false, applicabilityCondition: predicate('hasSurface') };
  const result = evaluateRequirements([...bindings, optional], fields, [group], product);
  expect(result.complete).toBe(true); expect(result.allConditionsResolved).toBe(false);
  expect(result.counts.fieldDenominator).toBe(5); expect(result.counts.applicabilityUnknown).toBe(2);
  expect(result.counts.independentRequiredDenominator).toBe(0);
  expect(result.bindings.find(b => b.attributeId === 'texture')?.blocksCompleteness).toBe(false);
  const fakedNA = evaluateRequirements([optional], { texture: { value: null, status: 'not_applicable' } }, [], product);
  expect(fakedNA.complete).toBe(true); expect(fakedNA.counts.fieldDenominator).toBe(1);
  expect(fakedNA.issues.map(i => i.code)).toContain('FIELD_NOT_APPLICABLE_UNPROVEN');
});

test('外层组适用unknown即使所有字段filled也不能完成', () => {
  const result = evaluateRequirementGroup({ ...group, applicabilityCondition: predicate('homogeneous') }, bindings, { ...fields, length: filled(20, 'T', '每卷20米') }, product);
  expect(result.applicabilityState).toBe('unknown'); expect(result.complete).toBe(false); expect(result.inDenominator).toBe(true);
  expect(result.completedPathIds).toEqual([]);
});

test('路径条件unknown不能由filled补成true，另一真实完整路径才可达标', () => {
  const conditional: RequirementGroup = { ...group, paths: [{ id: 'counted', attributes: ['count', 'unit', 'per'], applicabilityCondition: predicate('counted') }, { id: 'length', attributes: ['length'] }] };
  expect(evaluateRequirementGroup(conditional, bindings, fields, product).complete).toBe(false);
  const complete = evaluateRequirementGroup(conditional, bindings, { ...fields, length: filled(20, 'T', '每卷20米') }, product, [fact('isRollFormat', true), fact('hasExplicitPerforation', false)]);
  expect(complete.completedPathIds).toEqual(['length']); expect(complete.paths[0]?.applicabilityState).toBe('unknown');
});

test('路径看真实绑定适用性和字段状态，不依据字段applicability自称或NA推断', () => {
  const justLength: RequirementGroup = { id: 'measure', paths: [{ id: 'length', attributes: ['length'] }] };
  const fake: FieldClaim = { ...filled(20, 'T', '每卷20米'), applicability: { value: false, evidenceId: 'S', quote: '平叠式单张纸' } };
  expect(evaluateRequirementGroup(justLength, bindings, { length: fake }, product).complete).toBe(false);
  const falseFacts = [fact('isRollFormat', false, 'S', '平叠式单张纸')];
  expect(evaluateRequirementGroup(justLength, bindings, { length: fake }, product, falseFacts).paths[0]?.status).toBe('not_applicable');
  for (const status of ['needs_evidence', 'conflict', 'enum_candidate', 'not_applicable']) {
    expect(evaluateRequirementGroup(group, bindings, { ...fields, count: { ...filled(), status } }, product).complete).toBe(false);
  }
  expect(evaluateRequirementGroup(group, bindings, { ...fields, count: filled(80, 'T', '假引文') }, product).complete).toBe(false);
});

test('缺绑定、重复绑定、错类目、组名或模式错误均不能组成有效路径', () => {
  const altered = [bindings.slice(1), [...bindings, bindings[0]!], bindings.map(b => ({ ...b, categoryId: 'other' })), bindings.map(b => ({ ...b, requirementGroupId: 'other' })), bindings.map(b => ({ ...b, requirednessMode: 'independent' as const }))];
  for (const bs of altered) expect(evaluateRequirementGroup(group, bs, fields, product).complete).toBe(false);
  const orphan = evaluateRequirements([member('count')], { count: filled() }, [], product);
  expect(orphan.complete).toBe(false); expect(orphan.issues.map(i => i.code)).toContain('GROUP_MEMBERSHIP_UNRESOLVED');
});

test('兼容atLeastOne仍需真实绑定；与canonical paths不一致先修标准', () => {
  const legacyPaths = { id: 'measure', atLeastOne: [['count', 'unit', 'per']] };
  expect(evaluateRequirementGroup(legacyPaths, bindings, fields, product).complete).toBe(true);
  const mismatch = evaluateRequirementGroup({ ...group, atLeastOne: [['count']] }, bindings, fields, product);
  expect(mismatch.complete).toBe(false); expect(mismatch.issues.map(i => i.code)).toContain('GROUP_COMPATIBILITY_PROJECTION_MISMATCH');
  expect(evaluateRequirementGroup({ id: 'measure', paths: [] }, bindings, fields, product).complete).toBe(false);
});

test('未知和冲突条件没有任何分母优惠，已证假才排除', () => {
  const b: ConditionalBinding = { attributeId: 'length', required: true, applicabilityCondition: predicate('roll') };
  for (const fs of [[], [fact('roll', true), fact('roll', false, 'S', '平叠式单张纸')], [fact('roll', false, 'OTHER')]]) {
    const result = evaluateRequirements([b], { length: { value: null, status: 'not_applicable' } }, [], product, fs);
    expect(result.counts.fieldDenominator).toBe(1); expect(result.counts.requiredObligationsDenominator).toBe(1); expect(result.complete).toBe(false);
  }
  const provenFalse = evaluateRequirements([b], {}, [], product, [fact('roll', false, 'S', '平叠式单张纸')]);
  expect(provenFalse.counts.fieldDenominator).toBe(0); expect(provenFalse.complete).toBe(true);
});

test('requirements入口排除wrong/uncertain及缺失归属，所有rate计数清零且不声称通过', () => {
  for (const category of [{ status: 'wrong', targetId: 'other', targetConfirmed: true }, { status: 'uncertain', targetId: 'other', targetConfirmed: false }, undefined]) {
    const result = evaluateRequirements(bindings, fields, [group], { ...product, category });
    expect(result.excluded).toBe(true); expect(result.complete).toBe(false);
    expect(result.bindings).toEqual([]); expect(result.groups).toEqual([]);
    expect(Object.values(result.counts).every(value => value === 0)).toBe(true);
    expect(result.issues.map(i => i.code)).toContain('CATEGORY_EXCLUDED');
  }
  const local = evaluateBinding({ attributeId: 'core', required: true }, { ...product, category: undefined });
  expect(local.required).toBe(true);
});

test('matched自称但未终审确认或目标矛盾同样不准入；明确matched正常评估', () => {
  for (const category of [{ ...product.category!, targetConfirmed: false }, { status: 'matched', targetId: 'category-a' }, { ...product.category!, targetId: 'other' }]) {
    const result = evaluateRequirements(bindings, fields, [group], { ...product, category });
    expect(result.excluded).toBe(true); expect(result.complete).toBe(false); expect(result.counts.fieldDenominator).toBe(0);
  }
  const admitted = evaluateRequirements(bindings, fields, [group], product);
  expect(admitted.excluded).toBe(false); expect(admitted.complete).toBe(true); expect(admitted.counts.fieldDenominator).toBe(4);
});

test('求值是纯函数，不改历史product、facts、字段或绑定', () => {
  const inputs = { bindings, fields, group, product, facts: [fact('isRollFormat', true)] };
  const before = JSON.stringify(inputs);
  evaluateRequirements(bindings, fields, [group], product, inputs.facts);
  expect(JSON.stringify(inputs)).toBe(before);
});
