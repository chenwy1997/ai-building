import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashContract } from '../sku-fill-contract';
import { validateAttributeValue } from '../attribute-contract.mjs';
import { queryExtractionKnowledge, validateExtractionKnowledge } from '../sku-extraction-knowledge';
import { proposal } from './fixtures/type-contract';

const root = path.resolve(import.meta.dir, '..');
const fixture = () => {
  const a = { ...proposal('option', 'multiple'), categoryId: 'category-a', key: 'color', definitionId: 'definition-color', rules: ['旧规则'], shortRule: '旧规则', attention: '旧提示' };
  const b = { ...structuredClone(a), categoryId: 'category-b' };
  const contract = { attributeContractVersion: 1, proposals: [a, b], definitions: [{ id: 'definition-color', type: 'option', rule: '旧规则', options: [...a.enumValues], bindings: [
    { categoryId: 'category-a', key: 'color' }, { categoryId: 'category-b', key: 'color' },
  ] }] };
  const knowledge = { version: 1, packs: [
    { id: 'only-a', version: '1', categoryIds: ['category-a'], rules: [{ id: 'rule-a', definitionIds: ['definition-color'], description: 'unique A guidance' }] },
    { id: 'only-b', version: 1, categoryIds: ['category-b'], rules: [{ id: 'rule-b', definitionIds: ['definition-color'], description: 'unique B guidance' }] },
  ], enumExtensions: [{ definitionId: 'definition-color', categoryIds: ['category-a'], values: ['丙'], reason: '按该类证据单独审查', adoption: 'pending_human' }] };
  const policy = { version: 2, rulesByDefinitionId: { 'definition-color': { shortRule: '新规则', valuePolicy: {} } } };
  return { contract, knowledge, policy };
};
const save = (file: string, value: unknown) => { const text = JSON.stringify(value, null, 2) + '\n'; writeFileSync(file, text); return hashContract(text); };
const run = (...args: string[]) => Bun.spawnSync([process.execPath, ...args], { stdout: 'pipe', stderr: 'pipe' });

test('知识包校验版本、唯一性、已治理类目与定义，按类目和定义查询', () => {
  const { contract, knowledge } = fixture();
  validateExtractionKnowledge(knowledge, contract);
  expect(queryExtractionKnowledge(knowledge, { categoryIds: ['category-a'], definitionIds: ['definition-color'] }).packs.map((p: any) => p.id)).toEqual(['only-a']);
  expect(queryExtractionKnowledge(knowledge, { categoryIds: ['category-a'], definitionIds: ['unknown'] }).packs).toEqual([]);
  for (const change of [
    (k: any) => { k.version = 2; }, (k: any) => { k.packs[0].version = ''; },
    (k: any) => { k.packs[0].categoryIds = ['other']; }, (k: any) => { k.packs[0].rules[0].definitionIds = ['unknown']; },
    (k: any) => { k.enumExtensions[0].categoryIds = ['other']; },
  ]) { const bad = structuredClone(knowledge); change(bad); expect(() => validateExtractionKnowledge(bad, contract)).toThrow(); }
});

