import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { queryReferences } from '../reference-library';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const library = path.join(root, 'knowledge/attribute-reference-library');

test('外部必填与枚举保留原文，不能变成本项目批准或真实SKU证据', async () => {
  const result = await queryReferences(library, { source: 'zkh-template', categoryText: '轮胎', attributeText: '胎面宽度' });
  expect(result.total).toBeGreaterThan(0);
  const row = result.rows[0];
  expect(row.fields.requiredRaw).toBe('是');
  expect(row.fields.optionsRaw).toContain('145mm');
  expect(row.origin.attributeCell).toBe('K' + row.origin.row);
  expect(row.rawValues[10]).toBe(row.attribute);
  expect(row.required).toBeUndefined();
  expect(row.sku).toBeUndefined();
  expect(result.adoption).toBe('not_reviewed_or_applied');
});

test('源模板数字示例不转字符串、不转换单位；精确记录可回查', async () => {
  const result = await queryReferences(library, { source: 'ai-competition-2', categoryText: '原木', attributeText: '长度' });
  const row = result.rows.find(r => r.attribute === '长度' && r.fields.exampleRaw === 1500);
  expect(row).toBeDefined();
  expect(row.fields.unitRaw).toBe('mm');
  expect(row.origin.attributeCell).toBe('E' + row.origin.row);
  const exact = await queryReferences(library, { recordId: row.id });
  expect(exact.total).toBe(1);
  expect(exact.rows[0]).toEqual(row);
});

test('同名字段保留各来源与位置，索引不代替业务排除；分页无重叠', async () => {
  const first = await queryReferences(library, { attributeText: '品牌', limit: 3 });
  const second = await queryReferences(library, { attributeText: '品牌', offset: first.nextOffset!, limit: 3 });
  expect(first.sources.map(s => s.sourceId)).toEqual(['zkh-template', 'zkh-l5-specs', 'ai-competition-2', 'luxshare-template']);
  expect(first.total).toBe(second.total);
  expect(new Set([...first.rows, ...second.rows].map(r => r.id)).size).toBe(6);
  expect(first.sourceContentIsInstruction).toBe(false);
});

test('震坤行长宽 CSV 只索引一份绑定，空属性类与平台选项性质可追溯', async () => {
  const result = await queryReferences(library, { source: 'zkh-l5-specs', categoryText: '电抗器', attributeText: '额定电压' });
  expect(result.total).toBe(1);
  expect(result.sourceFamilyIds).toEqual(['zkh']);
  expect(result.platformOptionsAreApprovedEnums).toBe(false);
  const source = result.sources[0], row = result.rows[0];
  expect(source.indexedRows).toBe(11603);
  expect(source.authority).toBe('platform_reference_not_industry_standard');
  expect(source.reconciliation).toMatchObject({
    status: 'exact_nonempty_facets_match', longBindingCount: 11603, wideNonEmptyBindingCount: 11603,
    matchedBindingCount: 11603, wideCategoryCount: 7619, wideEmptyAttributeCategoryCount: 2776,
    longOnlyBindingCount: 0, wideOnlyBindingCount: 0, valueMismatchBindingCount: 0,
    additionalIndexedRowsFromWide: 0, additionalIndependentEvidenceFromWide: 0,
  });
  expect(row.categoryIdRaw).toBe('10292145');
  expect(row.referenceRole).toBe('platform_facet_candidates');
  expect(row.fields.optionsRaw).toContain('0V;2.2V');
  expect(row.fields.optionsRaw).toContain('400V/600V');
  expect(row.fields.optionsRaw).toContain('0.23kV');
  expect(row.rawValues[7]).toBe(row.fields.optionsRaw);
  expect(row.enumValues).toBeUndefined();
  expect(row.origin).toMatchObject({ format: 'csv', row: 3, physicalLineStart: 3, physicalLineEnd: 3, attributeColumn: 7 });
  expect(row.supportingOrigins).toHaveLength(1);
  expect(row.supportingOrigins[0]).toMatchObject({ originalFile: 'originals/zkh_l5_specs_wide.csv', row: 4, attributeColumn: 32 });
  const exact = await queryReferences(library, { source: 'zkh-l5-specs', recordId: row.id });
  expect(exact.rows).toEqual([row]);
});

