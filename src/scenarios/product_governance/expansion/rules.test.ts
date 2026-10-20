import { expect, test } from 'bun:test';
import {
  isClaimPublishable, metrics, normalizeForComparison, ruleCatalog, validateCategoryConsistency,
  validateClaim, validateEvidenceReference, validateRecord,
  type ClaimCalculation, type FieldClaim, type FieldDefinition, type ProductRecord,
} from './rules.ts';

const count: FieldDefinition = { id: 'wipes.count', name: '每包片数', type: '数值', unit: '片/包', operator: 'positive_integer_per_pack' };
const size2: FieldDefinition = { id: 'sheet.size', name: '单片尺寸', type: '文本', unit: 'mm×mm', operator: 'dimensions_2d' };
const size3: FieldDefinition = { id: 'holder.size', name: '盒体尺寸', type: '文本', unit: 'mm', operator: 'dimensions_3d_or_cylinder' };
const scent: FieldDefinition = { id: 'common.scent', type: '选项', enum: ['茶香', '无香'], selection: '单选' };
const color: FieldDefinition = { id: 'common.color', type: '选项', enum: ['白色', '黑色', '粉色'], selection: '多选' };
const lock: FieldDefinition = { id: 'holder.lock', name: '是否带锁', type: '是否' };
const paper: FieldDefinition = { id: 'holder.includes_paper', name: '是否含纸', type: '是否' };
const claim = (value: unknown, quote: string, extra: Partial<FieldClaim> = {}): FieldClaim => ({ value, status: 'filled', evidenceId: 'T', quote, ...extra });
const product = (text: string, extra: Partial<ProductRecord> = {}): ProductRecord => ({
  id: 'sku-a', categoryId: 'category-a',
  category: { status: 'matched', targetId: 'category-a', targetName: '测试类目', targetPath: '根>测试类目', targetConfirmed: true },
  evidence: [{ id: 'T', productId: 'sku-a', text, kind: 'title', source: 'fixture' }], ...extra,
});
const codes = (def: FieldDefinition, c: FieldClaim, p: ProductRecord) => validateClaim(def, c, p).map(i => i.code);

test('明确包装层级可相乘，不能用无关系的数量凑总数',()=>{
 const p=product('27卷/箱×10箱'),def={id:'roll.sales_count',type:'数值',unit:'卷',operator:'positive_integer'};
 const calculation:ClaimCalculation={operation:'multiply',formula:'27*10=270',inputs:[{value:27,unit:'卷',scope:'每箱',evidenceId:'T',quote:'27卷/箱'},{value:10,unit:'箱',scope:'当前销售单元',evidenceId:'T',quote:'10箱'}],scopeEvidence:{evidenceId:'T',quote:'27卷/箱×10箱'},outputUnit:'卷'};
 expect(validateClaim(def,claim(270,'27卷/箱×10箱',{calculation}),p)).toEqual([]);
 expect(codes(def,claim(27,'27卷/箱×10箱',{calculation}),p)).toContain('CALCULATION_RESULT_MISMATCH');
 expect(codes(def,claim(270,'27卷/箱×10箱',{calculation:{...calculation,scopeEvidence:undefined}}),p)).toContain('PACK_HIERARCHY_EVIDENCE_REQUIRED');
});

test('比较归一不改候选语义，不把false/数字当空值或把字符串强转数值', () => {
  expect(normalizeForComparison(['黑色', '白色', '白色'])).toBe(normalizeForComparison(['白色', '黑色']));
  expect(normalizeForComparison(['白色'])).toBe(normalizeForComparison('白色'));
  expect(normalizeForComparison('茶花香')).not.toBe(normalizeForComparison('茶香'));
  expect(normalizeForComparison(80)).not.toBe(normalizeForComparison('80'));
  expect(normalizeForComparison(false)).not.toBe(normalizeForComparison(null));
  expect(normalizeForComparison({ b: 2, a: 1 })).toBe(normalizeForComparison({ a: 1, b: 2 }));
});

