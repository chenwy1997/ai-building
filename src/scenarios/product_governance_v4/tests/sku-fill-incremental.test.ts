import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assembleIncrementalSkuFillRevision, serializeRevisionJson } from '../sku-fill-revision';
import type { IncrementalRevisionInput } from '../sku-fill-revision';
import { hashContract, hashSourceText, validateSkuFill } from '../sku-fill-contract';
import { digest } from '../scripts/assemble-sku-fill';
import { proposal } from './fixtures/type-contract';

const sha = (value: string | Uint8Array) => hashContract(value);
const fakeRef = (name: string) => ({ path: `${name}.json`, sha256: sha(name) });
function fixture(): IncrementalRevisionInput {
  const p1 = { ...proposal('text'), categoryId: 'mall-a', key: 'a-text', definitionId: 'definition-a', name: '新名称', definition: '新定义', shortRule: '新规则' };
  const p2 = { ...proposal('option'), categoryId: 'mall-a', key: 'a-option', definitionId: 'definition-option' };
  const p3 = { ...proposal('text'), categoryId: 'mall-b', key: 'b-text', definitionId: 'definition-b' };
  const p4 = { ...proposal('text'), categoryId: 'mall-b', key: 'b-other', definitionId: 'definition-other' };
  const contractText = JSON.stringify({ attributeContractVersion: 1, proposals: [p1, p2, p3, p4], extractionKnowledge: { version: 1, packs: [
    { id: 'a-pack', version: '1', categoryIds: ['mall-a'], rules: [{ id: 'a-rule', definitionIds: ['definition-a'], description: '品类推断说明' },
      { id: 'option-rule', definitionIds: ['definition-option'], description: '品类选项推断' }] },
    { id: 'b-pack', version: 1, categoryIds: ['mall-b'], rules: [{ id: 'b-rule', definitionIds: ['definition-b'], description: '目标类推断' }] },
  ] } });
  const skus = ['s1', 's2'].map(skuId => ({ skuId, categoryId: 'mall-a', category: '甲类', path: '根>甲类', title: `商品${skuId}`,
    originalCategoryId: 'original', originalCategory: '旧类', originalPath: '根>旧类', categoryDecision: 'keep', categoryReason: '已有裁决', sourceCoverage: 'existing' }));
  const sources = skus.map(s => ({ sourceId: `source-${s.skuId}`, skuId: s.skuId, kind: 'title', field: 'title', text: '棉商品',
    sha256: hashSourceText('棉商品'), readState: 'available' as const }));
  const rows = skus.flatMap(s => [p1, p2].map(p => ({ skuId: s.skuId, categoryId: 'mall-a', attributeKey: p.key, value: null, status: 'missing' as const,
    evidence: [], rowMetadata: { retained: true }, ...(s.skuId === 's1' && p.key === p1.key ? { independentChange: { reason: '旧审校' } } : {}) })));
  const baseline = { contractPath: 'unavailable-old-contract.json', contractSha256: sha('old'), skus, sources, rows, sampling: { coverage: 'unchanged' },
    supplemental: { input: 'old' }, selectionSha256: 'old-selection', customMetadata: { retained: true }, limitations: ['旧限制'],
    review: { reviewType: 'independent', reviewer: '旧审校' }, changes: [{ reason: '旧变更' }] };
  const references = { baseline: fakeRef('baseline'), contract: { ...fakeRef('contract'), sha256: sha(contractText) }, patches: [fakeRef('patch')] };
  const patch = { baselineSha256: references.baseline.sha256, rows: [] };
  return { references, baseline, contractText, patches: [patch] };
}
function proposed(f: IncrementalRevisionInput, patch: any = {}) {
  return { ...f.baseline.rows[0], value: '纤维', status: 'proposed', evidence: [{ sourceId: 'source-s1', start: 0, end: 1, quote: '棉' }],
    normalization: { method: 'category_inference', packId: 'a-pack', ruleId: 'a-rule', reason: '类别及原文支持', assumptions: ['原文描述商品本体'] }, ...patch };
}
function validateInference(f: IncrementalRevisionInput, row = proposed(f)) {
  return validateSkuFill({ contractText: f.contractText, expectedContractSha256: f.references.contract.sha256,
    skus: f.baseline.skus, sources: f.baseline.sources, rows: [row, ...f.baseline.rows.slice(1)] });
}
function mutateContract(f: IncrementalRevisionInput, change: (x: any) => void) {
  const c = JSON.parse(f.contractText); change(c); f.contractText = JSON.stringify(c); f.references.contract.sha256 = sha(f.contractText);
}
const tree = { oldNodes: [
  { id: 'mall-a', mallCategoryId: 'mall-a', enabled: true, isLeaf: true, path: '根>甲类' },
  { id: 'mall-b', mallCategoryId: 'mall-b', enabled: true, isLeaf: true, path: '根>乙类' },
  { id: 'mall-c', mallCategoryId: 'mall-c', enabled: true, isLeaf: true, path: '根>未治理类' },
  { id: 'disabled', mallCategoryId: 'disabled', enabled: false, isLeaf: true, path: '根>停用类' },
] };
function route(f: IncrementalRevisionInput, row: any) {
  f.references.tree = fakeRef('tree'); f.tree = tree;
  f.references.routingPatch = fakeRef('route'); f.routingPatch = { rows: [row] };
}

