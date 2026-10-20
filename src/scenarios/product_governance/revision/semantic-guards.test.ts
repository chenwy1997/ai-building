import { expect, test } from 'bun:test';
import { validateFormConsistency, validateMassBasis, validateNominalMass, validateRevisionRecord, type RevisionClaim, type RevisionDefinition, type RevisionRecord, type RevisionStandard } from './semantic-guards.ts';

const nominal: RevisionDefinition = {
  id: 'paper.nominal_mass', name: '标称质量（展示用）', type: '数值', unit: '按原证据质量单位', semantic: 'nominal_mass_display', operator: 'positive_declared_mass_with_scope',
  measurement: { kind: 'nominal_mass', displayOnly: true, allowedUnits: ['g', '克', 'kg', '千克', '公斤', '斤', '市斤'], weightScopeEnum: ['per_roll', 'per_piece', 'per_inner_pack', 'sales_unit', 'unspecified'], perUnitsByScope: { per_roll: ['卷'], per_piece: ['张', '片', '节', '段', '条', '件'], per_inner_pack: ['包', '袋', '盒', '筒', '桶', '提', '箱'], sales_unit: ['包', '袋', '盒', '卷', '筒', '桶', '提', '箱', '件', '套'], unspecified: [] }, basisField: 'paper.mass_basis' },
};
const basis: RevisionDefinition = { id: 'paper.mass_basis', name: '标称质量口径', type: '选项', selection: '单选', enum: ['本体净质量（不含芯及包装）', '含芯净质量（不含包装）', '含包装质量（毛重）'], measurement: { nominalField: 'paper.nominal_mass', sameDeclarationRequired: true } };
const face: RevisionDefinition = { id: 'face.form', name: '巾体组织形态', type: '选项', enum: ['卷式', '平叠单张式'], selection: '单选' };
const dispense: RevisionDefinition = { id: 'paper.dispense', name: '取纸方式', type: '选项', enum: ['逐张抽取', '平叠揭取', '中心抽取', '外圈拉取', '抽取式（路径未注明）'], selection: '单选' };
const net: RevisionDefinition = { id: 'roll.net_paper_mass', name: '单卷净纸重', type: '数值', unit: 'g/卷', operator: 'positive_mass_excluding_core_and_packaging' };
const standard: RevisionStandard = { definitions: [nominal, basis, face, dispense, net], bindings: [nominal, basis, face, dispense, net].map(d => ({ attributeId: d.id!, categoryId: 'cat', required: false })) };
const row = (text: string, fields: RevisionRecord['fields'] = {}): RevisionRecord => ({ id: 'sku', categoryId: 'cat', category: { status: 'matched', targetId: 'cat', targetName: '测试类', targetPath: '父类>测试类', targetConfirmed: true }, evidence: [{ id: 'T', productId: 'sku', kind: 'title', text }], fields });
const claim = (value: unknown, quote: string, extra: Partial<RevisionClaim> = {}): RevisionClaim => ({ value, status: 'filled', evidenceId: 'T', quote, ...extra });
const mass = (value: unknown, quote: string, extra: Partial<RevisionClaim> = {}): RevisionClaim => claim(value, quote, { unit: 'g', weightScope: 'unspecified', ...extra });
const codes = (issues: Array<{ code: string }>): string[] => issues.map(i => i.code);
const triad: RevisionStandard = {
  definitions: [
    { id: 'paper.quantity', name: '单内包装计数值', type: '数值', semantic: 'quantity', operator: 'positive_integer_with_count_and_container_unit', unit: '见计数单位/内包装单位', quantity: { unitField: 'paper.count_unit', perField: 'paper.inner_unit' }, dependencies: ['paper.count_unit', 'paper.inner_unit'] },
    { id: 'paper.count_unit', name: '计数单位', type: '选项', enum: ['抽', '张', '片', '层', '层张'], selection: '单选' },
    { id: 'paper.inner_unit', name: '内包装单位', type: '选项', enum: ['包', '盒', '卷'], selection: '单选' },
  ],
  bindings: [
    { attributeId: 'paper.quantity', categoryId: 'cat', required: true },
    { attributeId: 'paper.count_unit', categoryId: 'cat', required: true, allowedValues: ['抽', '张', '片'] },
    { attributeId: 'paper.inner_unit', categoryId: 'cat', required: true, allowedValues: ['包', '盒'] },
  ],
};
const triadFields = (quote = '80抽/包', unit = '抽', per = '包'): RevisionRecord['fields'] => ({ 'paper.quantity': claim(80, quote, { unit: `${unit}/${per}`, per }), 'paper.count_unit': claim(unit, quote), 'paper.inner_unit': claim(per, quote) });