test('是否只接受布尔值，并要求明确的肯定或否定原文', () => {
  const p = product('防盗纸巾盒，不含纸，明确无锁');
  for (const value of ['否', 0, 'false']) expect(codes(paper, claim(value, '不含纸'), p)).toContain('BOOLEAN_TYPE_REQUIRED');
  expect(validateClaim(paper, claim(false, '不含纸'), p)).toEqual([]);
  expect(validateClaim(lock, claim(false, '无锁'), p)).toEqual([]);
  expect(codes(lock, claim(true, '防盗纸巾盒'), p)).toContain('BOOLEAN_NOT_EXPLICIT');
  expect(codes(paper, claim(false, '纸巾盒'), p)).toContain('BOOLEAN_NOT_EXPLICIT');
  const withKey = product('完整容器，配钥匙');
  expect(validateClaim(lock, claim(true, '配钥匙'), withKey)).toEqual([]);
});

test('正数/计数类型拦截非数值、小数、无限和不安全整数', () => {
  const p = product('每包80片');
  for (const value of [0, -1, '80片', Infinity, NaN]) expect(codes(count, claim(value, '每包80片'), p)).toContain('POSITIVE_NUMBER_REQUIRED');
  for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1]) expect(codes(count, claim(value, '每包80片'), p)).toContain('POSITIVE_INTEGER_REQUIRED');
  expect(validateClaim(count, claim(80, '每包80片'), p)).toEqual([]);
});

test('日期必须真实存在，不能自动纠正2月30日', () => {
  const def = { id: 'date', type: '日期' }, p = product('2026-02-30');
  expect(codes(def, claim('2026-02-30', '2026-02-30'), p)).toContain('DATE_INVALID');
  const valid = product('2024-02-29');
  expect(validateClaim(def, claim('2024-02-29', '2024-02-29'), valid)).toEqual([]);
});

test('引文逐字校验：外SKU、无归属、重复ID、改写和补单位均不通过', () => {
  const p = product('每包80片');
  expect(validateEvidenceReference(p, { evidenceId: 'T', quote: '每包80片' })).toEqual([]);
  for (const quote of ['每包 80片', '每包80张', '每包80片/包']) expect(validateEvidenceReference(p, { evidenceId: 'T', quote }).map(i => i.code)).toContain('QUOTE_NOT_EXACT');
  expect(validateEvidenceReference(p, { evidenceId: 'missing', quote: '80片' })[0]?.code).toBe('EVIDENCE_NOT_FOUND');
  for (const productId of ['sku-b', undefined]) {
    const wrong = product('每包80片', { evidence: [{ id: 'T', productId, text: '每包80片' }] });
    expect(validateEvidenceReference(wrong, { evidenceId: 'T', quote: '80片' })[0]?.code).toBe('EVIDENCE_WRONG_SKU');
  }
  const duplicate = product('每包80片', { evidence: [...p.evidence, ...p.evidence] });
  expect(validateEvidenceReference(duplicate, { evidenceId: 'T', quote: '80片' })[0]?.code).toBe('EVIDENCE_ID_AMBIGUOUS');
});

test('数量引文不能只留数字；字段单位不能补证据单位', () => {
  const p = product('每包80片');
  expect(codes(count, claim(80, '80'), p)).toContain('QUANTITY_UNIT_OR_VALUE_MISSING');
  const bare = product('每包80');
  expect(codes(count, claim(80, '每包80'), bare)).toContain('QUANTITY_UNIT_OR_VALUE_MISSING');
});

test('直接每包/每盒/每卷范围明确才填，整组总量不能当单包装数', () => {
  for (const text of ['每包80片', '80片/包', '80片×6包', '6包×80片']) expect(validateClaim(count, claim(80, text), product(text))).toEqual([]);
  const total = product('整组共480片，6包');
  expect(codes(count, claim(480, '整组共480片，6包'), total)).toContain('SINGLE_PACK_BASIS_MISSING');
  const box: FieldDefinition = { type: '数值', unit: '支/盒', operator: 'positive_integer_per_pack' };
  expect(validateClaim(box, claim(24, '每盒24支'), product('每盒24支'))).toEqual([]);
  const roll: FieldDefinition = { type: '数值', unit: '米/卷', operator: 'positive_number' };
  expect(validateClaim(roll, claim(12.5, '每卷12.5米'), product('每卷12.5米'))).toEqual([]);
});