test('知识包推断需同类与定义、理由假设和同 SKU 原文，始终语义未验证', () => {
  const f = fixture(), report = validateInference(f);
  expect(report.structureValid).toBe(true);
  expect(report.rows[0]!.normalizationCheck).toBe('unverified');
  expect(report.rows[0]!.warnings.some(x => x.code === 'semantic_normalization')).toBe(true);
  for (const bad of [
    { packId: 'b-pack', ruleId: 'b-rule' }, { packId: 'a-pack', ruleId: 'option-rule' },
    { packId: 'missing' }, { ruleId: 'missing' }, { assumptions: [] }, { assumptions: ['  '] }, { reason: '  ' },
  ]) {
    const row = proposed(f); Object.assign(row.normalization, bad);
    expect(validateInference(f, row).structureValid).toBe(false);
  }
  expect(validateInference(f, proposed(f, { evidence: [] })).structureValid).toBe(false);
  expect(validateInference(f, proposed(f, { evidence: [{ sourceId: 'source-s2', start: 0, end: 1, quote: '棉' }] })).structureValid).toBe(false);
  for (const alter of [(c: any) => { c.extractionKnowledge.version = 2; }, (c: any) => { c.extractionKnowledge.packs[0].version = ''; },
    (c: any) => { c.extractionKnowledge.packs[0].categoryIds = ['unknown']; },
    (c: any) => { c.extractionKnowledge.packs[0].rules[0].definitionIds = ['unknown']; }]) {
    const bad = fixture(); mutateContract(bad, alter); expect(validateInference(bad).structureValid).toBe(false);
  }
});

test('推断不绕过枚举、类型或观察候选类型检查', () => {
  const f = fixture(), optionRow = { ...f.baseline.rows[1], status: 'proposed', value: '域外', evidence: [{ sourceId: 'source-s1', start: 0, end: 1, quote: '棉' }],
    normalization: { method: 'category_inference', packId: 'a-pack', ruleId: 'option-rule', reason: '理由', assumptions: ['假设'] } };
  const base = { contractText: f.contractText, expectedContractSha256: f.references.contract.sha256, skus: f.baseline.skus, sources: f.baseline.sources };
  expect(validateSkuFill({ ...base, rows: [f.baseline.rows[0], optionRow, ...f.baseline.rows.slice(2)] }).structureValid).toBe(false);
  const observation = { ...optionRow, status: 'identity_review', value: null, notes: '待核', observations: [{ value: 23, normalization: optionRow.normalization }] };
  expect(validateSkuFill({ ...base, rows: [f.baseline.rows[0], observation, ...f.baseline.rows.slice(2)] }).structureValid).toBe(false);
});

test('增量保留未改行、来源、选择及原始类目元数据，更新合同字段并转存旧审校', () => {
  const f = fixture(); f.baseline.rows[0].humanDecision = '历史接受';
  const p = proposed(f); f.patches[0].rows.push(p);
  const assembled = assembleIncrementalSkuFillRevision(f);
  expect(assembled.result).toMatchObject({ sampling: f.baseline.sampling, supplemental: f.baseline.supplemental, selectionSha256: 'old-selection', customMetadata: { retained: true }, adoption: 'pending_human', productionWrites: 0, reviewState: 'draft' });
  expect(assembled.result.skus).toEqual(f.baseline.skus);
  expect(assembled.result.sources).toEqual(f.baseline.sources);
  expect(assembled.result.rows[0]).toMatchObject({ value: '纤维', attribute: '新名称', definitionId: 'definition-a', definition: '新定义', rule: '新规则', rowMetadata: { retained: true }, independentChangeHistory: [{ reason: '旧审校' }], humanDecisionHistory: ['历史接受'], humanDecision: '' });
  expect(assembled.result.rows[0].independentChange).toBeUndefined();
  expect((assembled.authorRows.rows[0] as any).independentChange).toBeUndefined();
  expect(assembled.authorRows.rows[0].independentChangeHistory).toEqual([{ reason: '旧审校' }]);
  expect(assembled.result.rows[1]).toMatchObject(f.baseline.rows[1]);
  expect(assembled.checks.authorRows.rows[0].normalizationCheck).toBe('unverified');
  expect(assembled.reviewBindings.bindings.authorRowsSha256).toBe(sha(serializeRevisionJson(assembled.authorRows)));
  expect(f.baseline.rows[0].independentChange).toEqual({ reason: '旧审校' });
});