test('合同编译嵌入包与来源哈希、更新活动规则并保留历史，枚举仅指定类目放行', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sku-knowledge-'));
  try {
    const { contract, knowledge, policy } = fixture(), old = path.join(dir, 'old.json'), kn = path.join(dir, 'knowledge.json'), pol = path.join(dir, 'policy.json');
    save(old, contract); const kHash = save(kn, knowledge); save(pol, policy);
    const out = path.join(dir, 'out');
    const script = path.join(root, 'scripts/revise-sku-value-policy.ts');
    const r = run(script, '--contract', old, '--policy', pol, '--knowledge', kn, '--out', out);
    expect(r.exitCode).toBe(0);
    const c = JSON.parse(readFileSync(path.join(out, 'attribute-fill-contract.json'), 'utf8'));
    expect(c.extractionKnowledge).toMatchObject({ version: 1, sourceSha256: kHash, packs: knowledge.packs });
    expect(c.definitions[0].options).toEqual(['甲', '乙', '丙']);
    expect(c.definitions[0].bindings[0].allowedOptions).toEqual(['甲', '乙', '丙']);
    expect(c.definitions[0].bindings[1].allowedOptions).toEqual(['甲', '乙']);
    expect(c.definitions[0].previousOptions).toEqual(['甲', '乙']);
    expect(c.definitions[0].bindings.every((b: any) => b.allowedOptionsReferences.length > 0)).toBe(true);
    const [a, b] = c.proposals;
    expect(a.enumValues).toEqual(c.definitions[0].options); expect(b.enumValues).toEqual(c.definitions[0].options);
    expect(validateAttributeValue(a, ['丙'])).toEqual([]); expect(validateAttributeValue(b, ['丙']).length).toBeGreaterThan(0);
    expect(a).toMatchObject({ shortRule: '新规则', rules: ['新规则'], attention: '新规则', previousFillRules: { shortRule: '旧规则', rules: ['旧规则'], attention: '旧提示' } });
    expect(c.definitions[0]).toMatchObject({ rule: '新规则', previousFillRule: { rule: '旧规则' } });
    expect(run(script, '--contract', old, '--policy', pol, '--knowledge', kn, '--out', out).exitCode).not.toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('真实 CLI 从冻结合同按 SKU 范围加载对应包，并可按类目/定义查询', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sku-knowledge-context-'));
  try {
    const { contract, knowledge } = fixture(), cli = path.join(root, 'cli.ts');
    const full = { ...contract, extractionKnowledge: knowledge }, contractFile = path.join(dir, 'contract.json'), evidenceFile = path.join(dir, 'evidence.json');
    const cHash = save(contractFile, full), eHash = save(evidenceFile, { skus: [{ skuId: 'a', categoryId: 'category-a' }, { skuId: 'b', categoryId: 'category-b' }] });
    const inputs = path.join(dir, 'inputs.json'); save(inputs, { files: [{ role: 'skuEvidence', path: evidenceFile, sha256: eHash }, { role: 'fillContract', path: contractFile, sha256: cHash }] });
    for (const stage of ['extract', 'value-review']) {
      const out = path.join(dir, stage), p = run(cli, 'prepare', '--stage', stage, '--inputs', inputs, '--out', out, '--sku-offset', '1', '--sku-limit', '1');
      expect(p.exitCode).toBe(0);
      const ctx = readFileSync(path.join(out, 'context.md'), 'utf8');
      expect(ctx).toContain('unique B guidance'); expect(ctx).not.toContain('unique A guidance');
      const receipt = JSON.parse(readFileSync(path.join(out, 'context-manifest.json'), 'utf8'));
      expect(receipt.orderedFiles.at(-1)).toMatchObject({ role: 'extractionKnowledge', path: contractFile, sha256: cHash, skuCount: 1, packIds: ['only-b'] });
    }
    const q = run(cli, 'query', '--kind', 'extraction-knowledge', '--file', contractFile, '--category-id', 'category-a', '--definition-id', 'definition-color');
    expect(q.exitCode).toBe(0); expect(JSON.parse(q.stdout.toString()).packs.map((p: any) => p.id)).toEqual(['only-a']);
    expect(run(cli, 'prepare', '--stage', 'extract', '--inputs', inputs, '--out', path.join(dir, 'bad'), '--sku-id', 'missing').exitCode).not.toBe(0);
    const different = structuredClone(knowledge); different.packs[0]!.rules[0]!.description = 'changed';
    const knowledgeFile = path.join(dir, 'different.json'), kHash = save(knowledgeFile, different);
    const mismatchInputs = path.join(dir, 'mismatch.json'); save(mismatchInputs, { files: [
      { role: 'skuEvidence', path: evidenceFile, sha256: eHash }, { role: 'fillContract', path: contractFile, sha256: cHash },
      { role: 'extractionKnowledge', path: knowledgeFile, sha256: kHash },
    ] });
    const mismatch = run(cli, 'prepare', '--stage', 'extract', '--inputs', mismatchInputs, '--out', path.join(dir, 'mismatch'));
    expect(mismatch.exitCode).not.toBe(0); expect(mismatch.stderr.toString()).toContain('differs from the frozen fillContract');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