test('单位可来自结构化claim或伴随字段，原始抽张片段不强制换算', () => {
  const dynamic: FieldDefinition = { id: 'towel.count', type: '数值', semantic: 'quantity', operator: 'positive_integer_per_pack', quantity: { unitField: 'towel.count_unit', perField: 'towel.pack_unit' } };
  const p = product('每卷700段', { fields: {
    'towel.count_unit': claim('段', '700段'),
    'towel.pack_unit': claim('卷', '每卷'),
  } });
  expect(validateClaim(dynamic, claim(700, '每卷700段'), p)).toEqual([]);
  const original: FieldDefinition = { type: '数值', semantic: 'quantity', operator: 'positive_integer_per_pack', unit: '' };
  for (const unit of ['抽', '张', '片', '段']) {
    const text = `每包80${unit}`;
    expect(validateClaim(original, claim(80, text, { countUnit: unit, packUnit: '包' }), product(text))).toEqual([]);
  }
  expect(codes(original, claim(80, '每包80片', { unit: '张/包' }), product('每包80片'))).toContain('QUANTITY_UNIT_OR_VALUE_MISSING');
  expect(codes(count, claim(80, '每包80片', { unit: '张/包' }), product('每包80片'))).toContain('STRUCTURED_UNIT_MISMATCH');
  const dependencies: FieldDefinition = { id: 'paper.quantity', name: '单内包装计数值', type: '数值', unit: '见计数单位/内包装单位', operator: 'positive_integer_with_count_and_container_unit', dependencies: ['paper.count_unit', 'paper.inner_unit'] };
  const existingContract = product('每卷700段', { fields: { 'paper.count_unit': claim('段', '700段'), 'paper.inner_unit': claim('卷', '每卷') } });
  expect(validateClaim(dependencies, claim(700, '每卷700段', { unit: dependencies.unit }), existingContract)).toEqual([]);
});

test('外部字典的空枚举不等于封闭空全集；m不能错误匹配mm，面料定量不是内包装口径', () => {
  const brand: FieldDefinition = { id: 'common.brand', type: '选项', enum: [], dictionary: 'brand-reference', selection: '单选' };
  expect(validateClaim(brand, claim('全棉时代', '全棉时代'), product('全棉时代'))).toEqual([]);
  const length: FieldDefinition = { id: 'roll.length', type: '数值', unit: 'm/卷', operator: 'positive_number' };
  expect(codes(length, claim(20, '每卷20mm'), product('每卷20mm'))).toContain('QUANTITY_UNIT_OR_VALUE_MISSING');
  const grammage: FieldDefinition = { id: 'item.grammage', type: '数值', unit: 'g/㎡', operator: 'positive_number' };
  expect(validateClaim(grammage, claim(75, '面料定量75g/㎡', { unit: 'g/㎡' }), product('面料定量75g/㎡'))).toEqual([]);
});

test('B23回归：尺寸只有数字时，输出加mm仍不能通过', () => {
  const p = product('盒体尺寸230×125×95');
  expect(codes(size3, claim('230×125×95mm', '盒体尺寸230×125×95'), p)).toContain('DIMENSION_UNIT_MISSING');
});