test('补充 OCR 为同 SKU 新来源，不覆盖旧来源且不能扩增样本', () => {
  const f = fixture(); f.references.supplementalSources = fakeRef('sources');
  const extra = { sourceId: 'ocr-s1', skuId: 's1', kind: 'user_image_ocr', field: 'image', text: '棉', sha256: hashSourceText('棉'), readState: 'available' };
  f.supplementalSources = { sources: [extra] };
  f.patches[0].rows.push(proposed(f, { evidence: [{ sourceId: 'ocr-s1', start: 0, end: 1, quote: '棉' }] }));
  expect(assembleIncrementalSkuFillRevision(f).result.sources).toEqual([...f.baseline.sources, extra]);
  f.supplementalSources.sources[0].sourceId = 'source-s1';
  expect(() => assembleIncrementalSkuFillRevision(f)).toThrow('cannot replace or duplicate');
  f.supplementalSources.sources[0] = { ...extra, skuId: 'new-sku' };
  expect(() => assembleIncrementalSkuFillRevision(f)).toThrow('existing SKU');
});

test('替换行必须严格匹配基线、不重复，修改基线哈希会阻断', () => {
  const f = fixture(); f.patches[0].rows.push(proposed(f));
  f.patches[0].baselineSha256 = '0'.repeat(64); expect(() => assembleIncrementalSkuFillRevision(f)).toThrow('baseline hash is stale');
  f.patches[0].baselineSha256 = f.references.baseline.sha256;
  f.patches[0].rows.push(proposed(f)); expect(() => assembleIncrementalSkuFillRevision(f)).toThrow('Unknown or repeated');
  f.patches[0].rows.pop(); f.patches[0].rows[0].attributeKey = 'new-key'; expect(() => assembleIncrementalSkuFillRevision(f)).toThrow('Unknown or repeated');
  f.patches[0].rows[0].attributeKey = 'a-text'; f.patches[0].rows[0].skuId = 'new-sku'; expect(() => assembleIncrementalSkuFillRevision(f)).toThrow('Unknown or repeated');
});

test('只建议真实目标时继续填当前类；明确切换时必须全量目标属性且历史类目信息保留', () => {
  const f = fixture(); f.patches[0].rows.push(proposed(f));
  route(f, { skuId: 's1', suggestedCategoryId: 'mall-c', categoryDecision: 'suggest', categoryReason: '疑似错挂' });
  let result = assembleIncrementalSkuFillRevision(f).result;
  expect(result.skus[0]).toMatchObject({ categoryId: 'mall-a', suggestedCategoryId: 'mall-c', categoryDecision: 'suggest',
    originalCategoryId: 'original', originalCategory: '旧类', originalPath: '根>旧类', activeAttributeBasis: 'original_pending_category',
    categoryDecisionHistory: [{ categoryDecision: 'keep', categoryReason: '已有裁决' }] });
  expect(result.rows[0].value).toBe('纤维'); expect(result.skus[1]).toEqual(f.baseline.skus[1]);
  f.patches[0].rows = [];
  const targetRows = ['b-text', 'b-other'].map(attributeKey => ({ skuId: 's1', categoryId: 'mall-b', attributeKey, status: 'missing', value: null, evidence: [] }));
  f.routingPatch.rows[0] = { skuId: 's1', suggestedCategoryId: 'mall-b', activeCategoryId: 'mall-b', categoryDecision: 'suggest', categoryReason: '明确目标', rows: targetRows };
  result = assembleIncrementalSkuFillRevision(f).result;
  expect(result.skus[0]).toMatchObject({ categoryId: 'mall-b', category: '乙类', path: '根>乙类', originalCategoryId: 'original' });
  expect(result.rows.filter((r: any) => r.skuId === 's1').map((r: any) => r.attributeKey)).toEqual(['b-text', 'b-other']);
  targetRows.pop(); expect(() => assembleIncrementalSkuFillRevision(f)).toThrow('authorRows: SKU fill checks failed');
  f.routingPatch.rows[0].categoryDecision = 'unresolved';
  expect(() => assembleIncrementalSkuFillRevision(f)).toThrow('unresolved or keep decisions cannot switch');
  f.routingPatch.rows[0].categoryDecision = 'suggest';
  f.routingPatch.rows[0].activeCategoryId = 'mall-c'; f.routingPatch.rows[0].suggestedCategoryId = 'mall-c';
  expect(() => assembleIncrementalSkuFillRevision(f)).toThrow('no governed attributes');
  f.routingPatch.rows[0].activeCategoryId = 'disabled'; f.routingPatch.rows[0].suggestedCategoryId = 'disabled';
  expect(() => assembleIncrementalSkuFillRevision(f)).toThrow('enabled real leaf');
});

