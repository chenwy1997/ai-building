import { expect, test } from 'bun:test';
import { validateClaim } from '../expansion/rules.ts';
import type { RevisionRecord, RevisionStandard } from '../revision/semantic-guards.ts';
import { adaptLegacyQuantityIssue, preserveModelCountBoundary } from './legacy-compat.ts';

function fixture(unit = '片') {
  const standard: RevisionStandard = {
    definitions: [{ id: 'paper.quantity', type: '数值', semantic: 'quantity', quantity: { unitField: 'paper.count_unit', perField: 'paper.inner_unit' } },
      { id: 'paper.count_unit', type: '选项', enum: ['片', 'PCS'], ...{ aliases: [{ from: 'pcs', to: 'PCS' }, { from: 'Pcs', to: 'PCS' }] } },
      { id: 'paper.inner_unit', type: '选项', enum: ['包'] }],
    bindings: [{ categoryId: 'cat', attributeId: 'paper.quantity', required: true }, { categoryId: 'cat', attributeId: 'paper.count_unit', required: true, allowedValues: ['片', 'PCS'] }, { categoryId: 'cat', attributeId: 'paper.inner_unit', required: true }],
  };
  const product: RevisionRecord = { id: 'sku', categoryId: 'cat', fields: {
    'paper.quantity': { value: 48, status: 'filled', unit, per: '包', evidenceId: 'T', quote: `48${unit}/包` },
    'paper.count_unit': { value: unit, status: 'filled', evidenceId: 'T', quote: `48${unit}/包` },
    'paper.inner_unit': { value: '包', status: 'filled', evidenceId: 'T', quote: `48${unit}/包` },
  }, evidence: [{ id: 'T', productId: 'sku', kind: 'title', text: `48${unit}/包` }, { id: 'J', productId: 'sku', kind: 'upstream_detail', text: `维达VW4002 48${unit}/包*12 整箱` }] };
  return { standard, product };
}
function issues(f: ReturnType<typeof fixture>) { return validateClaim(f.standard.definitions[0]!, f.product.fields['paper.quantity']!, f.product); }

test('米和m只统一单位字形，保留单卷范围的人审与原引文', () => {
  const f = fixture();
  f.standard.definitions = [{ id: 'roll.length', type: '数值', semantic: 'quantity' }];
  f.standard.bindings = [{categoryId:'cat',attributeId:'roll.length',required:true}];
  f.product.evidence = [{id:'T',productId:'sku',kind:'title',text:'大卷纸190米/卷'}];
  f.product.fields = {'roll.length':{value:190,status:'filled',unit:'m/卷',evidenceId:'T',quote:'190米/卷'}};
  const old=validateClaim(f.standard.definitions[0]!,f.product.fields['roll.length']!,f.product).find(i=>i.code==='QUANTITY_UNIT_OR_VALUE_MISSING')!;
  expect(old).toBeDefined(); const before=JSON.stringify(f);
  const fixed=adaptLegacyQuantityIssue(old,f.product,f.standard);
  expect(fixed.severity).toBe('review');expect(fixed.adaptation).toBe('metre_chinese_unit_spelling');expect(fixed.originalCheck).toEqual(old);expect(JSON.stringify(f)).toBe(before);
  for(const mode of ['cm','mm','wrong_value','wrong_sku','fake_quote','untrusted_ocr','no_binding']){
    const x=structuredClone(f),claim=x.product.fields['roll.length']!;
    if(mode==='cm'||mode==='mm'){const q=mode==='cm'?'190厘米/卷':'190毫米/卷';x.product.evidence[0]!.text=q;claim.quote=q;}
    if(mode==='wrong_value')claim.value=19;
    if(mode==='wrong_sku')x.product.evidence[0]!.productId='other';
    if(mode==='fake_quote')claim.quote='190米长/卷';
    if(mode==='untrusted_ocr')x.product.evidence[0]!.kind='image_ocr';
    if(mode==='no_binding')x.standard.bindings=[];
    expect(adaptLegacyQuantityIssue(old,x.product,x.standard).severity).toBe('error');
  }
});