test('标称质量原数原单位和未知范围可保留，新数值不触发旧未注册unit误报', () => {
  const p = row('标称100g。', { 'paper.nominal_mass': mass(100, '100g') });
  expect(validateNominalMass(nominal, p.fields['paper.nominal_mass']!, p)).toEqual([]);
  const result = validateRevisionRecord(p, standard);
  expect(result.issues).toEqual([]); expect(result.passesPrecheck).toBe(true);
  expect(codes(result.issues)).not.toContain('QUANTITY_UNIT_UNDEFINED'); expect(codes(result.issues)).not.toContain('QUANTITY_UNIT_OR_VALUE_MISSING');
});

test('只有数字、输出补单位、同义单位替换或错误数值不能当原始质量对', () => {
  for (const [text, value, unit] of [['规格100', 100, 'g'], ['100克', 100, 'g'], ['100g', 120, 'g'], ['0.5kg', 500, 'g']] as const) {
    const p = row(text), c = mass(value, text, { unit });
    expect(codes(validateNominalMass(nominal, c, p))).toContain('NOMINAL_MASS_SOURCE_PAIR_MISSING');
  }
  const absent = row('100g');
  expect(codes(validateNominalMass(nominal, mass(100, '100g', { unit: null }), absent))).toContain('NOMINAL_MASS_UNIT_REQUIRED');
});

test('正数和状态结构严格，未知/冲突正式值不能残留', () => {
  for (const value of ['100', 0, -1, NaN, Infinity]) expect(codes(validateNominalMass(nominal, mass(value, '100g'), row('100g')))).toContain('POSITIVE_NUMBER_REQUIRED');
  expect(codes(validateNominalMass(nominal, mass(100, '100g', { status: 'conflict' }), row('100g')))).toContain('UNRESOLVED_VALUE_PRESENT');
  expect(validateNominalMass(nominal, mass(null, '', { status: 'needs_evidence' }), row('100g'))).toEqual([]);
  expect(codes(validateNominalMass(nominal, mass(100, '100g', { status: 'verified' }), row('100g')))).toContain('STATUS_UNKNOWN');
});

test('g/㎡、g/m²、g/m2和gsm均不能截为g质量', () => {
  for (const text of ['80g/㎡', '80g/m²', '80g/m2', '80gsm', '80克/平方米']) {
    expect(codes(validateNominalMass(nominal, mass(80, text), row(text)))).toContain('AREAL_MASS_IS_NOT_MASS');
  }
  const p = row('80g/㎡');
  expect(codes(validateNominalMass(nominal, mass(80, '80g/㎡', { unit: 'g/㎡' }), p))).toContain('AREAL_MASS_IS_NOT_MASS');
});

test('裸g的克重疑义送review，不猜面积单位或硬判成净纸重', () => {
  const p = row('克重75g');
  const issues = validateNominalMass(nominal, mass(75, '克重75g'), p);
  expect(codes(issues)).toContain('MASS_OR_GRAMMAGE_REQUIRES_REVIEW');
  expect(issues.every(i => i.severity === 'review')).toBe(true);
});

test('约数、上下限及增量保留限定语义送review，不冒充精确绝对质量', () => {
  for (const text of ['约100g', '至少100g', '不超过100g', '100g±5g', '净增100g']) {
    const issues = validateNominalMass(nominal, mass(100, text), row(text));
    expect(codes(issues)).toContain('NOMINAL_MASS_QUALIFIED_AMOUNT_REQUIRES_REVIEW'); expect(issues.every(i => i.severity === 'review')).toBe(true);
  }
});