test('类目建议禁止依赖图片或网页OCR，商品文本与网页文字仍可用', () => {
  const f=fixture(); f.references.supplementalSources=fakeRef('category-sources');
  const extra={sourceId:'online-s1',skuId:'s1',kind:'web',field:'parameter',text:'棉商品',sha256:hashSourceText('棉商品'),readState:'available'};
  f.supplementalSources={sources:[extra]};
  route(f,{skuId:'s1',suggestedCategoryId:'mall-c',categoryDecision:'suggest',categoryReason:'文字说明商品类型',categoryEvidence:[{sourceId:'online-s1',start:0,end:3,quote:'棉商品'}]});
  expect(assembleIncrementalSkuFillRevision(f).result.skus[0].categoryDecision).toBe('suggest');
  for(const update of [{kind:'user_image_manual_observation'},{kind:'web',extractionMethod:'ocr'},{kind:'image',extractionMethod:'visual'}]){
    f.supplementalSources.sources[0]={...extra,...update};
    expect(()=>assembleIncrementalSkuFillRevision(f)).toThrow('image evidence is reference only');
  }
  f.routingPatch.rows[0].categoryEvidence=[{sourceId:'source-s1',start:0,end:3,quote:'棉商品'}];
  expect(assembleIncrementalSkuFillRevision(f).result.skus[0].categoryDecision).toBe('suggest');
});

test('只更新已切换类目的理由时保留活动属性依据，反证备注另外保留', () => {
  const f=fixture();f.baseline.skus[0].activeAttributeBasis='suggested_governed';
  route(f,{skuId:'s1',suggestedCategoryId:'mall-a',categoryDecision:'suggest',categoryReason:'同型号商品资料标明类型',categoryReviewNotes:['另有一条资料不同，待人审'],categoryEvidence:[{sourceId:'source-s1',start:0,end:3,quote:'棉商品'}]});
  const result=assembleIncrementalSkuFillRevision(f).result;
  expect(result.skus[0].activeAttributeBasis).toBe('suggested_governed');
  expect(result.skus[0].categoryReviewNotes).toEqual(['另有一条资料不同，待人审']);
  expect(result.skus[0].categoryDecisionHistory.at(-1).activeAttributeBasis).toBe('suggested_governed');
});

