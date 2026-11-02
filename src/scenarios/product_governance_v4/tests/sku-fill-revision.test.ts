import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assembleSkuFillRevision, serializeRevisionJson } from '../sku-fill-revision';
import type { RevisionInput } from '../sku-fill-revision';
import { hashContract, hashSourceText } from '../sku-fill-contract';
import { digest } from '../scripts/assemble-sku-fill';

const sha = (value: unknown) => hashContract(typeof value === 'string' ? value : serializeRevisionJson(value));
const fakeRef = (name: string) => ({ path: `${name}.json`, sha256: sha(name) });

function fixture(): RevisionInput {
  const proposals = [
    { categoryId: 'mall-a', key: 'old-fiber', name: '原类原料', type: 'text', definition: '原类', shortRule: '原规则' },
    { categoryId: 'mall-a', key: 'old-size', name: '原类规格', type: 'text', definition: '原类', shortRule: '原规则' },
    { categoryId: 'mall-b', key: 'target-fabric', name: '目标布料', type: 'text', definition: '目标类', shortRule: '目标规则' },
    { categoryId: 'mall-b', key: 'target-grade', name: '目标等级', type: 'text', definition: '目标类', shortRule: '目标规则' },
  ];
  const contractText = JSON.stringify({ attributeContractVersion: 1, proposals });
  const tree = { oldNodes: [
    { id: 'mall-a', mallCategoryId: 'mall-a', standardCategoryId: 'std-a', enabled: true, isLeaf: true, path: '日用>原类' },
    { id: 'mall-b', mallCategoryId: 'mall-b', standardCategoryId: 'std-b', enabled: true, isLeaf: true, path: '日用>目标类' },
    { id: 'mall-c', mallCategoryId: 'mall-c', standardCategoryId: 'std-c', enabled: true, isLeaf: true, path: '日用>无合同类' },
    { id: 'disabled', mallCategoryId: 'disabled', standardCategoryId: 'std-disabled', enabled: false, isLeaf: true, path: '日用>停用类' },
  ] };
  const skus = ['s1', 's2', 's3', 's4'].map(skuId => ({ skuId, categoryId: 'mall-a', category: '原类', path: '日用>原类', title: `标题 ${skuId}`, summaryStatus: 'ok' }));
  const sources = skus.map(s => ({ sourceId: `source-${s.skuId}`, skuId: s.skuId, kind: 'fixture', field: 'title',
    text: `商品 ${s.skuId} 棉`, sha256: hashSourceText(`商品 ${s.skuId} 棉`), readState: 'available' }));
  const evidence = (sku: string) => [{ sourceId: `source-${sku}`, start: 0, end: 2, quote: '商品' }];
  const rows = skus.flatMap(s => proposals.filter(p => p.categoryId === 'mall-a').map(p => ({ skuId: s.skuId, categoryId: 'mall-a',
    attributeKey: p.key, value: null, status: s.skuId === 's4' ? 'missing' : 'identity_review', evidence: [],
    ...(s.skuId === 's4' ? {} : { notes: '身份待核' }) })));
  const baseline = { contractPath: 'old-contract.json', contractSha256: sha(contractText), skus, sources, rows, limitations: ['来源尚未读完整详情'] };
  const refs = { baseline: fakeRef('baseline'), contract: { ...fakeRef('contract'), sha256: sha(contractText) }, tree: fakeRef('tree'),
    currentAuthor: fakeRef('current'), routing: fakeRef('routing'), targetAuthor: fakeRef('target') };
  const routing = { treeSource: refs.tree, contractSource: refs.contract, decisions: [
    { skuId: 's1', originalCategoryId: 'mall-a', decision: 'suggest', suggestedCategoryId: 'mall-b', suggestedCategory: '目标类', suggestedPath: '日用>目标类', reason: '依据原文建议目标类', evidence: evidence('s1'), hasGovernedAttributes: false, governedAttributeCount: 0 },
    { skuId: 's2', originalCategoryId: 'mall-a', decision: 'suggest', suggestedCategoryId: 'mall-c', suggestedCategory: '无合同类', suggestedPath: '日用>无合同类', reason: '依据原文建议无合同类', evidence: evidence('s2'), hasGovernedAttributes: true, governedAttributeCount: 100 },
    { skuId: 's3', originalCategoryId: 'mall-a', decision: 'unresolved', reason: '证据不足', evidence: evidence('s3'), alternatives: [{ categoryId: 'mall-b', category: '目标类', path: '日用>目标类', hasGovernedAttributes: false }] },
  ] };
  const targetAuthor = { rows: [
    { skuId: 's1', categoryId: 'mall-b', attributeKey: 'target-fabric', value: '棉', status: 'proposed',
      evidence: [{ sourceId: 'source-s1', start: 6, end: 7, quote: '棉' }], normalization: { method: 'exact' } },
    { skuId: 's1', categoryId: 'mall-b', attributeKey: 'target-grade', value: null, status: 'missing', evidence: [] },
  ] };
  return { references: refs, baseline, baselineContractText: contractText, contractText, tree,
    currentAuthor: { rows: structuredClone(rows) }, routing, targetAuthor };
}