test('二维/三维尺寸允许明确长度单位换算，保持轴序并排除包装和厚度', () => {
  expect(validateClaim(size2, claim('150×200mm', '单片15*20CM'), product('单片15*20CM'))).toEqual([]);
  expect(validateClaim(size2, claim('200×120mm', '单片20CM*12CM'), product('单片20CM*12CM'))).toEqual([]);
  expect(validateClaim(size2, claim('200×180mm', '单片20×18cm'), product('单片20×18cm'))).toEqual([]);
  expect(validateClaim(size3, claim('230×125×95mm', '盒体23×12.5×9.5cm'), product('盒体23×12.5×9.5cm'))).toEqual([]);
  expect(codes(size2, claim('180×200mm', '单片20×18cm'), product('单片20×18cm'))).toContain('DIMENSION_VALUE_UNSUPPORTED');
  expect(codes(size2, claim('200×180mm', '包装尺寸200×180mm'), product('包装尺寸200×180mm'))).toContain('DIMENSION_WRONG_OBJECT');
  expect(codes(size2, claim('200×180mm', '纸张长200mm×厚180mm'), product('纸张长200mm×厚180mm'))).toContain('DIMENSION_THICKNESS_AMBIGUOUS');
  expect(codes(size3, claim('230×125mm', '盒体230×125mm'), product('盒体230×125mm'))).toContain('DIMENSION_AXES_INCOMPLETE');
  expect(validateClaim(size3, claim('直径100mm×高200mm', '直径10cm×高20cm'), product('直径10cm×高20cm'))).toEqual([]);
});

function sumCalculation(scopeEvidence?: { evidenceId: string; quote: string }): ClaimCalculation {
  return { operation: 'sum', formula: '10+6=16', inputs: [10, 6].map(value => ({ value, unit: '片', scope: 'inner-pack', evidenceId: 'T', quote: '10+6片', role: 'part' })), scopeEvidence };
}
test('W09回归：10+6求和必须证明处于同一内包装，组套标题本身不够', () => {
  const p = product('10+6片装方形湿巾8包组套');
  expect(codes(count, claim(16, '10+6片', { calculation: sumCalculation() }), p)).toContain('SINGLE_PACK_EVIDENCE_REQUIRED');
  const confirmed = product('单包10+6片，8包组套');
  const valid = claim(16, '10+6片', { calculation: sumCalculation({ evidenceId: 'T', quote: '单包10+6片' }) });
  expect(validateClaim(count, valid, confirmed)).toEqual([]);
  confirmed.evidence.push({ id: 'V', productId: confirmed.id, text: '每包16片', kind: 'image_visual_verified', scope: 'inner-pack' });
  expect(validateClaim(count, valid, confirmed)).toEqual([]);
  const differentScope = structuredClone(valid);
  differentScope.calculation!.inputs[1]!.scope = 'other-pack';
  expect(codes(count, differentScope, confirmed)).toContain('CALCULATION_SCOPE_MISMATCH');
});

function divisionFixture() {
  const text = '同一销售单元本组，同规格，无赠品，总480片，共6包', p = product(text);
  const c = claim(80, text, { calculation: {
    operation: 'divide', formula: '480/6=80', outputUnit: '片/包',
    inputs: [
      { value: 480, unit: '片', scope: 'sale-unit', role: 'total', evidenceId: 'T', quote: '总480片' },
      { value: 6, unit: '包', scope: 'sale-unit', role: 'packs', evidenceId: 'T', quote: '共6包' },
    ],
    scopeEvidence: { evidenceId: 'T', quote: '同一销售单元本组' },
    homogeneous: { value: true, evidenceId: 'T', quote: '同规格' },
    giftsExcluded: { value: true, evidenceId: 'T', quote: '无赠品' },
  } });
  return { p, c };
}
test('总量除包装数必须同单元、同规格、赠品明确并提供真实计算式', () => {
  const { p, c } = divisionFixture();
  expect(validateClaim(count, c, p)).toEqual([]);
  const missingScope = structuredClone(c); delete missingScope.calculation!.scopeEvidence;
  expect(codes(count, missingScope, p)).toContain('SALE_SCOPE_EVIDENCE_REQUIRED');
  const missingHomogeneous = structuredClone(c); delete missingHomogeneous.calculation!.homogeneous;
  expect(codes(count, missingHomogeneous, p)).toContain('HOMOGENEITY_EVIDENCE_REQUIRED');
  const missingGift = structuredClone(c); delete missingGift.calculation!.giftsExcluded;
  expect(codes(count, missingGift, p)).toContain('GIFT_BOUNDARY_EVIDENCE_REQUIRED');
  const wrongScope = structuredClone(c); wrongScope.calculation!.inputs[1]!.scope = 'other-sale';
  expect(codes(count, wrongScope, p)).toContain('CALCULATION_SCOPE_MISMATCH');
  const wrongFormula = structuredClone(c); wrongFormula.calculation!.formula = '480/8=60';
  expect(codes(count, wrongFormula, p)).toContain('CALCULATION_FORMULA_MISMATCH');
  const wrongResult = structuredClone(c); wrongResult.value = 60;
  expect(codes(count, wrongResult, p)).toContain('CALCULATION_RESULT_MISMATCH');
});