test('scope和per必须分开，unspecified不能补每卷，范围与单位不相容拦截', () => {
  const p = row('100g');
  expect(codes(validateNominalMass(nominal, mass(100, '100g', { per: '卷' }), p))).toContain('NOMINAL_MASS_UNSPECIFIED_HAS_PER');
  expect(codes(validateNominalMass(nominal, mass(100, '100g', { weightScope: 'per_roll' }), p))).toContain('NOMINAL_MASS_PER_REQUIRED');
  expect(codes(validateNominalMass(nominal, mass(100, '100g', { weightScope: 'per_roll', per: '包' }), p))).toContain('NOMINAL_MASS_PER_INVALID');
  expect(codes(validateNominalMass(nominal, mass(100, '100g', { weightScope: null }), p))).toContain('NOMINAL_MASS_SCOPE_REQUIRED');
});

test('每卷/单件明确可核，销售总质量或裸质量不能自动变每卷', () => {
  for (const text of ['每卷100g', '单卷净重100g', '100g/卷']) {
    expect(validateNominalMass(nominal, mass(100, text, { weightScope: 'per_roll', per: '卷' }), row(text))).toEqual([]);
  }
  expect(validateNominalMass(nominal, mass(20, '每片20g', { weightScope: 'per_piece', per: '片' }), row('每片20g'))).toEqual([]);
  for (const text of ['整提500g', '100g']) {
    const issues = validateNominalMass(nominal, mass(text.includes('500') ? 500 : 100, text, { weightScope: 'per_roll', per: '卷' }), row(text));
    expect(codes(issues)).toContain('NOMINAL_MASS_SCOPE_REQUIRES_REVIEW'); expect(issues.every(i => i.severity === 'review')).toBe(true);
  }
});

test('销售单元质量允许真实当前销售声明，未明确对象仍review', () => {
  expect(validateNominalMass(nominal, mass(2, '本SKU总重2kg', { unit: 'kg', weightScope: 'sales_unit' }), row('本SKU总重2kg'))).toEqual([]);
  expect(validateNominalMass(nominal, mass(2, '整提总重2kg', { unit: 'kg', weightScope: 'sales_unit', per: '提' }), row('整提总重2kg'))).toEqual([]);
  expect(codes(validateNominalMass(nominal, mass(2, '总重2kg', { unit: 'kg', weightScope: 'sales_unit' }), row('总重2kg')))).toContain('NOMINAL_MASS_SCOPE_REQUIRES_REVIEW');
});

test('每包不自动确定最内包装；明确内包装或独立来源scope可提供层级', () => {
  const loose = mass(100, '每包100g', { weightScope: 'per_inner_pack', per: '包' });
  expect(codes(validateNominalMass(nominal, loose, row('每包100g')))).toContain('NOMINAL_MASS_INNER_SCOPE_REQUIRES_REVIEW');
  const text = '单个内包装每包100g';
  expect(validateNominalMass(nominal, mass(100, text, { weightScope: 'per_inner_pack', per: '包' }), row(text))).toEqual([]);
  const p = row('每包100g');p.evidence[0]!.scope = 'inner-pack';
  expect(validateNominalMass(nominal, loose, p)).toEqual([]);
});

test('独立declarationEvidence可补充同一原质量对的范围，假引用不能授权', () => {
  const text = '单卷净重100g';
  const c = mass(100, '100g', { weightScope: 'per_roll', per: '卷', declarationEvidence: { evidenceId: 'T', quote: text } });
  expect(validateNominalMass(nominal, c, row(text))).toEqual([]);
  const bad = validateNominalMass(nominal, { ...c, declarationEvidence: { evidenceId: 'T', quote: '每卷100g不含包装' } }, row(text));
  expect(codes(bad)).toContain('QUOTE_NOT_EXACT');
});

test('scope不能跨过另一个质量数字，避免拿每卷前缀套整提总量', () => {
  const text = '每卷100g整提500g';
  const issues = validateNominalMass(nominal, mass(500, text, { weightScope: 'per_roll', per: '卷' }), row(text));
  expect(codes(issues)).toContain('NOMINAL_MASS_SCOPE_REQUIRES_REVIEW');
});