test('中文层数只接受合法同SKU精确原词，保留人工核验门禁', () => {
  for (const [word, count] of [['单层', 1], ['四层', 4]] as const) {
    const f = fixture();
    f.standard.definitions = [{ id: 'soft.layers', type: '数值', semantic: 'quantity' }];
    f.product.evidence = [{ id: 'T', productId: 'sku', kind: 'title', text: `纸巾${word}` }];
    f.product.fields = { 'soft.layers': { value: count, status: 'filled', unit: '层', evidenceId: 'T', quote: word } };
    const old = validateClaim(f.standard.definitions[0]!, f.product.fields['soft.layers']!, f.product).find(i => i.code === 'QUANTITY_UNIT_OR_VALUE_MISSING')!;
    expect(old).toBeDefined();
    const fixed = adaptLegacyQuantityIssue(old, f.product, f.standard);
    expect(fixed.severity).toBe('review'); expect(fixed.originalCheck).toEqual(old);
    f.product.fields['soft.layers']!.value = count + 1;
    expect(adaptLegacyQuantityIssue(old, f.product, f.standard).severity).toBe('error');
    f.product.fields['soft.layers']!.value = count;
    f.product.evidence[0]!.productId = 'other';
    expect(adaptLegacyQuantityIssue(old, f.product, f.standard).severity).toBe('error');
  }
});

test('型号与计数真实空白边界保留，4002和48不能拼成400248', () => {
  const f = fixture(), before = JSON.stringify(f);
  const old = issues(f).find(i => i.code === 'COUNT_SOURCE_CONFLICT')!;
  expect(old.message).toContain('400248');
  const fixed = adaptLegacyQuantityIssue(old, f.product, f.standard);
  expect(fixed.severity).toBe('review'); expect(fixed.adaptation).toBe('model_count_whitespace_boundary');
  expect(fixed.originalCheck).toEqual(old); expect(fixed.parsingWitnesses).toEqual([{ evidenceId: 'J', quote: 'VW4002 48片' }]);
  expect(JSON.stringify(f)).toBe(before);
  expect(preserveModelCountBoundary('VW4002 48片/包', '片').parsed).toBe('VW4002 ·48片/包');
});

test('紧连型号不得猜切；真实400248和真实80仍是数量冲突', () => {
  for (const text of ['维达VW400248片/包', '真实数量400248片/包', '维达VW4002 48片/包，另版80片/包', '维达VW4002 48片/包，真实400248片/包']) {
    const f = fixture(); f.product.evidence[1]!.text = text;
    const old = issues(f).find(i => i.code === 'COUNT_SOURCE_CONFLICT')!;
    expect(old).toBeDefined(); const checked = adaptLegacyQuantityIssue(old, f.product, f.standard);
    expect(checked.severity).toBe('error');
    if (text.includes('80片')) { expect(checked.message).toContain('48、80'); expect(checked.message).not.toContain('400248'); }
    if (text.includes('真实400248')) expect(checked.message).toContain('400248');
  }
});

test('主引文跨型号空白也仅内部重验，不改源、不自动接受', () => {
  const f = fixture(); f.product.fields['paper.quantity']!.evidenceId = 'J'; f.product.fields['paper.quantity']!.quote = 'VW4002 48片/包';
  const old = issues(f).filter(i => ['QUANTITY_UNIT_OR_VALUE_MISSING', 'COUNT_SOURCE_CONFLICT'].includes(i.code));
  expect(old).toHaveLength(2);
  for (const issue of old) expect(adaptLegacyQuantityIssue(issue, f.product, f.standard).severity).toBe('review');
  expect(f.product.evidence[1]!.text).toBe('维达VW4002 48片/包*12 整箱');
});

test('非法引用或错误数值不能利用数字边界兼容放过', () => {
  for (const mode of ['bad_quote', 'wrong_sku', 'wrong_value']) {
    const f = fixture(); const old = issues(f).find(i => i.code === 'COUNT_SOURCE_CONFLICT')!;
    if (mode === 'bad_quote') f.product.fields['paper.quantity']!.quote = '80片/包';
    if (mode === 'wrong_sku') f.product.evidence[0]!.productId = 'other';
    if (mode === 'wrong_value') f.product.fields['paper.quantity']!.value = 80;
    expect(adaptLegacyQuantityIssue(old, f.product, f.standard).severity).toBe('error');
  }
});

test('PCS仅注册别名大小写归一且保留原单位，原始检查仍在', () => {
  for (const raw of ['pcs', 'Pcs']) {
    const f = fixture('PCS'); f.product.evidence = [{ id: 'T', productId: 'sku', kind: 'title', text: `每包40${raw}` }];
    for (const field of Object.values(f.product.fields)) { field.quote = `每包40${raw}`; field.evidenceId = 'T'; }
    f.product.fields['paper.quantity']!.value = 40; f.product.fields['paper.quantity']!.originalUnit = raw;
    f.product.fields['paper.count_unit']!.originalUnit = raw;
    const old = issues(f).find(i => i.code === 'QUANTITY_UNIT_OR_VALUE_MISSING')!;
    expect(old).toBeDefined(); const fixed = adaptLegacyQuantityIssue(old, f.product, f.standard);
    expect(fixed.adaptation).toBe('registered_pcs_case_only'); expect(fixed.severity).toBe('review'); expect(fixed.originalCheck).toEqual(old);
    expect(f.product.fields['paper.quantity']!.originalUnit).toBe(raw); expect(f.product.evidence[0]!.text).toBe(`每包40${raw}`);
  }
});