test('除法不能四舍五入，输入也不能引用假单位或另一个SKU', () => {
  const { p, c } = divisionFixture();
  p.evidence[0]!.text = p.evidence[0]!.text.replace('480', '481');
  c.quote = c.quote!.replace('480', '481'); c.calculation!.inputs[0]!.value = 481; c.calculation!.inputs[0]!.quote = '总481片';
  c.calculation!.formula = '481/6=80';
  expect(codes(count, c, p)).toContain('NON_INTEGER_DIVISION');
  c.calculation!.inputs[0]!.quote = '总481张';
  expect(codes(count, c, p)).toContain('QUOTE_NOT_EXACT');
});

test('抽张片层不默认互换；有当前SKU明确等式时支持独立换算', () => {
  const draws: FieldDefinition = { type: '数值', unit: '抽/包', operator: 'positive_integer_per_pack' }, p = product('每包30张，明确3张=1抽');
  expect(codes(draws, claim(10, '每包30张'), p)).toContain('QUANTITY_UNIT_OR_VALUE_MISSING');
  const c = claim(10, '每包30张', { calculation: {
    operation: 'convert', formula: '30*0.3333333333333333=10', factor: 1 / 3, outputUnit: '抽/包',
    inputs: [{ value: 30, unit: '张', scope: 'inner-pack', role: 'source', evidenceId: 'T', quote: '每包30张' }],
    conversionEvidence: { evidenceId: 'T', quote: '3张=1抽' }, scopeEvidence: { evidenceId: 'T', quote: '每包30张' },
  } });
  expect(validateClaim(draws, c, p)).toEqual([]);
  delete c.calculation!.conversionEvidence;
  expect(codes(draws, c, p)).toContain('EXPLICIT_CONVERSION_REQUIRED');
});

test('S05回归：茶花香保留枚举候选，不能把它强归茶香', () => {
  const p = product('茶花香');
  expect(codes(scent, claim('茶香', '茶花香'), p)).toContain('SCENT_VALUE_UNSUPPORTED');
  const candidate = claim('茶花香', '茶花香', { status: 'enum_candidate' });
  expect(validateClaim(scent, candidate, p)).toEqual([]);
  expect(isClaimPublishable(scent, candidate, p)).toBe(false);
  expect(codes(scent, claim('茶花香', '茶花香'), p)).toContain('ENUM_OUTSIDE_DICTIONARY');
});

test('香精添加状态不能直接替代实际香型', () => {
  const p = product('未添加香精');
  expect(codes(scent, claim('无香', '未添加香精'), p)).toContain('SCENT_NOT_FRAGRANCE_FREE');
});

test('B50回归：系列图案名不能推出粉色，包装色不能充当本体色', () => {
  const p = product('款式：桃花微风');
  expect(codes(color, claim(['粉色'], '桃花微风'), p)).toContain('COLOR_NOT_EXPLICIT');
  expect(codes(color, claim(['粉色'], '图案粉色'), product('图案粉色'))).toContain('COLOR_WRONG_OBJECT');
  const body = product('盒体本体白色，包装粉色');
  expect(validateClaim(color, claim(['白色'], '盒体本体白色，包装粉色'), body)).toEqual([]);
  const uncertain = product('白色');
  expect(codes(color, claim('白色', '白色'), uncertain)).toContain('COLOR_OBJECT_UNCONFIRMED');
});

test('草本和纯水不能当基布材料，纯棉原文可用', () => {
  const def = { id: 'wet.substrate', name: '基布材质', type: '文本' };
  expect(codes(def, claim('草本', '草本植物精华'), product('草本植物精华'))).toContain('SUBSTRATE_NOT_EXPLICIT');
  expect(codes(def, claim('纯水', '99%纯水'), product('99%纯水'))).toContain('SUBSTRATE_NOT_EXPLICIT');
  expect(validateClaim(def, claim('纯棉', '基布材质：纯棉'), product('基布材质：纯棉'))).toEqual([]);
});