test('转换必须保留原数原单位和明确当前SKU等式，合法转换仍送Codex核范围', () => {
  const p = row('每卷0.5kg；0.5kg=500g。');
  const converted = mass(500, '每卷0.5kg', { unit: 'g', originalValue: 0.5, originalUnit: 'kg', weightScope: 'per_roll', per: '卷', calculation: { operation: 'convert', formula: '0.5×1000=500', inputs: [{ value: 0.5, unit: 'kg', scope: 'per_roll', evidenceId: 'T', quote: '每卷0.5kg' }], factor: 1000, conversionEvidence: { evidenceId: 'T', quote: '0.5kg=500g' }, outputUnit: 'g' } });
  const issues = validateNominalMass(nominal, converted, p);
  expect(codes(issues)).toEqual(['NOMINAL_MASS_CONVERSION_REQUIRES_REVIEW']);
  expect(issues[0]?.severity).toBe('review');
  const missing = validateNominalMass(nominal, { ...converted, calculation: null }, p);
  expect(codes(missing)).toContain('NOMINAL_MASS_CONVERSION_TRACE_REQUIRED');
  const wrong = validateNominalMass(nominal, { ...converted, calculation: { ...converted.calculation!, factor: 2 } }, p);
  expect(codes(wrong)).toContain('NOMINAL_MASS_CONVERSION_ARITHMETIC'); expect(codes(wrong)).toContain('NOMINAL_MASS_CONVERSION_FACTOR');
  const formula = validateNominalMass(nominal, { ...converted, calculation: { ...converted.calculation!, formula: '0.5×2=500', outputUnit: 'kg' } }, p);
  expect(codes(formula)).toContain('NOMINAL_MASS_CONVERSION_FORMULA'); expect(codes(formula)).toContain('NOMINAL_MASS_CONVERSION_OUTPUT_UNIT');
});

test('质量原单位候选不默改，模型自称视觉已核或外SKU都无效', () => {
  const p = row('100G');
  expect(codes(validateNominalMass(nominal, mass(100, '100G', { unit: 'G' }), p))).toContain('NOMINAL_MASS_UNIT_CANDIDATE');
  const external = { ...row('100g'), evidence: [{ id: 'T', productId: 'other', text: '100g' }] };
  expect(codes(validateNominalMass(nominal, mass(100, '100g'), external))).toContain('EVIDENCE_WRONG_SKU');
  const image = { ...row('100g'), evidence: [{ id: 'T', productId: 'sku', kind: 'image_verified', text: '100g' }] };
  expect(codes(validateNominalMass(nominal, mass(100, '100g'), image))).toContain('VISUAL_VERIFICATION_NOT_REGISTERED');
  expect(validateNominalMass(nominal, mass(100, '100g'), image, { verifiedVisualEvidenceIds: ['T'] })).toEqual([]);
});

test('质量口径关联同一完整声明并分别证明芯与包装范围', () => {
  for (const [text, value] of [
    ['每卷100g，不含纸芯及包装', '本体净质量（不含芯及包装）'],
    ['每卷100g，含纸芯，不含包装', '含芯净质量（不含包装）'],
    ['每卷100g，含包装毛重', '含包装质量（毛重）'],
    ['每卷100g，不包含包装和纸芯', '本体净质量（不含芯及包装）'],
  ]) {
    const n = mass(100, text!), b = claim(value, text!);
    expect(validateMassBasis(basis, b, n, row(text!))).toEqual([]);
  }
});

test('仅净重或毛重不能默认填完整口径，未知应留待补', () => {
  for (const [text, value] of [['每卷净重100g', '本体净质量（不含芯及包装）'], ['每卷毛重100g', '含包装质量（毛重）'], ['每卷100g不含纸芯', '本体净质量（不含芯及包装）']]) {
    const issues = validateMassBasis(basis, claim(value, text!), mass(100, text!), row(text!));
    expect(codes(issues)).toContain('MASS_BASIS_COMPOSITION_REQUIRES_REVIEW'); expect(issues.every(i => i.severity === 'review')).toBe(true);
  }
  expect(validateMassBasis(basis, { value: null, status: 'needs_evidence' }, mass(100, '100g'), row('100g'))).toEqual([]);
});