test('新增 CSV 由现有 CLI 只读检索，查询不改写原件、目录或索引', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(library, 'indexes/manifest.json'), 'utf8'));
  const source = manifest.sources.find((s: any) => s.sourceId === 'zkh-l5-specs');
  const files = ['catalog.json', 'intake-receipt.json', 'indexes/manifest.json', source.originalFile, source.indexFile,
    source.supportingFiles[0].originalFile, source.reconciliation.reportFile];
  const snapshot = async () => Promise.all(files.map(async (file) => {
    const absolute = path.join(library, file);
    return { file, sha256: createHash('sha256').update(await fs.readFile(absolute)).digest('hex'), mtimeMs: (await fs.stat(absolute)).mtimeMs };
  }));
  const before = await snapshot();
  const child = Bun.spawnSync([process.execPath, path.join(root, 'cli.ts'), 'query', '--kind', 'references',
    '--source', 'zkh-l5-specs', '--category-text', '电抗器', '--attribute-text', '额定电压', '--limit', '1']);
  expect(child.exitCode).toBe(0);
  const result = JSON.parse(child.stdout.toString());
  expect(result.total).toBe(1);
  expect(result.adoption).toBe('not_reviewed_or_applied');
  expect(result.rows[0].fields.optionsRaw).toContain('DC500V-DC1000V');
  expect(await snapshot()).toEqual(before);
});

test('立讯长表保留类目绑定和字典引用，不以宽表重复计数或以汇总类型覆盖', async () => {
  const paper = await queryReferences(library, { source: 'luxshare-template', categoryText: '卷纸', attributeText: '层数' });
  expect(paper.total).toBe(1);
  expect(paper.sources[0].indexedRows).toBe(7914);
  const row = paper.rows[0];
  expect(row.origin).toEqual({ sheet: '04-品名属性长表', row: 812, attributeCell: 'J812' });
  expect(row.fields.attributeCodeRaw).toBe('ATTR_049');
  expect(row.fields.typeRaw).toBe('枚举'); // 05 定义库写数值；索引不得静默覆盖 04。
  expect(row.fields.optionsRaw).toBe('2层/3层/4层');
  expect(row.fields.requiredRaw).toBe('Y');
  expect(row.required).toBeUndefined();
  const bag = await queryReferences(library, { source: 'luxshare-template', categoryText: '垃圾袋', attributeText: '颜色' });
  expect(bag.rows[0].fields.typeRaw).toBe('字典应用');
  expect(bag.rows[0].fields.optionsRaw).toBe('颜色字典');
  expect(bag.rows[0].fields.exampleRaw).toBe('黑色');
  expect(bag.rows[0].enumValues).toBeUndefined();
  expect(bag.adoption).toBe('not_reviewed_or_applied');
});

test('动态来源不能冒充已入库模板，分页参数检查', async () => {
  await expect(queryReferences(library, { source: 'jd-vop' })).rejects.toThrow('Not a local template source');
  await expect(queryReferences(library, { limit: 0 })).rejects.toThrow('Invalid reference pagination');
});

test('过期或损坏的索引不能静默作为原件内容返回', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'v4-reference-test-'));
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(library, 'indexes/manifest.json'), 'utf8'));
    const source = manifest.sources.find((s: any) => s.sourceId === 'zkh-template');
    for (const relative of ['catalog.json', 'indexes/manifest.json', source.originalFile]) {
      await fs.mkdir(path.dirname(path.join(temporary, relative)), { recursive: true });
      await fs.copyFile(path.join(library, relative), path.join(temporary, relative));
    }
    await fs.writeFile(path.join(temporary, source.indexFile), 'corrupt');
    await expect(queryReferences(temporary, { source: 'zkh-template' })).rejects.toThrow('Reference integrity mismatch');
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test('后续研究上下文装入来源路由和规则，不塞入全部模板行', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'v4-reference-context-'));
  try {
    const inputs = path.join(temporary, 'inputs.json'), out = path.join(temporary, 'context');
    await fs.writeFile(inputs, '{"files":[]}');
    const result = Bun.spawnSync([process.execPath, path.join(root, 'cli.ts'), 'prepare', '--stage', 'research', '--inputs', inputs, '--out', out]);
    expect(result.exitCode).toBe(0);
    const receipt = JSON.parse(await fs.readFile(path.join(out, 'context-manifest.json'), 'utf8'));
    expect(receipt.orderedFiles.some((r: any) => r.path.endsWith('attribute-reference-library/catalog.json'))).toBe(true);
    expect(receipt.orderedFiles.some((r: any) => r.path.includes('jsonl.gz'))).toBe(false);
    const context = await fs.readFile(path.join(out, 'context.md'), 'utf8');
    expect(context).toContain('query --kind references');
    expect(context).toContain('入库不等于属性采用');
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