test('W47回归：标题单片装与核验图10片保留冲突，其他图内属性也先核SKU', () => {
  const p = product('卫生系列单片装湿巾12包');
  p.evidence.push({ id: 'V', productId: p.id, text: '10片', kind: 'image_visual_verified', scope: 'inner-pack' });
  const c = claim(1, '单片装');
  const conflicts = validateClaim(count, c, p).filter(i => i.code === 'COUNT_SOURCE_CONFLICT');
  expect(conflicts[0]).toMatchObject({ severity: 'error', suggestedStatus: 'conflict', evidenceIds: ['T', 'V'] });
  p.evidence[1]!.text = '每包10片，无酒精';
  const alcohol = { id: 'wet.alcohol', type: '是否' };
  expect(codes(alcohol, claim(false, '无酒精', { evidenceId: 'V' }), p)).toContain('IMAGE_SKU_RECONCILIATION_REQUIRED');
});

test('OCR疑似数字只触发复核，不当成确定来源冲突', () => {
  const p = product('每包80片');
  p.evidence.push({ id: 'OCR', productId: p.id, text: '每包8片', kind: 'image_ocr' });
  expect(validateClaim(count, claim(80, '每包80片'), p)).toEqual([]);
  expect(codes(count, claim(8, '每包8片', { evidenceId: 'OCR' }), p)).toContain('OCR_REQUIRES_VERIFICATION');
});

test('文字包装组成不能新增数量、补猜单位，支持多条独立原文', () => {
  const pack = { id: 'common.pack', type: '文本' }, p = product('20包');
  expect(codes(pack, claim('20包×80片', '20包'), p)).toContain('TEXT_QUANTITY_NOT_SUPPORTED');
  p.evidence.push({ id: 'S', productId: p.id, text: '每包80片', kind: 'sale_spec' });
  expect(validateClaim(pack, claim('20包×80片/包', '20包', { supportingEvidence: [{ evidenceId: 'S', quote: '每包80片' }] }), p)).toEqual([]);
  const bare = product('20');
  expect(codes(pack, claim('20包', '20'), bare)).toContain('TEXT_QUANTITY_NOT_SUPPORTED');
});

test('未知、冲突、候选、不适用分别处理，未知不能用not_applicable逃避缺失', () => {
  const p = product('未说明');
  expect(validateClaim(count, { value: null, status: 'needs_evidence' }, p)).toEqual([]);
  expect(validateClaim(count, { value: null, status: 'conflict' }, p)).toEqual([]);
  expect(codes(count, { value: 80, status: 'needs_evidence' }, p)).toContain('UNRESOLVED_VALUE_PRESENT');
  expect(codes(count, { value: null, status: 'not_applicable' }, p)).toContain('NOT_APPLICABLE_UNSUPPORTED');
  expect(validateClaim({ ...count, applicable: false }, { value: null, status: 'not_applicable' }, p)).toEqual([]);
  p.category!.status = 'wrong';
  expect(validateClaim(count, { value: null, status: 'not_applicable' }, p)).toEqual([]);
  expect(codes(count, claim(80, '未说明'), p)).toContain('CATEGORY_FIELD_NOT_APPLICABLE');
});

test('终审类目targetConfirmed、目标ID、状态和完整路径不能互相矛盾', () => {
  const p = product('完整容器');
  expect(validateCategoryConsistency(p)).toEqual([]);
  p.category!.targetConfirmed = false;
  expect(validateCategoryConsistency(p).map(i => i.code)).toContain('MATCHED_TARGET_UNCONFIRMED');
  p.category = { status: 'wrong', targetConfirmed: true, targetId: p.categoryId, targetName: '测试类目', targetPath: '根>测试类目' };
  expect(validateCategoryConsistency(p).map(i => i.code)).toContain('WRONG_TARGET_INCONSISTENT');
  p.category = { status: 'uncertain', targetConfirmed: true, targetId: 'category-b', inRate: true };
  expect(validateCategoryConsistency(p).map(i => i.code)).toEqual(expect.arrayContaining(['UNCERTAIN_TARGET_CONFIRMED', 'CONFIRMED_TARGET_INCOMPLETE', 'INELIGIBLE_CATEGORY_IN_RATE']));
});