test('同证据ID和自造声明ID不足，多质量长段须具体关联而非随意套口径', () => {
  const text = '单卷100g；整提500g，含包装。';
  const n = mass(100, '单卷100g');
  const b = { ...claim('含包装质量（毛重）', '含包装'), declarationId: 'same' };
  expect(codes(validateMassBasis(basis, b, n, row(text)))).toContain('MASS_BASIS_DECLARATION_LINK_REQUIRES_REVIEW');
  expect(codes(validateMassBasis(basis, { ...b, declarationEvidence: { evidenceId: 'T', quote: text } }, n, row(text)))).toContain('MASS_BASIS_DECLARATION_LINK_REQUIRES_REVIEW');
  expect(codes(validateMassBasis(basis, b, undefined, row(text)))).toContain('MASS_BASIS_WITHOUT_NOMINAL_DECLARATION');
});

test('精确声明关联可审证，不能用非法declarationEvidence伪造链接', () => {
  const text = '单卷100g（不含纸芯及包装）';
  const n = mass(100, '100g');
  const b = claim('本体净质量（不含芯及包装）', '不含纸芯及包装', { declarationEvidence: { evidenceId: 'T', quote: text } });
  expect(validateMassBasis(basis, b, n, row(text))).toEqual([]);
  const bad = { ...b, declarationEvidence: { evidenceId: 'T', quote: '单卷100g，含纸芯' } };
  expect(codes(validateMassBasis(basis, bad, n, row(text)))).toContain('QUOTE_NOT_EXACT');
});

test('明确组织与取出路径矛盾才硬拦截', () => {
  for (const [form, action] of [['平叠单张式', '中心抽取'], ['平叠单张式', '外圈拉取'], ['卷式', '平叠揭取']]) {
    const p = row(`${form}；${action}`, { 'face.form': claim(form, form!), 'paper.dispense': claim(action, action!) });
    expect(codes(validateFormConsistency(p))).toContain('FORM_DISPENSE_CONFLICT');
    expect(validateFormConsistency(p).some(i => i.severity === 'error')).toBe(true);
  }
});

test('分节卷逐张抽取与宽泛抽取动作都允许，不反推组织和纸芯', () => {
  for (const action of ['逐张抽取', '中心抽取', '外圈拉取', '抽取式（路径未注明）']) {
    const p = row(`卷式分节；${action}`, { 'face.form': claim('卷式', '卷式分节'), 'paper.dispense': claim(action, action) });
    expect(validateFormConsistency(p)).toEqual([]);
  }
  const p = row('抽取式（路径未注明）', { 'face.form': { value: null, status: 'needs_evidence' }, 'paper.dispense': claim('抽取式（路径未注明）', '抽取式（路径未注明）') });
  const before = JSON.stringify(p); expect(validateFormConsistency(p)).toEqual([]); expect(JSON.stringify(p)).toBe(before);
});

test('干湿状态或抽取动作不能支撑卷/非卷，语义不足返回review不硬判false', () => {
  for (const form of ['卷式', '平叠单张式']) {
    const usage = validateFormConsistency(row('干湿两用', { 'face.form': claim(form, '干湿两用') }));
    expect(codes(usage)).toContain('FORM_NOT_ESTABLISHED_BY_USAGE'); expect(usage.every(i => i.severity === 'review')).toBe(true);
    const action = validateFormConsistency(row('抽取式', { 'face.form': claim(form, '抽取式') }));
    expect(codes(action)).toContain('FORM_NOT_ESTABLISHED_BY_ACTION'); expect(action.every(i => i.severity === 'review')).toBe(true);
  }
  expect(validateFormConsistency(row('滚筒抽取式', { 'face.form': claim('卷式', '滚筒抽取式') }))).toEqual([]);
});

