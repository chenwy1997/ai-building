import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assemble, fileHash, loadSelection, readJson, semanticHash, writeJson } from '../core';
import { catalog, proposal } from './fixtures/type-contract';
import { typeSelection } from './fixtures/type-selection';

const root = path.resolve(import.meta.dir, '..');
const policy = await readJson(path.join(root, 'knowledge/field-ownership.json'));
const dirs: string[] = [];
async function directory() { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'v4-type-wiring-')); dirs.push(d); return d; }
afterEach(async () => { for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });
async function cli(...args: string[]) {
  const proc = Bun.spawn([process.execPath, path.join(root, 'cli.ts'), ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code, stdout, stderr };
}
const legacy = () => { const p = proposal(); for (const k of ['typing', 'definitionId', 'definitionVersion', 'valueExamples']) delete p[k]; return p; };

test('实际 prepare 五阶段接入类型合同和对应skill，填值阶段加载提取规范且动态文件固定哈希', async () => {
  const dir = await directory(), file = path.join(dir, 'dictionaries.json'); await writeJson(file, catalog());
  const inputs = path.join(dir, 'inputs.json'); await writeJson(inputs, { files: [{ path: 'dictionaries.json', role: 'dictionaries', sha256: await fileHash(file) }] });
  for (const stage of ['research', 'model', 'review', 'extract', 'value-review']) {
    const out = path.join(dir, stage), result = await cli('prepare', '--stage', stage, '--inputs', inputs, '--out', out);
    expect(result.code).toBe(0);
    const context = await fs.readFile(path.join(out, 'context.md'), 'utf8');
    expect(context).toContain('属性类型与取值合同 v1'); expect(context).toContain('typing.choice');
    expect(context).toContain('采购意图与专业来源'); expect(context).toContain('source-priority');
    expect(context).toContain('review_new_version'); expect(context).toContain('industrial_mro');
    const receipt = await readJson(path.join(out, 'context-manifest.json'));
    expect(receipt.orderedFiles.some((r: any) => r.path.endsWith('attribute-type-contract.md'))).toBe(true);
    expect(receipt.orderedFiles.some((r: any) => r.path.endsWith('source-priority-policy.json'))).toBe(true);
    expect(receipt.orderedFiles.some((r: any) => r.path.endsWith('procurement-and-source-policy.md'))).toBe(true);
    expect(receipt.orderedFiles.at(-1)).toMatchObject({ path: file, role: 'dictionaries', sha256: await fileHash(file) });
    expect(receipt.loading).toBe('prepared_not_proof_of_agent_read');
    if (['extract','value-review'].includes(stage)) {
      expect(context).toContain('SKU 属性提取与填写规范');
      expect(receipt.orderedFiles.some((r:any)=>r.path.endsWith('sku-extraction-standard.md'))).toBe(true);
      expect(receipt.orderedFiles.some((r:any)=>r.path.endsWith(stage==='extract'?'sku-extraction/SKILL.md':'sku-value-review/SKILL.md'))).toBe(true);
    } else expect(receipt.orderedFiles.some((r:any)=>r.path.endsWith('sku-extraction-standard.md'))).toBe(false);
  }
  await writeJson(file, { ...catalog(), tampered: true });
  const stale = await cli('prepare', '--inputs', inputs, '--out', path.join(dir, 'stale'));
  expect(stale.code).toBe(1); expect(stale.stderr).toContain('Stale dynamic input');
}, 20000);

test('真实CLI查询字典别名与版本；严格检查拒绝错误示例及缺版本，旧稿盘点不冒称通过', async () => {
  const dir = await directory(), dicts = path.join(dir, 'dicts.json'), draft = path.join(dir, 'draft.json');
  await writeJson(dicts, catalog());
  const found = await cli('query', '--kind', 'dictionary', '--file', dicts, '--dictionary-id', 'test.color', '--version', '1', '--text', '灰色');
  expect(found.code).toBe(0); expect(JSON.parse(found.stdout).rows[0].id).toBe('gray');
  const p = proposal('dictionary'); await writeJson(draft, { attributeContractVersion: 1, proposals: [p], dictionaries: catalog() });
  const valid = await cli('check-types', '--file', draft); expect(valid.code).toBe(0); expect(JSON.parse(valid.stdout).checked).toBe(1);
  p.valueExamples[0].value = '灰色'; await writeJson(draft, { attributeContractVersion: 1, proposals: [p], dictionaries: catalog() });
  const invalid = await cli('check-types', '--file', draft); expect(invalid.code).toBe(1); expect(JSON.parse(invalid.stdout).errors.some((e: any) => e.kind === 'attribute_example')).toBe(true);
  await writeJson(draft, { proposals: [proposal()] });
  const version = await cli('check-types', '--file', draft); expect(version.code).toBe(1); expect(JSON.parse(version.stdout).errors.some((e: any) => e.kind === 'attribute_contract_version')).toBe(true);
  await writeJson(draft, { proposals: [legacy()] });
  const old = await cli('inspect-types', '--file', draft); expect(old.code).toBe(0); expect(JSON.parse(old.stdout)).toMatchObject({ status: 'legacy_unreviewed', legacy: 1, checked: 0 });
  expect((await cli('check-types', '--file', draft)).code).toBe(1);
}, 20000);

test('真实assemble跨组检查共享定义和必填，字典清单变更不能绕过输入固定', async () => {
  const dir = await directory(), a = proposal('dictionary'), b = { ...structuredClone(a), categoryId: 'offline-b', category: '另一验收类目' };
  const selection = await typeSelection(dir, [[a], [b]]);
  const result = await assemble(selection.manifest, path.join(dir, 'good'), policy); expect(result.proposals).toBe(2);
  const plan = await readJson(path.join(dir, 'good', 'attribute-proposals.json')); expect(plan.typeChecks.checked).toBe(2); expect(plan.dictionaries).toEqual(catalog());
  b.required = true;
  const conflict = await typeSelection(dir, [[a], [b]]);
  await expect(assemble(conflict.manifest, path.join(dir, 'bad'), policy)).rejects.toThrow('checks failed');
  const checks = await readJson(path.join(dir, 'bad', 'assembly-checks.json')); expect(checks.errors.some((e: any) => e.kind === 'shared_required_conflict')).toBe(true);
  await writeJson(path.join(dir, 'dictionaries.json'), { version: 1, dictionaries: [] });
  await expect(loadSelection(selection.manifest)).rejects.toThrow('Input changed after selection');
});

test('真实基线类型升级须明确变更清单，旧稿原样保留但不算类型已复核', async () => {
  const dir = await directory(), old = legacy(), next = proposal();
  const preserved = { ...legacy(), categoryId: 'offline-b', category: '旧稿验收类目' };
  const first = await typeSelection(dir, [[next]], [old, preserved]);
  await expect(assemble(first.manifest, path.join(dir, 'unrequested'), policy)).rejects.toThrow('checks failed');
  const second = await typeSelection(dir, [[next]], [old, preserved], [{ categoryId: old.categoryId, key: old.key, beforeHash: semanticHash(old), reason: '离线测试类型升级' }]);
  const out = path.join(dir, 'changed'); await assemble(second.manifest, out, policy);
  const plan = await readJson(path.join(out, 'attribute-proposals.json'));
  expect(plan.proposals.find((p: any) => p.categoryId === 'offline-a')).toMatchObject({ v4Disposition: '本轮修改待审', previousDefinition: old });
  expect(plan.proposals.find((p: any) => p.categoryId === 'offline-b')).toMatchObject({ v4Disposition: '既有已认可' });
  expect(plan.typeChecks).toMatchObject({ checked: 1, legacy: 1 }); expect(plan.warnings.some((w: any) => w.kind === 'legacy_type_unreviewed')).toBe(true);
  const before = semanticHash(preserved); expect(semanticHash(plan.proposals.find((p: any) => p.categoryId === 'offline-b'))).toBe(before);
  second.config.proposedBaselineChanges[0].beforeHash = 'wrong'; await writeJson(second.manifest, second.config);
  await expect(assemble(second.manifest, path.join(dir, 'wrong-hash'), policy)).rejects.toThrow('checks failed');
});

test('六类表达从实际 CLI check 整合，所有新增仍待审，不发生模型或生产调用', async () => {
  const dir = await directory();
  const ps = [['text','single'],['number','single'],['boolean','single'],['option','single'],['option','multiple'],['dictionary','single'],['dictionary','multiple']].map(([type,mode]) => proposal(type,mode));
  const { manifest } = await typeSelection(dir, [ps]);
  const out = path.join(dir, 'assembled'), result = await cli('check', '--manifest', manifest, '--out', out);
  expect(result.code).toBe(0); expect(JSON.parse(result.stdout).proposals).toBe(7);
  const plan = await readJson(path.join(out, 'attribute-proposals.json'));
  expect(plan.typeChecks.errors).toEqual([]); expect(plan.proposals.every((p: any) => p.v4Disposition === '本轮新增待审' && !p.humanDecision)).toBe(true);
  expect(plan.deepseekRequests).toBe(0); expect(plan.productionWrites).toBe(0);
}, 20000);
