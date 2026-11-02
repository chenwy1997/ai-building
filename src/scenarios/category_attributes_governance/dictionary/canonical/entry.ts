import { Database } from 'bun:sqlite';
import { mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digest, toStdText } from '../contracts.ts';
import type { Dictionary } from '../contracts.ts';
import { batch, extract } from './extract.ts';
import type { NameEvidence } from './extract.ts';
import { applyDecisions, baseDictionary, mappingRows } from './build.ts';
import type { Coverage, DecisionFile } from './build.ts';
import { renderBatch } from './render.ts';
import { openQuestions, validateQuestions } from './questions.ts';

const scenario = resolve(import.meta.dir, '../..');
const library = resolve(scenario, 'workspace/dictionary/v1');
const dbPath = resolve(library, 'attribute-library-v1.sqlite');
const output = resolve(library, 'canonical-v1');

const percent = (share: number) => `${(share * 100).toFixed(2)}%`;

async function evidence(args: { namespace: string; topNames?: number; batchSize: number }) {
  if (!(await Bun.file(dbPath).exists())) throw new Error('请先执行 dictionary build');
  const db = new Database(dbPath, { readonly: true });
  let result;
  try {
    result = extract(db, { namespace: args.namespace, topNames: args.topNames });
  } finally {
    db.close();
  }
  const batches = batch(result, args.batchSize);
  const packages = resolve(output, 'packages');
  await mkdir(packages, { recursive: true });

  const index = batches.map((names, position) => ({
    batch: position + 1,
    file: `batch-${String(position + 1).padStart(4, '0')}.json`,
    ranks: [names[0]!.rank, names.at(-1)!.rank] as [number, number],
    names: names.map((entry) => entry.name),
    leafCategories: names.reduce((sum, entry) => sum + entry.leafCategories, 0),
  }));
  await Promise.all(
    batches.map((names, position) =>
      Bun.write(
        resolve(packages, index[position]!.file),
        JSON.stringify(
          {
            schema: result.schema,
            batch: index[position]!.batch,
            of: batches.length,
            namespace: result.namespace,
            sourceDictionaryHash: result.sourceDictionaryHash,
            commonPathPrefix: result.commonPathPrefix,
            notice:
              '证据为历史模板与采样的忠实聚合。同名不代表同义，样本值不代表封闭枚举，出现频次不证明必填或正确。归并与描述对象判断由模型语义完成，程序不做名称规则归并。',
            names,
          },
          null,
          2,
        ),
      ),
    ),
  );
  await Bun.write(
    resolve(output, 'evidence-index.json'),
    JSON.stringify(
      {
        schema: 'sanheng-canonical-evidence-index-v1',
        generatedAt: new Date().toISOString(),
        namespace: result.namespace,
        sourceDictionaryHash: result.sourceDictionaryHash,
        commonPathPrefix: result.commonPathPrefix,
        totals: result.totals,
        coverage: result.coverage,
        batchSize: args.batchSize,
        batches: index,
        apiRequests: 0,
      },
      null,
      2,
    ),
  );

  console.log(`命名空间 ${result.namespace}`);
  console.log(
    `末级类目 ${result.totals.leafCategories.toLocaleString('en-US')}，候选 ${result.totals.candidates.toLocaleString('en-US')}，不同属性名 ${result.totals.distinctNames.toLocaleString('en-US')}`,
  );
  console.log('\n按（属性名×末级类目）配对数的累计覆盖：');
  for (const point of result.coverage) {
    console.log(`  前 ${String(point.throughRank).padStart(5)} 个属性名  ${percent(point.cumulativeShare)}`);
  }
  console.log(`\n已写出 ${batches.length} 个证据包，每包 ${args.batchSize} 个属性名`);
  console.log(`目录: ${packages}`);
}

async function loadScope(batches: number[]): Promise<Map<number, NameEvidence[]>> {
  const packages = resolve(output, 'packages');
  const scope = new Map<number, NameEvidence[]>();
  for (const position of batches) {
    const file = resolve(packages, `batch-${String(position).padStart(4, '0')}.json`);
    if (!(await Bun.file(file).exists())) throw new Error(`缺少证据包 batch-${position}，请先执行 evidence`);
    scope.set(position, (await Bun.file(file).json()).names as NameEvidence[]);
  }
  return scope;
}