test('否定形态或未确认质量口径不能因关键词命中而变成肯定事实', () => {
  for (const text of ['不是卷式', '非卷式', '未说明卷式']) {
    const issues = validateFormConsistency(row(text, { 'face.form': claim('卷式', text) }));
    expect(codes(issues)).toContain('FORM_STATEMENT_REQUIRES_REVIEW'); expect(issues.every(i => i.severity === 'review')).toBe(true);
  }
  expect(validateFormConsistency(row('非织造卷式', { 'face.form': claim('卷式', '非织造卷式') }))).toEqual([]);
  const text = '100g，未说明是否为本体净质量（不含芯及包装）';
  const issues = validateMassBasis(basis, claim('本体净质量（不含芯及包装）', text), mass(100, text), row(text));
  expect(codes(issues)).toContain('MASS_BASIS_STATEMENT_REQUIRES_REVIEW'); expect(issues.every(i => i.severity === 'review')).toBe(true);
});

test('厨房组织共用一致性，包装和裸平叠别名仍需要独立本体审证', () => {
  const p = row('卷式平叠揭取', { 'kitchen.form': claim('卷式', '卷式'), 'paper.dispense': claim('平叠揭取', '平叠揭取') });
  expect(codes(validateFormConsistency(p))).toContain('FORM_DISPENSE_CONFLICT');
  expect(codes(validateFormConsistency(row('盒装20卷', { 'kitchen.form': claim('卷式', '盒装20卷') })))).toContain('FORM_EVIDENCE_REQUIRES_REVIEW');
  expect(validateFormConsistency(row('独立单张平叠', { 'kitchen.form': claim('平叠单张式', '独立单张平叠') }))).toEqual([]);
});

test('预检不创建净纸重、不改源字段，已有裸标称复制净纸重须另审', () => {
  const p = row('每卷100g', { 'paper.nominal_mass': mass(100, '每卷100g', { weightScope: 'per_roll', per: '卷' }) });
  const before = JSON.stringify(p);validateRevisionRecord(p, standard);
  expect(p.fields['roll.net_paper_mass']).toBeUndefined(); expect(JSON.stringify(p)).toBe(before);
  const copied = row('每卷100g', { ...p.fields, 'roll.net_paper_mass': claim(100, '每卷100g') });
  expect(codes(validateRevisionRecord(copied, standard).issues)).toContain('NET_PAPER_MASS_NOT_PROVEN');
  const included = row('每卷100g，含纸芯', { 'roll.net_paper_mass': claim(100, '每卷100g，含纸芯') });
  expect(codes(validateRevisionRecord(included, standard).issues)).toContain('NET_PAPER_MASS_COMPOSITION_CONFLICT');
});

test('展示质量不能插入采购OR路线；组外严格净纸重不能被它补齐', () => {
  const s: RevisionStandard = { ...standard, bindings: [...standard.bindings, { attributeId: 'paper.nominal_mass', categoryId: 'cat', required: true, requirednessMode: 'measurement_group', requirementGroupId: 'g' }], requirementGroups: [{ id: 'g', categoryId: 'cat', paths: [{ id: 'display', attributes: ['paper.nominal_mass'] }] }] };
  const p = row('100g', { 'paper.nominal_mass': mass(100, '100g') });
  expect(codes(validateRevisionRecord(p, s).issues)).toContain('DISPLAY_MASS_IN_PROCUREMENT_PATH');
  const core = { ...standard, bindings: standard.bindings.map(b => b.attributeId === 'roll.net_paper_mass' ? { ...b, required: true } : b) };
  expect(validateRevisionRecord(p, core).requirements.complete).toBe(false);
});