test('按真实目录路由：已建模目标完整替换，无合同或待核保留原类，基线身份与来源不变', () => {
  const input = fixture(), { result, checks, authorRows, reviewBindings } = assembleSkuFillRevision(input);
  expect(result.reviewState).toBe('draft');
  expect(result.skus).toHaveLength(4);
  expect(result.skus[0]).toMatchObject({ skuId: 's1', categoryId: 'mall-b', category: '目标类', path: '日用>目标类',
    originalCategoryId: 'mall-a', originalCategory: '原类', originalPath: '日用>原类', activeAttributeBasis: 'suggested_governed', hasGovernedAttributes: true });
  expect(result.rows.filter((r: any) => r.skuId === 's1').map((r: any) => r.attributeKey)).toEqual(['target-fabric', 'target-grade']);
  expect(result.rows.find((r: any) => r.attributeKey === 'target-fabric')).toMatchObject({ attribute: '目标布料', rule: '目标规则', value: '棉' });
  expect(result.skus[1]).toMatchObject({ categoryId: 'mall-a', suggestedCategoryId: 'mall-c', hasGovernedAttributes: false,
    governedAttributeCount: 0, activeAttributeBasis: 'original_pending_category' });
  expect(result.rows.filter((r: any) => r.skuId === 's2').map((r: any) => r.attributeKey)).toEqual(['old-fiber', 'old-size']);
  expect(result.skus[2]).toMatchObject({ categoryId: 'mall-a', categoryDecision: 'unresolved', activeAttributeBasis: 'original_pending_category',
    categoryAlternatives: [{ categoryId: 'mall-b', hasGovernedAttributes: true, governedAttributeCount: 2 }] });
  expect(result.skus[3]).toMatchObject({ categoryId: 'mall-a', categoryDecision: 'not_evaluated', activeAttributeBasis: 'original' });
  expect(result.sources).toEqual(input.baseline.sources);
  expect(checks.routing).toMatchObject({ governedSuggested: 1, ungovernedSuggested: 1, baselineIdentityReviewSkus: 3 });
  expect(reviewBindings.bindings.authorRowsSha256).toBe(sha(serializeRevisionJson(authorRows)));
  expect(input.baseline.skus[0].categoryId).toBe('mall-a');
});