async function compile() {
  const directory = resolve(import.meta.dir, 'decisions');
  const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  if (!files.length) throw new Error('decisions 目录没有归并决定文件');

  let dictionary: Dictionary = baseDictionary;
  const applied: Array<{ file: string; decisions: DecisionFile; scope: NameEvidence[]; coverage: Coverage }> = [];
  for (const name of files) {
    const decisions = (await Bun.file(resolve(directory, name)).json()) as DecisionFile;
    const scope = (await loadScope([decisions.batch])).get(decisions.batch)!;
    const result = applyDecisions(dictionary, decisions, scope);
    dictionary = result.dictionary;
    applied.push({ file: name, decisions, scope, coverage: result.coverage });
    console.log(
      `${name}: 属性名 ${result.coverage.names}，合并 ${result.coverage.mapped.names}，拆分 ${result.coverage.split.names}，待审 ${result.coverage.deferred.names}`,
    );
  }

  const rows = applied.flatMap((entry) => mappingRows(entry.decisions, dictionary, entry.scope));
  const totals = applied.reduce(
    (sum, entry) => ({
      names: sum.names + entry.coverage.names,
      leafCategories: sum.leafCategories + entry.coverage.leafCategories,
      resolvedLeaves: sum.resolvedLeaves + entry.coverage.mapped.leafCategories + entry.coverage.split.leafCategories,
      deferredLeaves: sum.deferredLeaves + entry.coverage.deferred.leafCategories,
      variantsCollapsed: sum.variantsCollapsed + entry.coverage.variantsCollapsed,
    }),
    { names: 0, leafCategories: 0, resolvedLeaves: 0, deferredLeaves: 0, variantsCollapsed: 0 },
  );

  await mkdir(output, { recursive: true });
  await Bun.write(resolve(output, 'property-dictionary.json'), JSON.stringify(dictionary, null, 2));
  await Bun.write(resolve(output, 'property-dictionary.std.txt'), toStdText(dictionary));
  await Bun.write(resolve(output, 'name-mapping.json'), JSON.stringify({ schema: 'sanheng-canonical-mapping-v1', rows }, null, 2));
  await Bun.write(
    resolve(output, 'canonical-manifest.json'),
    JSON.stringify(
      {
        schema: 'sanheng-canonical-manifest-v1',
        generatedAt: new Date().toISOString(),
        dictionaryHash: digest(dictionary),
        batches: applied.map((entry) => ({ file: entry.file, batch: entry.decisions.batch, ranks: entry.decisions.ranks, coverage: entry.coverage })),
        totals,
        properties: dictionary.properties.length,
        units: dictionary.units.length,
        status: '归并初稿，已通过契约校验；未经品类专家验收，不得作为正式模板发布',
        apiRequests: 0,
      },
      null,
      2,
    ),
  );
  await writeReviewWorkbook(dictionary, rows);

  const share = (value: number) => `${((value / totals.leafCategories) * 100).toFixed(1)}%`;
  console.log(`\n标准属性 ${dictionary.properties.length} 条（含修订版本），单位 ${dictionary.units.length} 个`);
  console.log(`已判定属性名 ${totals.names}，其中已归并覆盖 ${share(totals.resolvedLeaves)} 的（属性名×末级类目）配对，待审 ${share(totals.deferredLeaves)}`);
  console.log(`折叠掉的历史变体 ${totals.variantsCollapsed.toLocaleString('en-US')} 个`);
  console.log(`\n产物目录: ${output}`);
}