test('适配器继续调用旧字段规则，并让不合法filled不能完成计量路径', () => {
  const count: RevisionDefinition = { id: 'quantity', name: '计数值', type: '数值', semantic: 'quantity', quantity: { unit: '片', per: '包' } };
  const boolean: RevisionDefinition = { id: 'flag', name: '是否', type: '是否' };
  const s: RevisionStandard = { definitions: [count, boolean], bindings: [{ attributeId: 'quantity', categoryId: 'cat', required: true, requirednessMode: 'measurement_group', requirementGroupId: 'g' }, { attributeId: 'flag', categoryId: 'cat', required: false }], requirementGroups: [{ id: 'g', categoryId: 'cat', paths: [{ id: 'count', attributes: ['quantity'] }] }] };
  const p = row('80片/包；不含酒精', { quantity: claim(99, '80片/包', { unit: '片/包', per: '包' }), flag: claim('否', '不含酒精') });
  const result = validateRevisionRecord(p, s);
  expect(codes(result.issues)).toContain('QUANTITY_UNIT_OR_VALUE_MISSING'); expect(codes(result.issues)).toContain('BOOLEAN_TYPE_REQUIRED');
  expect(result.requirements.complete).toBe(false); expect(result.passesPrecheck).toBe(false); expect(p.fields.quantity?.value).toBe(99);
});

test('全局定义存在仍须当前类目唯一绑定，已退休active值不参与当前版', () => {
  const old: RevisionDefinition = { id: 'wet.pieces', name: '旧每包片数', type: '数值', unit: '片/包' };
  const migrated: RevisionStandard = { ...triad, definitions: [...triad.definitions, old] };
  const p = row('80抽/包；80片/包', { ...triadFields(), 'wet.pieces': claim(80, '80片/包') });
  const unbound = validateRevisionRecord(p, migrated);
  expect(codes(unbound.issues)).toContain('ATTRIBUTE_NOT_BOUND'); expect(unbound.requirements.counts.fieldDenominator).toBe(3);
  const retired: RevisionStandard = { definitions: [old], bindings: [{ attributeId: 'wet.pieces', categoryId: 'cat', required: true, retired: true }] };
  const removed = validateRevisionRecord(row('80片/包', { 'wet.pieces': claim(80, '80片/包') }), retired);
  expect(codes(removed.issues)).toContain('ATTRIBUTE_RETIRED'); expect(removed.requirements.counts.fieldDenominator).toBe(0); expect(removed.passesPrecheck).toBe(false);
  const inactive = validateRevisionRecord(row('80片/包', { 'wet.pieces': { value: null, status: 'needs_evidence' } }), migrated);
  expect(codes(inactive.issues)).not.toContain('ATTRIBUTE_NOT_BOUND');
});

test('binding.allowedValues覆盖全局enum逐值检查，多选不能夹带其它类目值', () => {
  const mode: RevisionDefinition = { id: 'mode', name: '模式', type: '选项', enum: ['A', 'B', 'C'], selection: '多选' };
  const s: RevisionStandard = { definitions: [mode], bindings: [{ attributeId: 'mode', categoryId: 'cat', required: false, allowedValues: ['A', 'B'] }] };
  expect(codes(validateRevisionRecord(row('A B C', { mode: claim(['A', 'C'], 'A B C') }), s).issues)).toContain('BINDING_VALUE_NOT_ALLOWED');
  expect(validateRevisionRecord(row('A B', { mode: claim(['A', 'B'], 'A B') }), s).errors).toEqual([]);
  const override: RevisionStandard = { definitions: [{ ...mode, enum: ['A'], selection: '单选' }], bindings: [{ attributeId: 'mode', categoryId: 'cat', required: false, allowedValues: ['B'] }] };
  expect(validateRevisionRecord(row('B', { mode: claim('B', 'B') }), override).issues).toEqual([]);
  const candidate = validateRevisionRecord(row('C', { mode: claim('C', 'C', { status: 'enum_candidate' }) }), s);
  expect(codes(candidate.reviews)).toContain('BINDING_VALUE_CANDIDATE'); expect(candidate.passesPrecheck).toBe(false);
});

test('soft/boxed/wet迁移三元按原抽张片单位核验，不复用旧片数强制转片', () => {
  for (const [unit, per] of [['抽', '包'], ['张', '盒'], ['片', '包']]) {
    const text = `3层80${unit}/${per}`;
    const result = validateRevisionRecord(row(text, triadFields(text, unit!, per!)), triad);
    expect(result.errors).toEqual([]); expect(result.requirements.complete).toBe(true); expect(result.passesPrecheck).toBe(true);
  }
});