test('PCS适配不允许抽张片换算、错数、丢原单位、未登记、非法SKU或假引文', () => {
  for (const mode of ['chinese_unit', 'wrong_value', 'no_original', 'unregistered', 'wrong_sku', 'fake_quote', 'unregistered_alias']) {
    const f = fixture('PCS'); f.product.evidence = [{ id: 'T', productId: 'sku', kind: 'title', text: '每包40pcs' }];
    for (const field of Object.values(f.product.fields)) { field.quote = '每包40pcs'; field.evidenceId = 'T'; }
    f.product.fields['paper.quantity']!.value = 40; f.product.fields['paper.quantity']!.originalUnit = 'pcs';
    const old = issues(f).find(i => i.code === 'QUANTITY_UNIT_OR_VALUE_MISSING')!;
    if (mode === 'chinese_unit') f.product.fields['paper.quantity']!.unit = '片';
    if (mode === 'wrong_value') f.product.fields['paper.quantity']!.value = 41;
    if (mode === 'no_original') delete f.product.fields['paper.quantity']!.originalUnit;
    if (mode === 'unregistered') f.standard.bindings = f.standard.bindings.map((binding, i) => i === 1 ? { ...binding, allowedValues: ['片'] } : binding);
    if (mode === 'wrong_sku') f.product.evidence[0]!.productId = 'other';
    if (mode === 'fake_quote') f.product.fields['paper.quantity']!.quote = '每包40Pcs';
    if (mode === 'unregistered_alias') delete (f.standard.definitions[1] as any).aliases;
    expect(adaptLegacyQuantityIssue(old, f.product, f.standard).severity).toBe('error');
  }
});

test('明确整箱表达式外乘倍数保留真实引文，不编造箱单位且仍需人审', () => {
  const f = fixture();
  f.standard.definitions = [{id:'roll.sales_count',type:'数值',semantic:'quantity',quantity:{unit:'卷'}}];
  f.standard.bindings = [{categoryId:'cat',attributeId:'roll.sales_count',required:false}];
  f.product.evidence = [{id:'T',productId:'sku',kind:'title',text:'清风4层180克27卷（整箱销售）*5'}];
  const quote='27卷（整箱销售）*5';
  f.product.fields = {'roll.sales_count':{value:135,status:'filled',unit:'卷',evidenceId:'T',quote,
    calculation:{operation:'multiply',inputs:[
      {value:27,unit:'卷',scope:'每整箱',evidenceId:'T',quote:'27卷'},
      {value:5,unit:'倍',scope:'同一整箱销售单位的倍数',evidenceId:'T',quote}],
      formula:'27 × 5 = 135 卷',outputUnit:'卷',scopeEvidence:{evidenceId:'T',quote}}}};
  const old=validateClaim(f.standard.definitions[0]!,f.product.fields['roll.sales_count']!,f.product).find(i=>i.code==='CALCULATION_INPUT_NOT_QUOTED')!;
  expect(old).toBeDefined();
  const before=JSON.stringify(f), fixed=adaptLegacyQuantityIssue(old,f.product,f.standard);
  expect(fixed.severity).toBe('review');expect(fixed.adaptation).toBe('explicit_carton_expression_multiplier');expect(fixed.originalCheck).toEqual(old);expect(JSON.stringify(f)).toBe(before);
  for(const mode of ['ambiguous','wrong_result','wrong_formula','other_sku','fabricated_unit','different_source','untrusted_ocr']) {
    const x=structuredClone(f), field=x.product.fields['roll.sales_count']!,c=field.calculation!;
    if(mode==='ambiguous'){x.product.evidence[0]!.text='27卷*1*5';field.quote='27卷*1*5';c.scopeEvidence!.quote='27卷*1*5';c.inputs[1]!.quote='27卷*1*5';}
    if(mode==='wrong_result')field.value=136;
    if(mode==='wrong_formula')c.formula='27 × 6 = 135 卷';
    if(mode==='other_sku')x.product.evidence[0]!.productId='other';
    if(mode==='fabricated_unit')c.inputs[1]!.unit='箱';
    if(mode==='different_source')c.inputs[1]!.evidenceId='J';
    if(mode==='untrusted_ocr')x.product.evidence[0]!.kind='image_ocr';
    expect(adaptLegacyQuantityIssue(old,x.product,x.standard).severity).toBe('error');
  }
});
