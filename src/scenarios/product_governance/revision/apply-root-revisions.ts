import type { Condition } from './conditions.ts';

type Row = Record<string, any>;
export interface RootRevisionStandard extends Row {
  definitions: Row[];
  categories: Array<Row & { id: string; name: string }>;
  bindings: Array<Row & { categoryId: string; attributeId: string; required: boolean; level: string }>;
  requirementGroups: Row[];
  crossFieldRules?: Row[];
  revisionRules?: Row;
  rootRevisionsApplied?: Row;
  openReviewQuestions?: Row[];
  statistics?: Row;
}
export interface RootRevisionChange {
  kind: string;
  id: string;
  reason: string;
  before: unknown;
  after: unknown;
}
export interface RootRevisionChanges {
  schema: string;
  authority: string;
  status: string;
  appliedChanges: RootRevisionChange[];
  migrations: Row[];
  summary: Row;
  verification: Row;
  pendingReview: Row[];
}

const PATCH = 'root-business-revisions-20261019-v1';
const TRIPLE = ['paper.quantity', 'paper.count_unit', 'paper.inner_unit'];
const IDS = {
  soft: 'fd7a6576-b4bb-4ef0-a273-9de18cf571a2',
  boxed: 'c7e8d056-d834-4432-95a2-981e6e20e640',
  wet: '433be34e-e1cc-4b5f-b955-df3d802ed2ec',
  roll: '9fda0128-630c-4756-b26f-248e8fdc3db5',
  center: '34f24759-db54-474a-9af5-2370c3b56e51',
  hand: 'a23fbc6e-8400-4e14-8043-632364402001',
  face: '69d8ff06-f670-4ca8-89e5-d6e1c497244f',
  kitchen: '15c851c5-7435-4843-8df6-4bd61dd3c1d5',
} as const;
const key = (row: Row): string => `${row.categoryId}:${row.attributeId}`;
const stable = (value: any): string => JSON.stringify(value, (_name, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);
const equal = (a: unknown, b: unknown): boolean => stable(a) === stable(b);
const fact = (name: string, equals = true): Condition => ({ fact: name, equals });
const addSentence = (row: Row, field: string, text: string): void => {
  if (!String(row[field] ?? '').includes(text)) row[field] = `${row[field] ?? ''}${row[field] ? ' ' : ''}${text}`;
};

/** Flatten and deduplicate only identical clauses; do not infer facts or rewrite unknown as false. */
function dedupeCondition(condition: Condition): Condition {
  if ('fact' in condition) return { fact: condition.fact, equals: condition.equals ?? true };
  const op = 'all' in condition ? 'all' : 'any';
  const source = op === 'all' ? (condition as { all: readonly Condition[] }).all : (condition as { any: readonly Condition[] }).any;
  if (!Array.isArray(source) || !source.length) throw new Error('Cannot deduplicate an empty condition.');
  const flat = source.flatMap(child => {
    const clean = dedupeCondition(child);
    return op in clean ? (clean as unknown as Record<string, Condition[]>)[op]! : [clean];
  });
  const seen = new Set<string>();
  const unique = flat.filter(child => { const signature = stable(child); if (seen.has(signature)) return false; seen.add(signature); return true; });
  return unique.length === 1 ? unique[0]! : op === 'all' ? { all: unique } : { any: unique };
}

/**
 * Apply root's explicit business decisions to a detached copy. This module performs no I/O,
 * does not freeze a release, and does not migrate or overwrite any product claims.
 */
export function applyRootRevisions<T extends RootRevisionStandard>(input: T): { s: T; changes: RootRevisionChanges } {
  const s = structuredClone(input);
  const reasons = new Map<string, string>();
  const migrations: Row[] = [];
  const getDef = (id: string): Row => {
    const d = s.definitions.find(row => row.id === id);
    if (!d) throw new Error(`Missing existing definition ${id}.`);
    return d;
  };
  const getBinding = (categoryId: string, attributeId: string): RootRevisionStandard['bindings'][number] => {
    const b = s.bindings.find(row => row.categoryId === categoryId && row.attributeId === attributeId);
    if (!b) throw new Error(`Missing binding ${categoryId}:${attributeId}.`);
    return b;
  };
  const updateDef = (id: string, reason: string, edit: (d: Row) => void): void => {
    const d = getDef(id), before = structuredClone(d);
    edit(d);
    if (!equal(before, d)) {
      d.version = (before.version ?? 0) + 1;
      addSentence(d, 'origin', PATCH + '；root业务裁定，待最终变化独立复核。');
      reasons.set(`definition:${id}`, reason);
    }
  };
  const upsertBinding = (categoryId: string, attributeId: string, values: Row, reason: string): void => {
    getDef(attributeId);
    const current = s.bindings.find(b => b.categoryId === categoryId && b.attributeId === attributeId);
    if (current) Object.assign(current, values);
    else s.bindings.push({ categoryId, attributeId, required: false, level: 'SKU', ...values });
    reasons.set(`binding:${categoryId}:${attributeId}`, reason);
  };
  const upsertGroup = (group: Row, reason: string): void => {
    const i = s.requirementGroups.findIndex(g => g.id === group.id);
    if (i < 0) s.requirementGroups.push(group); else s.requirementGroups[i] = { ...s.requirementGroups[i], ...group };
    reasons.set(`group:${group.id}`, reason);
  };

  if (s.categories.length !== 21 || new Set(s.categories.map(c => c.id)).size !== 21) throw new Error('Expected the fixed 21-category scope.');
  for (const id of Object.values(IDS)) if (!s.categories.some(c => c.id === id)) throw new Error(`Missing reviewed V2 category ${id}.`);

  const countCoherence = {
    sameSku: true, sameVersion: true, sameHomogeneousContent: true,
    sourceUnitAndDenominatorTogether: true, countUnitsInterchangeable: false,
    excludeGiftsBeforeDivision: true, explicitArithmeticRequired: true,
    finishedProductCountOnly: true, layerAccumulatedCountIsNotFinishedCount: true,
    noDefaultsFromLegacyAttributeId: true,
  };
  const countSpecs = [
    { categoryId: IDS.soft, categoryName: '软包抽纸', oldId: 'soft.draws', groupId: 'soft-count-measurement', units: ['抽', '张', '片'], innerUnits: ['包', '袋'] },
    { categoryId: IDS.boxed, categoryName: '盒装抽纸', oldId: 'boxed.draws', groupId: 'boxed-count-measurement', units: ['抽', '张', '片'], innerUnits: ['盒'] },
    { categoryId: IDS.wet, categoryName: '湿纸巾', oldId: 'wet.pieces', groupId: 'wet-count-measurement', units: ['片', '抽', '张', 'PCS'], innerUnits: ['袋', '包', '桶', '盒', '筒'] },
  ];
  updateDef('paper.quantity', '统一三类计数口径并保持成品数量、原计数单位及最内包装单位的核心完整约束。', d => {
    addSentence(d, 'rule', '软包/盒装抽纸及湿纸巾同样使用数量+原计数单位+最内包含层级三元组；张须指独立成品张，按层累计的张数或成品/层累计口径不明时不能作为成品张，不用层数乘除猜算。包装单位须有当前SKU正面证据；固定旧字段名称和类目不能代替计数单位或包装层级证据。');
    d.quantity = { ...d.quantity, unitField: 'paper.count_unit', perField: 'paper.inner_unit', completeTripleRequired: true, finishedProductCountRequired: true };
  });
  updateDef('paper.inner_unit', '用最内包含层级保存湿巾等真实桶/筒/袋/包/盒口径，销售箱/提不能代替直接内包装。', d => {
    addSentence(d, 'rule', '软包抽纸限有证据的包/袋，盒装抽纸限直接内包装盒；湿纸巾可按有证据的袋/包/桶/盒/筒，须确认最内实际包含成品的层级。外套桶内另有独立小袋时不能直接把外桶当最内层；类目名和旧字段名不构成此正证。');
  });
  for (const spec of countSpecs) {
    const reason = `${spec.categoryName}计数核心从固定抽/片字段迁为原证据数量、计数单位、最内包装单位完整三元组；不作抽张片换算，不以缺数据降低要求。`;
    const oldBinding = s.bindings.find(b => b.categoryId === spec.categoryId && b.attributeId === spec.oldId);
    if (oldBinding && oldBinding.required !== true) throw new Error(`Reviewed legacy count core is no longer required: ${spec.oldId}.`);
    s.bindings = s.bindings.filter(b => !(b.categoryId === spec.categoryId && b.attributeId === spec.oldId));
    reasons.set(`binding:${spec.categoryId}:${spec.oldId}`, reason);
    updateDef(spec.oldId, reason, d => {
      d.deprecated = true;
      d.retirement = { release: PATCH, scope: 'new_revision_bindings_only', replacementAttributeIds: [...TRIPLE], historicalDefinitionRetained: true, noAutomaticClaimMigration: true };
    });
    for (const attributeId of TRIPLE) {
      const values: Row = {
        required: true, level: 'SKU', requirednessMode: 'measurement_group', requirementGroupId: spec.groupId,
        applicability: '当前SKU已按V2相邻边界确认归属本类；计数核心始终需证，不以已有来源是否填写计数来决定是否适用。',
        rationale: reason,
        requirednessMeaning: '三个字段一起构成一个必填计数核心，任一缺证/冲突/候选均不能把计数组认作完整。',
        evidenceCoherence: countCoherence,
      };
      if (attributeId === 'paper.count_unit') values.allowedValues = spec.units;
      if (attributeId === 'paper.inner_unit') values.allowedValues = spec.innerUnits;
      upsertBinding(spec.categoryId, attributeId, values, reason);
      const b = getBinding(spec.categoryId, attributeId);
      // These are mandatory category cores, not evidence-availability-triggered alternatives.
      delete b.applicabilityCondition; delete b.applicabilityRule; delete b.requiredWhen;
    }
    upsertGroup({
      id: spec.groupId, categoryId: spec.categoryId, groupKind: 'count_measurement', requirednessMode: 'measurement_group',
      when: '已确认归属本类的当前SKU', atLeastOne: [[...TRIPLE]],
      paths: [{ id: `${spec.groupId}-source-count`, attributes: [...TRIPLE], evidenceCoherence: countCoherence }],
      reason, completionContract: '当前归属已确认且数量、计数单位、最内包装单位均为同SKU同版本同口径有效filled才完成；不能省略计量核心或从旧字段名补单位。',
    }, reason);
    migrations.push({
      id: `${spec.oldId}-to-count-triple`, kind: 'evidence_gated_claim_migration', categoryId: spec.categoryId, categoryName: spec.categoryName,
      fromAttributeId: spec.oldId, toAttributeIds: [...TRIPLE], oldBindingRetired: true, oldDefinitionRetained: true,
      allowedCountUnits: spec.units, allowedInnerUnits: spec.innerUnits,
      preconditions: ['同一当前SKU、所选型号及版本；不存在未裁定数值/层级冲突', '原文或独立视觉证据明确数量及原始计数单位', '正证确认数量所对应最内包含层级及单位', '张代表独立成品；非层累计或口径不明的张', '派生数量另具同规格总量/分母、赠品排除及明确算式'],
      migrateTogether: true, keepOriginalValueUnitQuoteAndStatus: true, legacyUnitNameIsNotEvidence: true,
      onInsufficientEvidence: '保留旧值与原证据作迁移候选；新缺失槽位needs_evidence，真实冲突仍conflict，不由旧抽/片字段名生成默认单位或包装层级。',
      automaticProductRewrite: false,
    });
  }

  const foldReason = '核心要求是有证据的折叠信息；明确几何折型或厂商折法原称至少一路完整。三折原称不等于Z/N折、折线数或设备互换适配。';
  updateDef('hand.fold_original', foldReason, d => {
    d.rule = '保留当前SKU厂家/销售资料直接明示的折法原称，如三折；不是仅因为几何折型缺失就生成名称。不能把三折自动变为Z折、N折、三次折叠、三面或三张纸。明确原称可完成折叠信息OR组的原称路径，但不表示hand.fold几何分类已知，更不证明与任何设备互换兼容；兼容仍需独立当前SKU证据。无明确原称时留needs_evidence，不用未知/其他占位。';
  });
  updateDef('hand.fold', foldReason, d => { addSentence(d, 'rule', '与hand.fold_original共同构成折叠信息OR组；只完成原称路径不使本几何字段变filled，不推出设备可互换。'); });
  for (const id of ['hand.fold', 'hand.fold_original']) {
    const b = getBinding(IDS.hand, id);
    b.requirednessMode = 'measurement_group'; b.requirementGroupId = 'hand-fold-information';
    b.rationale = foldReason;
    b.requirednessMeaning = '组级折叠信息仍核心必填：明确几何折型或明确厂家原称至少一路有效filled；另一字段未知保留待补但不重复阻断已完成路径。';
    reasons.set(`binding:${IDS.hand}:${id}`, foldReason);
  }
  upsertGroup({
    id: 'hand-fold-information', categoryId: IDS.hand, groupKind: 'fold_information', requirednessMode: 'measurement_group',
    when: '已确认属于抽式干擦手纸的当前SKU', atLeastOne: [['hand.fold'], ['hand.fold_original']],
    paths: [
      { id: 'hand-fold-information-geometry', attributes: ['hand.fold'], evidenceCoherence: { sameSku: true, sameVersion: true, explicitGeometryEvidence: true } },
      { id: 'hand-fold-information-original-name', attributes: ['hand.fold_original'], evidenceCoherence: { sameSku: true, sameVersion: true, explicitManufacturerDesignation: true, noGeometryInference: true, noEquipmentCompatibilityInference: true } },
    ],
    reason: foldReason, completionContract: '至少一个有直接证据的折叠信息路径完整；原称路径不补几何字段，也不声明设备兼容。几何未知本身不是生成原称的依据。',
  }, foldReason);
  migrations.push({ id: 'fold-original-to-alternative-path', kind: 'evidence_gated_claim_migration', categoryId: IDS.hand,
    fromAttributeId: 'hand.fold', toAttributeIds: ['hand.fold', 'hand.fold_original'],
    preconditions: ['厂家或当前SKU销售资料直接给出折法原称', '引用准确原文，保留旧候选值及证据'],
    action: '三折等原称可原样存hand.fold_original；几何字段仍按自身证据判定。已有有效几何值可保留，不以原称替换它。',
    noAutomaticGeometryMapping: true, noEquipmentInterchangeabilityClaim: true, noFabricationFromMissingGeometry: true, automaticProductRewrite: false });

  for (const id of ['roll.width', 'roll.dispense']) upsertBinding(IDS.roll, id, {
    required: false, level: 'SKU', applicability: '已按V2用途和实物小卷/纸芯证据确认属于本类的当前SKU。',
    rationale: id === 'roll.width' ? '有明确纸幅宽度时补充筛选比较，不把外径或包装宽度当纸宽。' : '可补充明确中心/外圈取纸路径，有芯结构本身不证明路径。',
  }, '有芯小卷纸复用已有可选纸幅宽度及取纸路径定义，不增加必填。');
  upsertBinding(IDS.center, 'roll.section_size', {
    required: false, level: 'SKU', applicability: '已确认中心抽大卷纸且有明确预制分节证据；明确不分节才不适用，分节未知待补。',
    applicabilityCondition: fact('hasExplicitPerforation'), rationale: '有分节证据时可补单节展开尺寸；不替代该类独立核心单卷长度。',
  }, '中心抽大卷纸补可选分节尺寸；保留长度独立核心。');

  const lengthReason = '卷式商品无论是否分节，只要有可靠单卷长度均可作为容量OR路径；分节计数和卷长是可替代的量，不以分节事实排除明确卷长，也不追加节数必填。';
  for (const categoryId of [IDS.face, IDS.kitchen]) {
    const g = s.requirementGroups.find(group => group.categoryId === categoryId && group.paths?.some((p: Row) => p.attributes?.includes('roll.length')));
    if (!g) throw new Error(`Missing approved roll-length OR group for ${categoryId}.`);
    for (const p of g.paths) if (p.attributes.includes('roll.length')) {
      p.applicabilityCondition = fact('isRollFormat');
      p.reason = lengthReason;
    }
    g.reason = lengthReason;
    reasons.set(`group:${g.id}`, lengthReason);
    const b = getBinding(categoryId, 'roll.length');
    b.applicabilityCondition = fact('isRollFormat');
    b.applicability = '明确卷式的当前SKU均可按可靠单卷长度形成计量路径；是否分节不限制此路径。非卷式明确不适用，卷式未知仍待补。';
    b.rationale = lengthReason;
    if (b.applicabilityRule) { b.legacyApplicabilityRule = structuredClone(b.applicabilityRule); delete b.applicabilityRule; }
    reasons.set(`binding:${categoryId}:roll.length`, lengthReason);
  }
  upsertBinding(IDS.face, 'roll.perforated', {
    required: false, level: 'SKU', applicability: '当前SKU明确卷式才适用；非卷式有明确反证才不适用，卷式未知待补。',
    applicabilityCondition: fact('isRollFormat'), rationale: '复用是否预制分节定义保存正/反证；未提节数不当作不分节，不约束长度OR路径。',
  }, '洗脸巾补可选卷式分节事实，不强加节数必填。');

  updateDef('common.color', '公共本体颜色语义覆盖所有纸/巾及器具；不靠包装图案推本体，也不因字段对称性给湿巾加颜色绑定。', d => {
    d.definition = '当前SKU纸、巾等耗材本体的明确颜色，或纸巾盒、配件等器具本体的明确颜色；颜色的对象是商品本体，不是外包装。';
    addSentence(d, 'rule', '干纸、湿巾、干巾本体颜色均按实际本体证据理解；包装底色、包装图案、系列视觉及用途不代替本体颜色，未知不默认白色。是否绑定仍由类目实际业务决定，不为对称给湿纸巾强加本体颜色。');
  });
  updateDef('paper.dispense', 'paper.dispense与roll.dispense是宽/窄取出方式的互斥类目投影；卷路径值共用语义，本轮不大迁移稳定ID。', d => {
    d.projection = { family: 'dispense_method', scope: 'paper_or_wipe', exclusiveWith: 'roll.dispense', sharedValueSemantics: ['中心抽取', '外圈拉取'], noSameCategoryDoubleBinding: true, futureIdUnificationRequiresMigration: true };
    addSentence(d, 'rule', '与roll.dispense为宽/窄取出方式的互斥类目投影：中心抽取/外圈拉取含义相同，同一类目不能重复绑定两字段。本轮保留稳定ID，后续统一ID须显式迁移；抽取式（路径未注明）不冒充具体卷路径。');
  });
  updateDef('roll.dispense', 'paper.dispense与roll.dispense是宽/窄取出方式的互斥类目投影；不得把有芯或卷形当路径证据。', d => {
    d.projection = { family: 'dispense_method', scope: 'roll_only', exclusiveWith: 'paper.dispense', sharedValueSemantics: ['中心抽取', '外圈拉取'], noSameCategoryDoubleBinding: true, futureIdUnificationRequiresMigration: true };
    addSentence(d, 'rule', '与paper.dispense的中心抽取/外圈拉取语义一致；同一类目只绑定一个投影字段，不制造两份重复义务。本轮不自动跨ID复制商品值。');
  });

  for (const b of s.bindings) for (const field of ['applicabilityCondition', 'requiredWhen']) if (b[field]) {
    const before = b[field]; b[field] = dedupeCondition(before);
    if (!equal(before, b[field]) && !reasons.has(`binding:${key(b)}`)) reasons.set(`binding:${key(b)}`, '展开同种all/any并去除相同子条件；三值真值不变，未知不变可选或不适用。');
  }
  for (const g of s.requirementGroups) {
    if (g.applicabilityCondition) g.applicabilityCondition = dedupeCondition(g.applicabilityCondition);
    for (const p of g.paths ?? []) if (p.applicabilityCondition) p.applicabilityCondition = dedupeCondition(p.applicabilityCondition);
  }
  const consistencyRule = {
    id: 'form-dispense-consistency-v1', categoryIds: [IDS.face, IDS.kitchen],
    formAttributes: ['face.form', 'kitchen.form'], dispenseAttribute: 'paper.dispense',
    forbiddenPairs: [{ form: '平叠单张式', dispense: ['中心抽取', '外圈拉取'] }, { form: '卷式', dispense: ['平叠揭取'] }],
    action: 'conflict', implementation: 'revision/semantic-guards.ts#validateFormConsistency',
    evidencePolicy: '逐字段仍须当前SKU证据；相互矛盾不能因独立字段均有引文就通过。泛抽取不反推卷/平叠或具体路线，卷式+逐张抽取不一概排除，干湿不从形态推断。',
  };
  if (!Array.isArray(s.crossFieldRules)) s.crossFieldRules = [];
  const ruleIndex = s.crossFieldRules.findIndex((r: Row) => r.id === consistencyRule.id);
  if (ruleIndex < 0) s.crossFieldRules.push(consistencyRule); else s.crossFieldRules[ruleIndex] = consistencyRule;
  s.revisionRules = { ...s.revisionRules,
    countTripleMigration: '三类固定抽/片数绑定退役，迁移数量、原计数单位、最内包含层级必须整组有证据；不凭旧字段名补单位，不用层数换算成品张。',
    foldInformation: foldReason, rollLengthAlternative: lengthReason,
    dispenseProjection: 'paper.dispense/roll.dispense宽窄类目互斥投影，卷路径语义相同；同类不重复绑定，后续统一ID须保留原证据迁移。',
  };
  s.rootRevisionsApplied = { patch: PATCH, status: 'pending-focused-independent-review', draftSnapshotUnchanged: true, productClaimsRewritten: false, operationsReview: 'not_reviewed' };
  if (Array.isArray(s.openReviewQuestions)) s.openReviewQuestions = s.openReviewQuestions.map((q: Row) => q.id === 'RQ-FOLD-01' ? { ...q, status: 'root_decided_pending_focused_review', rootDecision: foldReason } : q);
  s.statistics = { ...s.statistics,
    definitions: s.definitions.length, activeDefinitions: s.definitions.filter(d => !d.deprecated).length,
    historicalRetiredDefinitions: s.definitions.filter(d => d.deprecated).length,
    bindings: s.bindings.length, requiredBindings: s.bindings.filter(b => b.required).length, requirementGroups: s.requirementGroups.length,
    categoryCounts: s.categories.map(c => { const bs = s.bindings.filter(b => b.categoryId === c.id); c.attributeCount = bs.length; return { categoryId: c.id, name: c.name, attributes: bs.length, requiredBindings: bs.filter(b => b.required).length }; }),
  };

  const failures: string[] = [];
  const boundaries = (standard: RootRevisionStandard): unknown => standard.categories.map(c => [c.id, c.path, c.parentId, c.boundary]);
  if (!equal(boundaries(input), boundaries(s))) failures.push('V2 category identity/path/boundary changed.');
  if (new Set(s.definitions.map(d => d.id)).size !== s.definitions.length) failures.push('Duplicate definition ID.');
  if (new Set(s.bindings.map(key)).size !== s.bindings.length) failures.push('Duplicate category attribute binding.');
  for (const b of s.bindings) {
    const d = getDef(b.attributeId);
    if (!s.categories.some(c => c.id === b.categoryId)) failures.push(`Dangling category ${key(b)}.`);
    if (b.allowedValues?.some((v: string) => !d.enum?.includes(v))) failures.push(`Allowed values outside shared enum ${key(b)}.`);
  }
  for (const g of s.requirementGroups) {
    if (!equal(g.paths?.map((p: Row) => p.attributes), g.atLeastOne)) failures.push(`Group path projections differ ${g.id}.`);
    for (const p of g.paths ?? []) for (const id of p.attributes) {
      const b = getBinding(g.categoryId, id);
      if (b.requirednessMode !== 'measurement_group' || b.requirementGroupId !== g.id) failures.push(`Missing group membership ${g.id}:${id}.`);
    }
  }
  for (const c of s.categories) if (s.bindings.some(b => b.categoryId === c.id && b.attributeId === 'paper.dispense') && s.bindings.some(b => b.categoryId === c.id && b.attributeId === 'roll.dispense')) failures.push(`Duplicate dispense projections ${c.id}.`);
  for (const b of input.bindings.filter(b => b.attributeId === 'roll.net_paper_mass')) if (!equal(b, getBinding(b.categoryId, b.attributeId))) failures.push(`Strict net-paper-mass binding changed ${key(b)}.`);
  if (!equal(getBinding(IDS.center, 'roll.length'), input.bindings.find(b => b.categoryId === IDS.center && b.attributeId === 'roll.length'))) failures.push('Independent center-roll length core changed.');
  if (s.bindings.some(b => b.categoryId === IDS.wet && b.attributeId === 'common.color') !== input.bindings.some(b => b.categoryId === IDS.wet && b.attributeId === 'common.color')) failures.push('Unapproved wet color binding change.');
  if (failures.length) throw new Error(failures.join('\n'));

  const appliedChanges: RootRevisionChange[] = [];
  const diffRows = (kind: string, before: Row[], after: Row[], identify: (row: Row) => string): void => {
    const old = new Map(before.map(row => [identify(row), row])), next = new Map(after.map(row => [identify(row), row]));
    for (const id of new Set([...old.keys(), ...next.keys()])) if (!equal(old.get(id), next.get(id))) appliedChanges.push({
      kind: `${kind}_${!old.has(id) ? 'added' : !next.has(id) ? 'retired' : 'revised'}`, id,
      reason: reasons.get(`${kind}:${id}`) ?? '根裁定的等价条件去重与完整性元数据同步；不改变业务适用真值。',
      before: structuredClone(old.get(id) ?? null), after: structuredClone(next.get(id) ?? null),
    });
  };
  diffRows('definition', input.definitions, s.definitions, d => d.id);
  diffRows('binding', input.bindings, s.bindings, key);
  diffRows('group', input.requirementGroups, s.requirementGroups, g => g.id);
  for (const field of ['crossFieldRules', 'revisionRules', 'openReviewQuestions', 'rootRevisionsApplied', 'statistics']) if (!equal(input[field], s[field])) appliedChanges.push({ kind: 'contract_revised', id: field, reason: '记录根裁定、语义guard契约、待独立复核状态及绑定基数；不冻结发布。', before: structuredClone(input[field] ?? null), after: structuredClone(s[field]) });
  return { s, changes: {
    schema: 'product-governance-root-revision-changes-v1', authority: 'root explicit adjudication in this task', status: 'applied-in-memory-pending-focused-independent-review',
    appliedChanges, migrations,
    summary: { categories: s.categories.length, definitionsBefore: input.definitions.length, definitionsAfter: s.definitions.length, historicalDefinitionsRetained: true, bindingsBefore: input.bindings.length, bindingsAfter: s.bindings.length, groupsBefore: input.requirementGroups.length, groupsAfter: s.requirementGroups.length, changedRows: appliedChanges.length, oldFrozenStandardModified: false, productClaimsRewritten: false },
    verification: { passed: true, failures, fixedV2ScopePreserved: true, netPaperCoreUnchanged: true, centerLengthCoreUnchanged: true, groupPathAndBindingsCoherent: true, noDuplicateDispenseProjections: true, inputNotMutated: true },
    pendingReview: [
      { id: 'FINAL-COUNT-TRIPLE', categoryIds: [IDS.soft, IDS.boxed, IDS.wet], reason: '业务口径改变：原单位及最内层级正证迁移、成品张与层累计张不可互推。', modelReviewRequiredByRoot: true },
      { id: 'FINAL-FOLD-OR', categoryIds: [IDS.hand], reason: '业务口径改变：几何折型或厂商原称均可提供核心折叠信息，原称不证明几何/设备兼容。', modelReviewRequiredByRoot: true },
      { id: 'FINAL-ROLL-LENGTH', categoryIds: [IDS.face, IDS.kitchen], reason: '卷式无论是否分节均可用可靠单卷长度形成容量OR路径，不降低其他独立核心。', modelReviewRequiredByRoot: true },
    ],
  } };
}