test('三元unit/per逐一对齐，冗余countUnit/packUnit不能掩盖矛盾', () => {
  const q = triadFields();
  const unitMismatch = validateRevisionRecord(row('80抽/包', { ...q, 'paper.quantity': { ...q['paper.quantity']!, unit: '张/包', countUnit: '抽' } }), triad);
  expect(codes(unitMismatch.issues)).toContain('COUNT_TRIAD_UNIT_MISMATCH'); expect(unitMismatch.requirements.complete).toBe(false);
  const perMismatch = validateRevisionRecord(row('80抽/包', { ...q, 'paper.quantity': { ...q['paper.quantity']!, per: '盒', packUnit: '包' } }), triad);
  expect(codes(perMismatch.issues)).toContain('COUNT_TRIAD_PER_MISMATCH'); expect(perMismatch.requirements.complete).toBe(false);
  const missing = validateRevisionRecord(row('80抽/包', { ...q, 'paper.count_unit': { value: null, status: 'needs_evidence' } }), triad);
  expect(codes(missing.issues)).toContain('COUNT_TRIAD_INCOMPLETE'); expect(missing.requirements.complete).toBe(false);
});

test('已验证legacy三元可从绑定伴随单位复用，未知模板unit不制造误报', () => {
  for (const unit of [undefined, '见计数单位/内包装单位']) {
    const f = triadFields(); f['paper.quantity'] = { ...f['paper.quantity']!, unit, per: null };
    const result = validateRevisionRecord(row('80抽/包', f), triad);
    expect(result.issues).toEqual([]); expect(result.requirements.complete).toBe(true);
  }
});

test('成品计数排除层张累计与乘层数；3层80抽仍取80抽', () => {
  const accumulated = row('累计层张240张/包', { ...triadFields('累计层张240张/包', '张'), 'paper.quantity': claim(240, '累计层张240张/包', { unit: '张/包', per: '包' }) });
  expect(codes(validateRevisionRecord(accumulated, triad).issues)).toContain('LAYER_ACCUMULATION_NOT_FINISHED_COUNT');
  const f = triadFields('80抽/包，3层');
  f['paper.quantity'] = { ...f['paper.quantity']!, value: 240, calculation: { operation: 'multiply', formula: '80×3=240', inputs: [{ value: 80, unit: '抽', scope: '同一包', evidenceId: 'T', quote: '80抽/包' }, { value: 3, unit: '层', scope: '同一包', evidenceId: 'T', quote: '3层' }], scopeEvidence: { evidenceId: 'T', quote: '80抽/包，3层' } } };
  expect(codes(validateRevisionRecord(row('80抽/包，3层', f), triad).issues)).toContain('LAYER_ACCUMULATION_NOT_FINISHED_COUNT');
  expect(validateRevisionRecord(row('3层80抽/包', triadFields('3层80抽/包')), triad).passesPrecheck).toBe(true);
});

test('条件问题保留在预检结果，纯选填未知NA不会被误说预检已通过', () => {
  const s: RevisionStandard = { definitions: [face], bindings: [{ attributeId: 'face.form', categoryId: 'cat', required: false, applicabilityCondition: { fact: 'unknownFact' } }] };
  const result = validateRevisionRecord(row('待证', { 'face.form': { value: null, status: 'not_applicable' } }), s);
  expect(result.requirements.counts.fieldDenominator).toBe(1);
  expect(codes(result.issues)).toContain('FIELD_NOT_APPLICABLE_UNPROVEN'); expect(result.passesPrecheck).toBe(false);
});

test('wrong/uncertain/缺归属预检排除、分母为0且不可误作通过', () => {
  for (const category of [{ status: 'wrong', targetId: 'other', targetName: '其他', targetPath: '父>其他', targetConfirmed: true }, { status: 'uncertain', targetConfirmed: false }, undefined]) {
    const p = { ...row('100g', { 'paper.nominal_mass': mass(100, '100g') }), category };
    const result = validateRevisionRecord(p, standard);
    expect(result.excluded).toBe(true); expect(result.passesPrecheck).toBe(false); expect(result.requirements.complete).toBe(false);
    expect(Object.values(result.requirements.counts).every(n => n === 0)).toBe(true);
  }
});