test('独立审校绑定全部输入哈希、作者行及覆盖，逐行 beforeHash 必须一致', () => {
  const f = fixture(); f.patches[0].rows.push(proposed(f));
  const draft = assembleIncrementalSkuFillRevision(f), before = draft.authorRows.rows[0]!;
  const review = { reviewType: 'independent', reviewer: '审校者', method: '逐行核对', ...draft.reviewBindings };
  const deltas = { bindings: draft.reviewBindings.bindings, changes: [{ skuId: before.skuId, attributeKey: before.attributeKey,
    beforeHash: digest(JSON.stringify(before)), reason: '证据不足', replacement: { ...before, value: null, status: 'needs_evidence', notes: '待核' } }] };
  f.references.review = fakeRef('review'); f.references.deltas = fakeRef('deltas'); f.review = review; f.deltas = deltas;
  const result = assembleIncrementalSkuFillRevision(f).result;
  expect(result.reviewState).toBe('reviewed'); expect(result.rows[0].independentChange.reason).toBe('证据不足');
  expect(result.rows[0].independentChangeHistory).toEqual([{ reason: '旧审校' }]);
  for (const field of ['baselineSha256', 'contractSha256', 'patchesSha256', 'supplementalSourcesSha256', 'routingPatchSha256', 'treeSha256', 'authorRowsSha256']) {
    f.review = { ...review, bindings: { ...review.bindings, [field]: field === 'patchesSha256' ? ['0'.repeat(64)] : '0'.repeat(64) } };
    expect(() => assembleIncrementalSkuFillRevision(f)).toThrow('bindings do not match');
  }
  f.review = { ...review, reviewedSkuCount: 1 }; expect(() => assembleIncrementalSkuFillRevision(f)).toThrow('coverage mismatch');
  f.review = { ...review, reviewedRows: 1 }; expect(() => assembleIncrementalSkuFillRevision(f)).toThrow('coverage mismatch');
  f.review = { ...review, proposedReviewed: 0 }; expect(() => assembleIncrementalSkuFillRevision(f)).toThrow('coverage mismatch');
  f.review = review; f.deltas = { ...deltas, changes: [{ ...deltas.changes[0], beforeHash: '0'.repeat(64) }] };
  expect(() => assembleIncrementalSkuFillRevision(f)).toThrow('no longer matches author row');
});

test('v2 CLI 验证磁盘哈希、支持独立审校及拒绝覆写输出', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sku-incremental-test-'));
  try {
    const f = fixture();
    const saveText = (name: string, text: string) => { const file = path.join(dir, `${name}.json`); writeFileSync(file, text); return { path: file, sha256: sha(text) }; };
    const save = (name: string, data: unknown) => saveText(name, serializeRevisionJson(data));
    const contract = saveText('contract', f.contractText), baseline = save('baseline', f.baseline);
    f.patches[0].baselineSha256 = baseline.sha256; f.patches[0].rows.push(proposed(f));
    const patch = save('patch', f.patches[0]), manifest = { version: 2, baseline, contract, patches: [patch] };
    const manifestRef = save('manifest', manifest), output = path.join(dir, 'draft');
    const cli = path.resolve(import.meta.dir, '../scripts/revise-sku-fill.ts');
    const run = (manifestPath: string, out: string) => Bun.spawnSync(['bun', cli, '--manifest', manifestPath, '--out', out]);
    expect(run(manifestRef.path, output).exitCode).toBe(0);
    const bindings = JSON.parse(readFileSync(path.join(output, 'review/review-bindings.json'), 'utf8'));
    expect(bindings.bindings.authorRowsSha256).toBe(sha(readFileSync(path.join(output, 'review/author-rows.json'))));
    expect(run(manifestRef.path, output).exitCode).not.toBe(0);
    const review = save('review', { ...bindings, reviewType: 'independent', reviewer: '审校者', method: '逐行审阅' });
    const deltas = save('deltas', { bindings: bindings.bindings, changes: [] });
    const reviewManifest = save('review-manifest', { ...manifest, review, deltas });
    const final = path.join(dir, 'final'); expect(run(reviewManifest.path, final).exitCode).toBe(0);
    expect(JSON.parse(readFileSync(path.join(final, 'review/sku-fill-results.json'), 'utf8')).reviewState).toBe('reviewed');
    writeFileSync(patch.path, '{}'); const stale = run(manifestRef.path, path.join(dir, 'stale'));
    expect(stale.exitCode).not.toBe(0); expect(stale.stderr.toString()).toContain('Stale input: patches[0]');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('图片读取状态只依据已识别内容与区域，不因存在图片URL宣称已读', () => {
 const f=fixture();
 f.references.supplementalSources=fakeRef('image-sources');
 f.supplementalSources={sources:[{sourceId:'image-read',skuId:'s1',kind:'user_image_manual_observation',field:'visual',text:'粉色短手柄',sha256:hashSourceText('粉色短手柄'),readState:'available',region:'主体滚筒及手柄',imageSha256:'a'.repeat(64),extractionMethod:'manual_visual_transcription'}, {sourceId:'image-url',skuId:'s2',kind:'image',field:'mainImage',text:null,sha256:null,readState:'image_only',locator:'https://example.com/p.png'}]};
 const result=assembleIncrementalSkuFillRevision(f).result;
 expect(result.skus[0]).toMatchObject({imageRecognized:true,imageReadScope:'referenced_regions_only',allImagesRecognized:false,recognizedImageSourceIds:['image-read']});
 expect(result.skus[1].imageRecognized).toBeUndefined();
 expect(f.baseline.skus[0].imageRecognized).toBeUndefined();
});