test('跨类combo必须先明确治理策略，主件目标和人工复核状态均需一致', () => {
  const p = product('容器与纸品组合', { components: [{ categoryId: 'holder' }, { categoryId: 'paper' }] });
  expect(validateCategoryConsistency(p).map(i => i.code)).toContain('COMBINATION_POLICY_REQUIRED');
  p.combination = { crossCategory: true, policy: 'primary_item', primaryCategoryId: 'category-a' };
  expect(validateCategoryConsistency(p)).toEqual([]);
  p.combination.primaryCategoryId = 'holder';
  expect(validateCategoryConsistency(p).map(i => i.code)).toContain('PRIMARY_CATEGORY_MISMATCH');
  p.combination.policy = 'manual_review';
  expect(validateCategoryConsistency(p).map(i => i.code)).toContain('COMBINATION_AWAITING_CATEGORY');
  p.category = { status: 'uncertain', targetConfirmed: false };
  expect(validateCategoryConsistency(p)).toEqual([]);
});

test('可确定的错误与无法纯规则确定的语义分别返回error/review', () => {
  const def = { id: 'use', type: '选项', enum: ['手口清洁'] }, p = product('婴儿可用');
  const issues = validateClaim(def, claim('手口清洁', '婴儿可用'), p);
  expect(issues).toContainEqual(expect.objectContaining({ code: 'SEMANTIC_MAPPING_REQUIRES_REVIEW', severity: 'review' }));
  expect(issues.some(i => i.severity === 'error')).toBe(false);
  expect(isClaimPublishable(def, claim('手口清洁', '婴儿可用'), p)).toBe(false);
});

test('分母排除错挂/待确认，候选不计已填，按定义验证后语义复核也不计填充', () => {
  const p = product('每包80片，茶花香');
  p.fields = { [count.id!]: claim(80, '每包80片', { required: true }), [scent.id!]: claim('茶花香', '茶花香', { status: 'enum_candidate' }), unknown: { value: null, status: 'needs_evidence' }, excluded: { value: null, status: 'not_applicable' } };
  const wrong = product('', { category: { status: 'wrong' }, fields: { [count.id!]: claim(80, '') } });
  const uncertain = product('', { category: { status: 'uncertain' }, fields: { [count.id!]: claim(80, '') } });
  expect(metrics([p, wrong, uncertain], [count, scent])).toMatchObject({ sample: 3, eligible: 1, wrong: 1, uncertain: 1, slots: 3, filled: 1, required: 1, requiredFilled: 1, enumCandidates: 1, fillRate: 1 / 3, requiredFillRate: 1, complete: 1 });
  expect(metrics([]).fillRate).toBeNull();
  const unresolved = product('防盗盒', { fields: { [lock.id!]: claim(true, '防盗盒', { required: true }) } });
  expect(metrics([unresolved], [lock])).toMatchObject({ filled: 0, requiredFilled: 0, complete: 0 });
  expect(validateRecord(p, [count, scent]).map(i => i.code)).toContain('ATTRIBUTE_UNREGISTERED');
});

test('规则目录覆盖执行规则且没有按商品ID决定判决', () => {
  const ids = ruleCatalog.rules.map(r => r.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ['V01', 'V02', 'V03', 'E01', 'E02', 'E03', 'Q01', 'Q02', 'Q03', 'D01', 'S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'C01', 'C02']) expect(ids).toContain(id);
  const a = product('每包80片'), b = product('每包80片');
  b.id = 'some-other-sku'; b.evidence = b.evidence.map(e => ({ ...e, productId: b.id }));
  expect(validateClaim(count, claim(80, '每包80片'), a)).toEqual(validateClaim(count, claim(80, '每包80片'), b));
});
