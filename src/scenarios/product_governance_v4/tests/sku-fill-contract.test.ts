import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hashContract, hashSourceText, validateSkuFill } from '../sku-fill-contract';
import type { EvidenceReference, SkuFillInput, SkuFillRow, SkuSource, SourceReadState } from '../sku-fill-contract';
import { catalog, proposal } from './fixtures/type-contract';

// A portable excerpt; its provenance records the original contract hash, but
// only the fixture bytes (not the original 17 MB artifact) are verified here.
const focusedText = readFileSync(new URL('./fixtures/sku-fill-contract.json', import.meta.url), 'utf8');
const actual = JSON.parse(focusedText);
const fixtureSha256 = '747187f370cdc16b019e6db1553608fd723b8bdab161de20b384e99f83dc4318';
const ids = {
  box: '640b5b8b-9d6e-4784-a8e2-53c291f0b7f7',
  roll: '67adeef9-8c1f-47e2-ad72-462ad35a5a75',
  wipes: '7a1ea510-8777-46ba-bfa0-955b472a0d61',
  bag: 'c2861c74-b1ad-46e8-990e-bb4f68c7a7f7',
  soft: 'ce3a9f67-613c-4707-bf3a-95193edb8a2d',
};
function source(skuId: string, sourceId: string, text: string | null, field = '标题', readState: SourceReadState = text === null ? 'read_failed' : text === '' ? 'empty' : 'available'): SkuSource {
  return { sourceId, skuId, kind: 'fixture', field, text, readState, sha256: text === null ? null : hashSourceText(text), locator: `fixture:${sourceId}` };
}
function ref(s: SkuSource, quote: string): EvidenceReference {
  const start = s.text!.indexOf(quote);
  if (start < 0) throw new Error('fixture quote absent');
  return { sourceId: s.sourceId, quote, start, end: start + quote.length };
}
function input(categoryId: string, skuId: string, sources: SkuSource[], text = focusedText): SkuFillInput {
  const contract = JSON.parse(text);
  return {
    contractText: text, expectedContractSha256: hashContract(text), skus: [{ skuId, categoryId }], sources,
    rows: contract.proposals.filter((p: any) => p.categoryId === categoryId).map((p: any) => ({
      skuId, categoryId, attributeKey: p.key, status: 'missing', value: null, evidence: [],
    })),
  };
}
function setRow(data: SkuFillInput, key: string, patch: Partial<SkuFillRow>) {
  const row = data.rows.find(r => r.attributeKey === key);
  if (!row) throw new Error(`fixture attribute absent: ${key}`);
  Object.assign(row, patch);
  return row;
}
function resultFor(data: SkuFillInput, key: string) {
  return validateSkuFill(data).rows.find(r => r.original.attributeKey === key)!;
}
const codes = (row: ReturnType<typeof resultFor>) => row.blockingIssues.map(e => e.code);

function synthetic(attributes: any[]) {
  const text = JSON.stringify({ attributeContractVersion: 1, proposals: attributes, dictionaries: catalog() });
  const s = source('synthetic-sku', 'synthetic-source', '甲 乙 丙 灰色 否 0层');
  return input('offline-a', 'synthetic-sku', [s], text);
}