async function writeReviewWorkbook(dictionary: Dictionary, rows: ReturnType<typeof mappingRows>) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const units = new Map(dictionary.units.map((unit) => [unit.id, unit]));

  const definitions = workbook.addWorksheet('标准属性定义');
  definitions.columns = [
    { header: '属性ID', key: 'id', width: 42 },
    { header: '版本', key: 'revision', width: 6 },
    { header: '属性名称', key: 'name', width: 20 },
    { header: '描述对象', key: 'object', width: 30 },
    { header: '定义', key: 'definition', width: 60 },
    { header: '值类型', key: 'type', width: 8 },
    { header: '物理量', key: 'quantity', width: 14 },
    { header: '可选单位', key: 'unitIds', width: 18 },
    { header: '不得表示', key: 'excludedMeanings', width: 44 },
    { header: '填写限定', key: 'qualifications', width: 44 },
    { header: '专家意见（保留/修改/删除）', key: 'verdict', width: 24 },
    { header: '专家批注', key: 'comment', width: 40 },
  ];
  for (const property of [...dictionary.properties].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.revision - b.revision))) {
    definitions.addRow({
      ...property,
      unitIds: property.unitIds.map((id) => units.get(id)?.symbol ?? id).join(' / '),
      excludedMeanings: property.excludedMeanings.join('；'),
      qualifications: property.qualifications.join('；'),
      verdict: '',
      comment: '',
    });
  }

  const mapping = workbook.addWorksheet('历史名称归并');
  mapping.columns = [
    { header: '历史属性名', key: 'name', width: 18 },
    { header: '处理', key: 'action', width: 8 },
    { header: '涉及末级类目', key: 'leafCategories', width: 13 },
    { header: '历史变体数', key: 'variantsTotal', width: 12 },
    { header: '归并到属性ID', key: 'propertyId', width: 42 },
    { header: '标准属性名称', key: 'propertyName', width: 20 },
    { header: '适用情形', key: 'when', width: 52 },
    { header: '判定说明', key: 'note', width: 80 },
    { header: '专家意见（同意/不同意）', key: 'verdict', width: 22 },
    { header: '专家批注', key: 'comment', width: 40 },
  ];
  const label = { map: '合并', split: '拆分', defer: '待审' } as const;
  for (const row of rows) mapping.addRow({ ...row, action: label[row.action], verdict: '', comment: '' });

  validateQuestions(openQuestions);
  const pending = workbook.addWorksheet('待裁定');
  pending.columns = [
    { header: '编号', key: 'id', width: 14 },
    { header: '涉及', key: 'subject', width: 40 },
    { header: '问题', key: 'question', width: 60 },
    { header: '类型', key: 'kind', width: 10 },
    { header: '谁能回答', key: 'answerableBy', width: 14 },
    { header: '影响末级类目', key: 'impact', width: 13 },
    { header: '已附证据', key: 'evidence', width: 66 },
    { header: '默认结论（无人裁定时生效）', key: 'defaultDecision', width: 66 },
    { header: '默认为何可逆', key: 'reversibleBecause', width: 48 },
    { header: '裁定结论', key: 'verdict', width: 30 },
    { header: '裁定人', key: 'by', width: 12 },
  ];
  for (const question of openQuestions.questions) {
    pending.addRow({
      ...question,
      impact: question.impact.leafCategories,
      evidence: question.evidence.map((item, index) => `${index + 1}. ${item}`).join('\n'),
      verdict: question.resolution?.verdict ?? '',
      by: question.resolution?.by ?? '',
    });
  }

  for (const sheet of [definitions, mapping, pending]) {
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF174D59' } };
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.eachRow((row, index) => {
      if (index > 1) row.alignment = { vertical: 'top', wrapText: true };
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  }

  const path = resolve(output, '属性字典-专家验收.xlsx');
  await workbook.xlsx.writeFile(path);
  return path;
}

export async function main(argv = process.argv.slice(2)) {
  const action = argv[0] ?? 'help';
  const option = (key: string) => argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
  const number = (key: string, fallback?: number) => {
    const raw = option(key);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) throw new Error(`--${key} 必须为正整数`);
    return value;
  };
  if (action === 'evidence') {
    return evidence({
      namespace: option('namespace') ?? 'sanheng',
      topNames: number('top'),
      batchSize: number('batch', 40)!,
    });
  }
  if (action === 'compile') return compile();
  if (action === 'render') {
    const position = number('batch');
    if (position === undefined) throw new Error('render需要--batch=批次号');
    const names = (await loadScope([position])).get(position)!;
    const text = renderBatch(names, { variantLines: number('variant-lines') });
    const file = resolve(output, 'requests', `batch-${String(position).padStart(4, '0')}.md`);
    await mkdir(resolve(output, 'requests'), { recursive: true });
    await Bun.write(file, text);
    console.log(`第 ${position} 批 ${names.length} 个属性名，${text.length.toLocaleString('en-US')} 字符（粗估 ${Math.round(text.length * 0.7).toLocaleString('en-US')} token）`);
    console.log(file);
    return;
  }
  if (action !== 'help') throw new Error(`未知子命令: ${action}`);
  console.log(
    '标准属性字典归并，本地执行，无API调用\n' +
      '  evidence --top=1000 --batch=40 [--namespace=sanheng]\n' +
      '           按频次排名切批，附各变体说明/类型/单位/值样本与类目分布。\n' +
      '           程序不做名称归并；同一概念的判定由模型对照已累积字典完成。\n' +
      '  render --batch=2 [--variant-lines=18]\n' +
      '           把某批证据折叠成可放进上下文的紧凑文本，供模型请求使用。\n' +
      '  compile  按批次顺序应用 decisions/*.json，做契约校验后输出字典、\n' +
      '           历史名称映射与专家验收Excel。校验只保证结构一致，不代表语义正确。',
  );
}

if (import.meta.main) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
