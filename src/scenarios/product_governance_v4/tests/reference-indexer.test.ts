import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { queryReferences } from '../reference-library';

const root = path.resolve(import.meta.dir, '..');
const bundledPython = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
const python = process.env.REFERENCE_INDEX_PYTHON ?? (existsSync(bundledPython) ? bundledPython : 'python3');
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const csv = (rows: string[][]) => '\uFEFF' + rows.map(row => row.map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';
const rawOptions = '0L;无;"带引号,逗号"\r\n1000mL;2L+500mL;10kg';
const runIndexer = (library: string) => Bun.spawnSync([python, path.join(root, 'scripts/index-reference-templates.py'), '--library', library]);

async function fixture(wideOptions = rawOptions, wideType = '立式', extraWide = '') {
  const library = await fs.mkdtemp(path.join(os.tmpdir(), 'v4-reference-csv-'));
  await fs.mkdir(path.join(library, 'originals'));
  const source = {
    id: 'fixture-facets', sourceKind: 'external_attribute_template', sourceFamilyId: 'fixture-platform',
    name: 'CSV fixture', access: 'local_template_index', referenceRole: 'platform_facet_candidates',
    format: 'csv', headerRow: 1, categoryHeaders: ['类目'], categoryCodeHeaders: ['类目ID'],
    categoryIdHeader: '类目ID', attributeHeader: '规格名称', fieldHeaders: { optionsRaw: '可选规格值' },
    originalFile: 'originals/long.csv', indexFile: 'indexes/facets.jsonl.gz',
    supportingFiles: [{ originalFile: 'originals/wide.csv', role: 'same_source_wide_view', format: 'csv' }],
    reconciliationFile: 'indexes/reconciliation.json',
  };
  const originals = {
    'originals/long.csv': csv([['类目', '类目ID', '规格名称', '可选规格值'], ['清洁设备', '00123', '容积', rawOptions], ['清洁设备', '00123', '类型', '立式']]),
    'originals/wide.csv': csv([['类目', '类目ID', '容积', '类型', '额定电流'], ['清洁设备', '00123', wideOptions, wideType, extraWide], ['空属性类', '00456', '', '', '']]),
  };
  for (const [file, data] of Object.entries(originals)) await fs.writeFile(path.join(library, file), data);
  await fs.writeFile(path.join(library, 'catalog.json'), JSON.stringify({ version: 2, sources: [source] }));
  await fs.writeFile(path.join(library, 'intake-receipt.json'), JSON.stringify({ sources: Object.entries(originals).map(([file, data]) => ({ sourceId: source.id, originalFile: file, sha256: digest(data) })) }));
  return { library, originals };
}

test('CSV 引号、逗号、换行、前导零和未审平台原值无损，行定位区分逻辑记录与物理行', async () => {
  const { library, originals } = await fixture();
  try {
    const indexed = runIndexer(library);
    expect(indexed.stderr.toString()).toBe('');
    expect(indexed.exitCode).toBe(0);
    const result = await queryReferences(library, { source: 'fixture-facets' });
    expect(result.total).toBe(2);
    expect(result.sourceFamilyIds).toEqual(['fixture-platform']);
    expect(result.sources[0].originalSha256).toBe(digest(originals['originals/long.csv']));
    expect(result.sources[0].supportingFiles[0].originalSha256).toBe(digest(originals['originals/wide.csv']));
    const [volume, type] = result.rows;
    expect(volume.categoryIdRaw).toBe('00123');
    expect(volume.fields.optionsRaw).toBe(rawOptions);
    expect(volume.rawValues).toEqual(['清洁设备', '00123', '容积', rawOptions]);
    expect(volume.enumValues).toBeUndefined();
    expect(result.platformOptionsAreApprovedEnums).toBe(false);
    expect(volume.origin).toMatchObject({ format: 'csv', row: 2, physicalLineStart: 2, physicalLineEnd: 3, attributeColumn: 3 });
    expect(type.origin).toMatchObject({ row: 3, physicalLineStart: 4, physicalLineEnd: 4 });
    expect(volume.supportingOrigins[0]).toMatchObject({ row: 2, physicalLineStart: 2, physicalLineEnd: 3, attributeColumn: 3 });
    expect(result.sources[0].reconciliation).toMatchObject({
      status: 'exact_nonempty_facets_match', longBindingCount: 2, wideNonEmptyBindingCount: 2,
      matchedBindingCount: 2, wideCategoryCount: 2, wideEmptyAttributeCategoryCount: 1,
      additionalIndexedRowsFromWide: 0, additionalIndependentEvidenceFromWide: 0,
    });
    const report = JSON.parse(await fs.readFile(path.join(library, 'indexes/reconciliation.json'), 'utf8'));
    expect(report.emptyAttributeCategories).toHaveLength(1);
    expect(report.emptyAttributeCategories[0]).toMatchObject({ categoryPath: ['空属性类'], categoryCodesRaw: ['00456'], origin: { row: 3, physicalLineStart: 4, physicalLineEnd: 4 } });
    for (const [file, original] of Object.entries(originals)) expect(await fs.readFile(path.join(library, file), 'utf8')).toBe(original);
    const firstIndex = await fs.readFile(path.join(library, 'indexes/facets.jsonl.gz'));
    expect(runIndexer(library).exitCode).toBe(0);
    expect(await fs.readFile(path.join(library, 'indexes/facets.jsonl.gz'))).toEqual(firstIndex);
  } finally { await fs.rm(library, { recursive: true, force: true }); }
});

test('长宽表差异并列保存，宽表不覆盖长表、不增加候选行或独立证据', async () => {
  const { library } = await fixture('4L', '', '10A');
  try {
    expect(runIndexer(library).exitCode).toBe(0);
    const result = await queryReferences(library);
    expect(result.total).toBe(2);
    expect(result.rows.map(row => row.fields.optionsRaw)).toEqual([rawOptions, '立式']);
    expect(result.rows.every(row => row.supportingOrigins.length === 0)).toBe(true);
    expect(result.sources[0].reconciliation).toMatchObject({
      status: 'differences_preserved_for_review', longOnlyBindingCount: 1,
      wideOnlyBindingCount: 1, valueMismatchBindingCount: 1, matchedBindingCount: 0,
      additionalIndexedRowsFromWide: 0, additionalIndependentEvidenceFromWide: 0,
    });
    const report = JSON.parse(await fs.readFile(path.join(library, 'indexes/reconciliation.json'), 'utf8'));
    expect(report.valueMismatches[0].long[0].optionsRaw).toBe(rawOptions);
    expect(report.valueMismatches[0].wide[0].optionsRaw).toBe('4L');
    expect(report.longOnlyBindings[0].attribute).toBe('类型');
    expect(report.wideOnlyBindings[0].attribute).toBe('额定电流');
  } finally { await fs.rm(library, { recursive: true, force: true }); }
});

test('查询校验主 CSV、同源宽表与核对报告哈希；导入校验原件回执', async () => {
  const { library, originals } = await fixture();
  try {
    expect(runIndexer(library).exitCode).toBe(0);
    for (const relative of ['originals/long.csv', 'originals/wide.csv', 'indexes/reconciliation.json']) {
      const file = path.join(library, relative), content = await fs.readFile(file);
      await fs.appendFile(file, 'changed');
      await expect(queryReferences(library)).rejects.toThrow('Reference integrity mismatch');
      await fs.writeFile(file, content);
    }
    await fs.writeFile(path.join(library, 'originals/wide.csv'), originals['originals/wide.csv'] + '\r\n');
    const indexed = runIndexer(library);
    expect(indexed.exitCode).not.toBe(0);
    expect(indexed.stderr.toString()).toContain('原文件与接收回执不一致');
  } finally { await fs.rm(library, { recursive: true, force: true }); }
});

test('CSV 短行不能被静默补齐，目录变更后不能读取过期索引', async () => {
  const { library } = await fixture();
  try {
    expect(runIndexer(library).exitCode).toBe(0);
    const catalogFile = path.join(library, 'catalog.json');
    await fs.appendFile(catalogFile, ' ');
    await expect(queryReferences(library)).rejects.toThrow('Reference catalog changed');
    const short = csv([['类目', '类目ID', '规格名称', '可选规格值'], ['清洁设备', '00123', '容积']]);
    await fs.writeFile(path.join(library, 'originals/long.csv'), short);
    const receiptsFile = path.join(library, 'intake-receipt.json');
    const receipts = JSON.parse(await fs.readFile(receiptsFile, 'utf8'));
    receipts.sources[0].sha256 = digest(short);
    await fs.writeFile(receiptsFile, JSON.stringify(receipts));
    const indexed = runIndexer(library);
    expect(indexed.exitCode).not.toBe(0);
    expect(indexed.stderr.toString()).toContain('CSV 列数不一致');
  } finally { await fs.rm(library, { recursive: true, force: true }); }
});