describe('V4 离线 SKU 建议及来源合同', () => {
  test('精简合同夹具文件哈希、全 SKU × 属性覆盖、重复与额外属性', () => {
    const s = source('sku-1', 'title-1', '盒装抽纸');
    expect(hashContract(focusedText)).toBe(fixtureSha256);
    expect(actual.provenance.sourceSha256).toBe('0a74bdd1ad5649d68c84e27e1e3938bff89c6f6c66b149eb8941b556c355fca2');
    expect(actual.provenance.sourcePath.startsWith('outputs/')).toBe(true);
    const data = input(ids.box, 'sku-1', [s]);
    data.expectedContractSha256 = fixtureSha256;
    const good = validateSkuFill(data);
    expect(good.contractSha256).toBe(fixtureSha256);
    expect(good.coverage.expected).toBe(actual.proposals.filter((p: any) => p.categoryId === ids.box).length);
    expect(good.structureValid).toBe(true);
    data.rows.pop();
    data.rows.push({ ...data.rows[0]! });
    data.rows.push({ skuId: 'sku-1', categoryId: ids.box, attributeKey: 'new_attribute', value: null, status: 'missing', evidence: [] });
    const failed = validateSkuFill(data);
    expect(failed.coverage).toMatchObject({ missing: 1, duplicates: 1, unexpected: 1 });
    expect(failed.structureValid).toBe(false);
    expect(failed.rows.filter(r => r.blockingIssues.some(e => e.code === 'duplicate_row'))).toHaveLength(2);
    data.expectedContractSha256 = '0'.repeat(64);
    expect(validateSkuFill(data).issues.map(e => e.code)).toContain('contract_hash');
    expect(validateSkuFill(data).rows.every(r => r.programStatus === 'blocked')).toBe(true);
  });

  test('重量对象确未明确时 needs_evidence 留空、保留证据且不填成确定值', () => {
    const s = source('8e55a0e9', 'roll-spec', '重量100g；另有21卷选项，所选规格未读取', '规格');
    const data = input(ids.roll, '8e55a0e9', [s]);
    const observation = { value: 100, normalization: { method: 'number' as const, evidenceIndex: 0, token: '100g' }, notes: '多个候选规格，重量未指明对应哪个所选对象' };
    setRow(data, 'mass', { value: null, status: 'needs_evidence', evidence: [ref(s, '100g')], observations: [observation], notes: '100g尚未对应到实际所选单卷对象' });
    let checked = resultFor(data, 'mass');
    expect(checked.blockingIssues).toEqual([]);
    expect(checked.programStatus).toBe('unresolved');
    expect(checked.original.value).toBeNull();
    expect(checked.original.observations).toEqual([observation]);
    expect(checked.original.evidence).toEqual([ref(s, '100g')]);
    expect(checked.reviewRequired).toBe(true);
    setRow(data, 'mass', { value: 100, normalization: { method: 'number', evidenceIndex: 0, token: '100g' } });
    checked = resultFor(data, 'mass');
    expect(checked.programStatus).toBe('blocked');
    expect(codes(checked)).toContain('unresolved_value');
    expect(checked.original.value).toBe(100);
    setRow(data, 'mass', { value: null, notes: '', evidence: [] });
    checked = resultFor(data, 'mass');
    expect(codes(checked)).toContain('reason_required');
    expect(codes(checked)).toContain('evidence_required');
  });

  test('用户32行：125g×36卷直接支持125g，不额外要求净重或含芯声明', () => {
    const s=source('b141d450','actual-selected-spec','6层 125g*36卷 【2250g*2提】','saleSpec');
    const data=input(ids.roll,'b141d450',[s]);
    setRow(data,'mass',{value:125,status:'proposed',evidence:[ref(s,'125g*36卷')],normalization:{method:'number',evidenceIndex:0,token:'125g'},notes:'所选规格直接标称每卷125g；非总重除算，不宣称实测净重。'});
    expect(resultFor(data,'mass').programStatus).toBe('awaiting_review');
    expect(resultFor(data,'mass').normalizationCheck).toBe('verified');
    setRow(data,'mass',{evidence:[ref(s,'2250g*2提')],normalization:{method:'number',evidenceIndex:0,token:'2250g'}});
    expect(codes(resultFor(data,'mass'))).toContain('number_value');
  });

  test('ac4497f4 标题 4 层、规格 3 层：保留两个跨度，已记录冲突不能任选', () => {
    const title = source('ac4497f4', 'ac-title', '得宝抽纸4层80抽');
    const spec = source('ac4497f4', 'ac-spec', '3层', '规格');
    const data = input(ids.box, 'ac4497f4', [title, spec]);
    const observations = [
      { value: 4, normalization: { method: 'number' as const, evidenceIndex: 0, token: '4层' } },
      { value: 3, normalization: { method: 'number' as const, evidenceIndex: 1, token: '3层' } },
    ];
    const original = setRow(data, 'layers', { value: null, status: 'conflict', evidence: [ref(title, '4层'), ref(spec, '3层')], observations, notes: '标题与规格的层数不一致' });
    let checked = resultFor(data, 'layers');
    expect(checked.programStatus).toBe('unresolved');
    expect(checked.blockingIssues).toEqual([]);
    expect(checked.original).toEqual(original);
    expect(checked.original.evidence).toHaveLength(2);
    setRow(data, 'layers', { value: 4, status: 'proposed', normalization: { method: 'number', evidenceIndex: 0, token: '4层' } });
    checked = resultFor(data, 'layers');
    expect(codes(checked)).toContain('observed_conflict');
    expect(checked.original.value).toBe(4);
    expect(checked.original.observations).toEqual(observations);
  });

  test('ebaecd90 的 50 只不是 50 L，尺寸不能推断容量', () => {
    const s = source('ebaecd90', 'bag-spec', '45*50cm（50只）', '规格');
    const data = input(ids.bag, 'ebaecd90', [s]);
    setRow(data, 'tw.c2861c74.538b634ddc9d', { value: 50, status: 'proposed', evidence: [ref(s, '50只')], normalization: { method: 'number', evidenceIndex: 0, token: '50只' } });
    const checked = resultFor(data, 'tw.c2861c74.538b634ddc9d');
    expect(codes(checked)).toContain('number_unit');
    expect(checked.original.value).toBe(50);
    setRow(data, 'tw.c2861c74.538b634ddc9d', { value: null, status: 'missing', evidence: [], normalization: undefined });
    expect(resultFor(data, 'tw.c2861c74.538b634ddc9d').programStatus).toBe('unresolved');
  });

  test('单卷与整包重量：单位换算可检，计量对象只能独立审校', () => {
    const s = source('8e55a0e9', 'roll-spec', '5层 100g*21卷，整包重2100g', '规格');
    const data = input(ids.roll, '8e55a0e9', [s]);
    setRow(data, 'mass', { value: 100, status: 'proposed', evidence: [ref(s, '100g')], normalization: { method: 'number', evidenceIndex: 0, token: '100g' } });
    let checked = resultFor(data, 'mass');
    expect(checked.normalizationCheck).toBe('verified');
    expect(checked.programStatus).toBe('awaiting_review');
    expect(checked.warnings.map(e => e.code)).toContain('semantic_review');
    setRow(data, 'mass', { value: 2100, evidence: [ref(s, '2100g')], normalization: { method: 'number', evidenceIndex: 0, token: '2100g' } });
    checked = resultFor(data, 'mass');
    // 2100g exists and its conversion is right; the program does NOT assert that
    // it means single-roll weight. The reviewer must reject this semantic error.
    expect(checked.programStatus).toBe('awaiting_review');
    expect(checked.reviewRequired).toBe(true);
    expect(checked.warnings.find(e => e.code === 'semantic_review')!.message).toContain('属性对象');
  });

  test('抽、张、层、包各自独立，中文数字可转换', () => {
    const s = source('acfbb32b', 'soft-title', '120抽*24包 三层 120张');
    const data = input(ids.soft, 'acfbb32b', [s]);
    setRow(data, 'tissue_qty', { value: 120, status: 'proposed', evidence: [ref(s, '120张')], normalization: { method: 'number', evidenceIndex: 0, token: '120张' } });
    expect(codes(resultFor(data, 'tissue_qty'))).toContain('number_unit');
    setRow(data, 'tissue_qty', { evidence: [ref(s, '24包')], normalization: { method: 'number', evidenceIndex: 0, token: '24包' } });
    expect(codes(resultFor(data, 'tissue_qty'))).toContain('number_unit');
    setRow(data, 'tissue_qty', { evidence: [ref(s, '120抽')], normalization: { method: 'number', evidenceIndex: 0, token: '120抽' } });
    expect(resultFor(data, 'tissue_qty').blockingIssues).toEqual([]);
    setRow(data, 'layers', { value: 3, status: 'proposed', evidence: [ref(s, '三层')], normalization: { method: 'number', evidenceIndex: 0, token: '三层' } });
    expect(resultFor(data, 'layers').normalizationCheck).toBe('verified');
  });

  test('数字无单位仅能从原字段标签明示单位转换，否则保留语义待核', () => {
    const labeled = source('labeled', 'labeled', '3', '层数（层）');
    const data = input(ids.box, 'labeled', [labeled]);
    setRow(data, 'layers', { value: 3, status: 'proposed', evidence: [ref(labeled, '3')], normalization: { method: 'number', evidenceIndex: 0, token: '3' } });
    expect(resultFor(data, 'layers').normalizationCheck).toBe('verified');
    labeled.field = '标题';
    expect(codes(resultFor(data, 'layers'))).toContain('number_unit');
    setRow(data, 'layers', { normalization: { method: 'semantic', reason: '结合字段内容解释；待独立核实' } });
    const result = resultFor(data, 'layers');
    expect(result.normalizationCheck).toBe('unverified');
    expect(result.programStatus).toBe('awaiting_review');
  });

  test('缺少来源的 false 和 0 不能当事实，空值和 false/0 有别', () => {
    const b = proposal('boolean'), n = proposal('number');
    n.typing.number.min = null;
    const data = synthetic([b, n]);
    setRow(data, b.key, { value: false, status: 'proposed', evidence: [], normalization: { method: 'semantic', reason: '不能从空证据推出' } });
    setRow(data, n.key, { value: 0, status: 'proposed', evidence: [], normalization: { method: 'semantic', reason: '不能从空证据推出' } });
    expect(codes(resultFor(data, b.key))).toContain('evidence_required');
    expect(codes(resultFor(data, n.key))).toContain('evidence_required');
    const s = data.sources[0]!;
    setRow(data, b.key, { evidence: [ref(s, '否')], normalization: { method: 'boolean_literal', evidenceIndex: 0 } });
    setRow(data, n.key, { evidence: [ref(s, '0层')], normalization: { method: 'number', evidenceIndex: 0, token: '0层' } });
    expect(resultFor(data, b.key).blockingIssues).toEqual([]);
    expect(resultFor(data, n.key).blockingIssues).toEqual([]);
    expect(resultFor(data, b.key).programStatus).toBe('awaiting_review');
    expect(resultFor(data, n.key).programStatus).toBe('awaiting_review');
  });

  test('包材尺寸的原文不自动证明纸张尺寸，始终保留语义审校', () => {
    const s = source('paper', 'package', '外包装尺寸18cm×12cm');
    const data = input(ids.box, 'paper', [s]);
    setRow(data, 'paper_size', { value: '18cm×12cm', status: 'proposed', evidence: [ref(s, '18cm×12cm')], normalization: { method: 'exact' } });
    const checked = resultFor(data, 'paper_size');
    expect(checked.normalizationCheck).toBe('verified');
    expect(checked.programStatus).toBe('awaiting_review');
    expect(checked.warnings.map(w => w.code)).toContain('semantic_review');
  });

  test('全粘胶保留原词，不能用原文直取伪造纯棉；语义改词未获程序验证', () => {
    const s = source('e36b6a2c', 'wipes-spec', '德佑超厚全粘胶珍珠纹洗脸巾');
    const data = input(ids.wipes, 'e36b6a2c', [s]);
    setRow(data, 'sheet_material', { value: '全粘胶', status: 'proposed', evidence: [ref(s, '全粘胶')], normalization: { method: 'exact' } });
    expect(resultFor(data, 'sheet_material').normalizationCheck).toBe('verified');
    setRow(data, 'sheet_material', { value: '纯棉' });
    expect(codes(resultFor(data, 'sheet_material'))).toContain('normalization_mismatch');
    setRow(data, 'sheet_material', { normalization: { method: 'semantic', reason: '错误示例，需独立否决' } });
    const pending = resultFor(data, 'sheet_material');
    expect(pending.normalizationCheck).toBe('unverified');
    expect(pending.reviewRequired).toBe(true);
  });

  test('单多选使用合同本类 allowedValues，域外不静默近似且保留原值', () => {
    const single = proposal('option'); single.typing.choice.allowedValues = ['甲'];
    const multi = proposal('option', 'multiple'); multi.typing.choice.allowedValues = ['甲', '乙'];
    const data = synthetic([single, multi]); const s = data.sources[0]!;
    setRow(data, single.key, { value: '乙', status: 'proposed', evidence: [ref(s, '乙')], normalization: { method: 'exact' } });
    expect(codes(resultFor(data, single.key))).toContain('attribute_value');
    setRow(data, single.key, { status: 'out_of_domain', notes: '原文乙在本类允许子集以外，保留待审' });
    const outside = resultFor(data, single.key);
    expect(outside.blockingIssues).toEqual([]);
    expect(outside.programStatus).toBe('unresolved');
    expect(outside.original.value).toBe('乙');
    setRow(data, multi.key, { value: ['甲', '乙'], status: 'proposed', evidence: [ref(s, '甲'), ref(s, '乙')], normalization: { method: 'exact' } });
    expect(resultFor(data, multi.key).blockingIssues).toEqual([]);
    setRow(data, multi.key, { value: ['甲', '丙'], evidence: [ref(s, '甲'), ref(s, '丙')] });
    expect(codes(resultFor(data, multi.key))).toContain('attribute_value');
  });

  test('字典只做冻结别名映射；数值枚举可按合同映射进行单位换算', () => {
    const dictionary = proposal('dictionary');
    const measurement = proposal('option');
    Object.assign(measurement, { unit: 'L', enumValues: ['1L', '2L'] });
    measurement.typing.choice.allowedValues = ['1L'];
    measurement.typing.choice.measurement = { unit: 'L', values: [{ option: '1L', value: 1 }, { option: '2L', value: 2 }] };
    const data = synthetic([dictionary, measurement]);
    const s = data.sources[0]!;
    s.text = '灰色 1000ml 2000ml'; s.sha256 = hashSourceText(s.text);
    setRow(data, dictionary.key, { value: 'gray', status: 'proposed', evidence: [ref(s, '灰色')], normalization: { method: 'dictionary_alias' } });
    expect(resultFor(data, dictionary.key).normalizationCheck).toBe('verified');
    setRow(data, dictionary.key, { value: 'black' });
    expect(codes(resultFor(data, dictionary.key))).toContain('dictionary_alias');
    setRow(data, measurement.key, { value: '1L', status: 'proposed', evidence: [ref(s, '1000ml')], normalization: { method: 'measurement_option', mappings: [{ value: '1L', evidenceIndex: 0, token: '1000ml' }] } });
    expect(resultFor(data, measurement.key).normalizationCheck).toBe('verified');
    setRow(data, measurement.key, { value: '2L', evidence: [ref(s, '2000ml')], normalization: { method: 'measurement_option', mappings: [{ value: '2L', evidenceIndex: 0, token: '2000ml' }] } });
    expect(codes(resultFor(data, measurement.key))).toContain('attribute_value');
  });

  test('来源哈希、精确跨度、SKU 归属和不可截取更大的数', () => {
    const s = source('one', 'source-one', '13层');
    const other = source('two', 'source-two', '3层');
    const data = input(ids.box, 'one', [s, other]);
    data.skus.push({ skuId: 'two', categoryId: ids.box });
    data.rows.push(...input(ids.box, 'two', [other]).rows);
    setRow(data, 'layers', { value: 3, status: 'proposed', evidence: [ref(other, '3层')], normalization: { method: 'number', evidenceIndex: 0, token: '3层' } });
    expect(codes(resultFor(data, 'layers'))).toContain('evidence_cross_sku');
    setRow(data, 'layers', { evidence: [ref(s, '3层')] });
    expect(codes(resultFor(data, 'layers'))).toContain('number_token_boundary');
    setRow(data, 'layers', { evidence: [{ ...ref(s, '13层'), quote: '3层' }] });
    expect(codes(resultFor(data, 'layers'))).toContain('evidence_span');
    s.sha256 = '0'.repeat(64);
    expect(codes(resultFor(data, 'layers'))).toContain('evidence_source_invalid');
    expect(validateSkuFill(data).issues.map(e => e.code)).toContain('source_hash');
  });

  test('失败或截断资料与已读后缺失区分；部分来源失败不阻断其他来源', () => {
    const failed = source('sku', 'failed', null, '摘要', 'read_failed');
    const data = input(ids.box, 'sku', [failed]);
    expect(codes(resultFor(data, 'layers'))).toContain('missing_without_read_source');
    setRow(data, 'layers', { status: 'read_failed', notes: '摘要接口未返回该 SKU' });
    expect(resultFor(data, 'layers').programStatus).toBe('unresolved');
    const truncated = source('sku', 'partial', '标题3层', '标题', 'truncated');
    data.sources.push(truncated);
    setRow(data, 'layers', { status: 'missing', notes: undefined });
    expect(codes(resultFor(data, 'layers'))).toContain('missing_without_read_source');
    const title = source('sku', 'complete', '标题三层', '标题');
    data.sources.push(title);
    const missing = resultFor(data, 'layers');
    expect(missing.blockingIssues).toEqual([]);
    expect(missing.warnings.map(w => w.code)).toContain('incomplete_sources');
    setRow(data, 'layers', { status: 'proposed', value: 3, evidence: [ref(title, '三层')], normalization: { method: 'number', evidenceIndex: 0, token: '三层' } });
    const proposed = resultFor(data, 'layers');
    expect(proposed.blockingIssues).toEqual([]);
    expect(proposed.warnings.map(w => w.code)).toContain('incomplete_sources');
    expect(proposed.programStatus).toBe('awaiting_review');
  });

  test('读取成功但字段值为 null 属于已读空值；没有候选时不声称规范化通过', () => {
    const s = source('empty-sku', 'empty-source', null, '规格', 'empty');
    const data = input(ids.box, 'empty-sku', [s]);
    const checked = resultFor(data, 'layers');
    expect(checked.programStatus).toBe('unresolved');
    expect(checked.normalizationCheck).toBe('not_applicable');
    expect(validateSkuFill(data).structureValid).toBe(true);
    setRow(data, 'layers', { status: 'proposed', value: 3 });
    expect(resultFor(data, 'layers').normalizationCheck).toBe('failed');
  });
});