test('拒绝标准映射 ID、停用类、错误路径及原类不符；不能漏掉或重复身份待核 SKU', () => {
  for (const id of ['std-b', 'disabled', 'unknown']) {
    const input = fixture(); input.routing.decisions[0].suggestedCategoryId = id;
    expect(() => assembleSkuFillRevision(input)).toThrow('enabled real leaf');
  }
  const pathMismatch = fixture(); pathMismatch.routing.decisions[0].suggestedPath = '错路径';
  expect(() => assembleSkuFillRevision(pathMismatch)).toThrow('enabled real leaf');
  const originalMismatch = fixture(); originalMismatch.routing.decisions[0].originalCategoryId = 'mall-b';
  expect(() => assembleSkuFillRevision(originalMismatch)).toThrow('original SKU/category mismatch');
  const incomplete = fixture(); incomplete.routing.decisions.pop();
  expect(() => assembleSkuFillRevision(incomplete)).toThrow('Missing baseline identity-review SKU');
  const duplicate = fixture(); duplicate.routing.decisions.push(duplicate.routing.decisions[0]);
  expect(() => assembleSkuFillRevision(duplicate)).toThrow('duplicated SKU');
});

test('原类和目标类均要求全量且无重复，不允许无合同类或其他 SKU 混入目标行', () => {
  const originalMissing = fixture(); originalMissing.currentAuthor.rows.pop();
  expect(() => assembleSkuFillRevision(originalMissing)).toThrow('currentAuthor: SKU fill checks failed');
  const targetMissing = fixture(); targetMissing.targetAuthor.rows.pop();
  expect(() => assembleSkuFillRevision(targetMissing)).toThrow('targetAuthor: SKU fill checks failed');
  const targetDuplicate = fixture(); targetDuplicate.targetAuthor.rows.push(structuredClone(targetDuplicate.targetAuthor.rows[0]));
  expect(() => assembleSkuFillRevision(targetDuplicate)).toThrow('targetAuthor: SKU fill checks failed');
  const extraTarget = fixture(); extraTarget.targetAuthor.rows.push({ skuId: 's2', categoryId: 'mall-c', attributeKey: 'fake', status: 'missing', value: null, evidence: [] });
  expect(() => assembleSkuFillRevision(extraTarget)).toThrow('targetAuthor: SKU fill checks failed');
});

test('规则可修订，但合同已治理的类目和属性集合不可增加或删减', () => {
  const revised = fixture(), contract = JSON.parse(revised.contractText);
  contract.proposals[0].shortRule = '修订后的规则';
  revised.contractText = JSON.stringify(contract);
  revised.references.contract.sha256 = sha(revised.contractText);
  expect(assembleSkuFillRevision(revised).result.rows.find((r: any) => r.skuId === 's4' && r.attributeKey === 'old-fiber').rule).toBe('修订后的规则');
  contract.proposals.pop(); revised.contractText = JSON.stringify(contract); revised.references.contract.sha256 = sha(revised.contractText);
  expect(() => assembleSkuFillRevision(revised)).toThrow('preserve the baseline category/attribute set');
});

test('作者声明的基线和路由哈希过期时不接收，即使行数仍然一致', () => {
  const baseline = fixture(); baseline.currentAuthor.priorResultSha256 = '0'.repeat(64);
  expect(() => assembleSkuFillRevision(baseline)).toThrow('baseline hash is stale');
  const routing = fixture(); routing.targetAuthor.routingSha256 = '0'.repeat(64);
  expect(() => assembleSkuFillRevision(routing)).toThrow('routing hash is stale');
});

test('作者或类目路由跨 SKU 引文都阻断，作者无法补造来源', () => {
  const author = fixture(); author.targetAuthor.rows[0].evidence[0].sourceId = 'source-s2';
  expect(() => assembleSkuFillRevision(author)).toThrow('targetAuthor: SKU fill checks failed');
  const routing = fixture(); routing.routing.decisions[0].evidence[0].sourceId = 'source-s2';
  expect(() => assembleSkuFillRevision(routing)).toThrow('cross-SKU evidence');
  const injected = fixture(); injected.targetAuthor.additionalSources = [injected.baseline.sources[0]];
  expect(() => assembleSkuFillRevision(injected)).toThrow('cannot add sources');
});

test('独立审校锁定全体作者行、路由和合同，变更须匹配 beforeHash', () => {
  const input = fixture();
  input.targetAuthor.rows[0].independentChange = { reason: '旧批次审校记录' };
  const assembled = assembleSkuFillRevision(input), before = assembled.authorRows.rows[0];
  expect(assembled.result.rows[0].independentChange).toBeUndefined();
  expect(assembled.result.rows[0].previousIndependentChange.reason).toBe('旧批次审校记录');
  const review = { reviewType: 'independent', reviewer: '独立审校', method: '逐项核对来源', ...assembled.reviewBindings };
  const changes = [{ skuId: before.skuId, attributeKey: before.attributeKey, beforeHash: digest(JSON.stringify(before)),
    replacement: { ...before, value: null, status: 'needs_evidence', notes: '原文口径待核' }, reason: '来源不能证明目标属性口径' }];
  const deltas = { bindings: assembled.reviewBindings.bindings, changes };
  input.references.review = fakeRef('review'); input.references.deltas = fakeRef('deltas'); input.review = review; input.deltas = deltas;
  const reviewed = assembleSkuFillRevision(input).result;
  expect(reviewed.reviewState).toBe('reviewed');
  expect(reviewed.rows[0]).toMatchObject({ status: 'needs_evidence', value: null, independentChange: { originalValue: '棉' },
    previousIndependentChange: { reason: '旧批次审校记录' } });
  input.review = { ...review, bindings: { ...review.bindings, routingSha256: '0'.repeat(64) } };
  expect(() => assembleSkuFillRevision(input)).toThrow('bindings do not match');
  input.review = review; input.deltas = { ...deltas, changes: [{ ...changes[0], beforeHash: '0'.repeat(64) }] };
  expect(() => assembleSkuFillRevision(input)).toThrow('no longer matches author row');
  input.deltas = deltas; input.review = { ...review, reviewedRows: 1 };
  expect(() => assembleSkuFillRevision(input)).toThrow('coverage mismatch');
});

test('CLI 校验原文件哈希并产出可复用审校快照，输入变化或已存在文件时拒绝', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sku-revision-test-'));
  try {
    const f = fixture();
    const saveText = (name: string, text: string) => { const file = path.join(dir, `${name}.json`); writeFileSync(file, text); return { path: file, sha256: sha(text) }; };
    const save = (name: string, obj: unknown) => saveText(name, serializeRevisionJson(obj));
    const contract = saveText('contract', f.contractText), tree = save('tree', f.tree);
    f.baseline.contractPath = contract.path;
    f.routing.treeSource = tree; f.routing.contractSource = contract;
    const manifest = { version: 1, baseline: save('baseline', f.baseline), contract, tree, currentAuthor: save('current', f.currentAuthor),
      routing: save('routing', f.routing), targetAuthor: save('target', f.targetAuthor) };
    const manifestRef = save('manifest', manifest), output = path.join(dir, 'draft');
    const cli = path.resolve(import.meta.dir, '../scripts/revise-sku-fill.ts');
    const run = (out: string) => Bun.spawnSync(['bun', cli, '--manifest', manifestRef.path, '--out', out]);
    const first = run(output);
    expect(first.exitCode).toBe(0);
    const rowBytes = readFileSync(path.join(output, 'review/author-rows.json'));
    const bindings = JSON.parse(readFileSync(path.join(output, 'review/review-bindings.json'), 'utf8'));
    expect(bindings.bindings.authorRowsSha256).toBe(hashContract(rowBytes));
    expect(JSON.parse(readFileSync(path.join(output, 'review/sku-fill-results.json'), 'utf8')).sources).toEqual(f.baseline.sources);
    expect(run(output).exitCode).not.toBe(0);
    writeFileSync(manifest.currentAuthor.path, '{}');
    const stale = run(path.join(dir, 'stale'));
    expect(stale.exitCode).not.toBe(0);
    expect(stale.stderr.toString()).toContain('Stale input: currentAuthor');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
