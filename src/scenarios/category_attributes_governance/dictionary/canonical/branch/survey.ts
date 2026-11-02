import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { run } from './entry.ts';

/**
 * Measures how far the dictionary carries across domains, by mounting one branch in each
 * top-level category and comparing gap density.
 *
 * The batches were cut by frequency over all 108k historical (name × leaf) pairs, which
 * silently favours domains whose vocabulary is concentrated. The four hand-mounted branches
 * already hint at the cost: after the same three batches, 法兰 was missing 6 properties while
 * 防寒服 was missing 20. One branch per top-level category turns that hint into a per-domain
 * number, so the next dictionary effort can be aimed at what mounting actually demanded
 * instead of at the next 40 names on a frequency list.
 *
 * Gaps are only trustworthy here because the consolidator now sees the whole dictionary, not
 * just the branch shortlist: a report the shortlist could not express but the dictionary
 * already holds is a recall failure in the facet labels, and it lands in 引导召回不到 rather
 * than inflating the gap count. Facet labels are derived per branch now, so without that
 * separation a shortlist that came out too narrow would read as a domain the dictionary fails.
 */

const library = resolve(import.meta.dir, '../../../workspace/dictionary/v1');

/**
 * Picks the largest branch inside the size range the pipeline has actually been run on.
 * Bigger is preferred because sibling consistency and gap density both mean more with more
 * siblings; 17+ leaf branches are excluded because none has ever been mounted and this survey
 * should not be the first test of two things at once.
 */
const sizeRange = { min: 6, max: 16 } as const;

interface Pick {
  topLevel: string;
  branchPath: string[];
  leaves: number;
  /** Share of this branch's (name × leaf) pairs whose historical name a batch has judged. */
  judged: number;
}

export function pickBranches(db: Database, mapped: Set<string>, perTopLevel: number): Pick[] {
  const rows = db
    .query(`SELECT category_name, path, name FROM candidates_v1 WHERE namespace = 'sanheng'`)
    .all() as Array<{ category_name: string; path: string; name: string }>;

  const branches = new Map<string, { topLevel: string; branchPath: string[]; leaves: Set<string>; pairs: number; judged: number }>();
  for (const row of rows) {
    const path = JSON.parse(row.path) as string[];
    if (path.length < 3) continue;
    const branchPath = path.slice(1, -1);
    const key = branchPath.join('/');
    let entry = branches.get(key);
    if (!entry) branches.set(key, (entry = { topLevel: path[1]!, branchPath, leaves: new Set(), pairs: 0, judged: 0 }));
    entry.leaves.add(row.category_name);
    entry.pairs += 1;
    if (mapped.has(row.name)) entry.judged += 1;
  }

  const byTopLevel = new Map<string, Pick[]>();
  for (const entry of branches.values()) {
    if (entry.leaves.size < sizeRange.min || entry.leaves.size > sizeRange.max) continue;
    const list = byTopLevel.get(entry.topLevel) ?? [];
    list.push({ topLevel: entry.topLevel, branchPath: entry.branchPath, leaves: entry.leaves.size, judged: entry.judged / entry.pairs });
    byTopLevel.set(entry.topLevel, list);
  }

  const picks: Pick[] = [];
  for (const list of byTopLevel.values())
    picks.push(...list.sort((a, b) => b.leaves - a.leaves || b.judged - a.judged).slice(0, perTopLevel));
  return picks.sort((a, b) => (a.topLevel < b.topLevel ? -1 : 1));
}

interface Outcome {
  pick: Pick;
  gaps: number;
  notGaps: number;
  ruledOut: number;
  findings: number;
  baseSize: number;
  meanJaccard: number;
  costCny: number;
  /** Gaps per leaf: the comparable number, since branches differ in size. */
  density: number;
  gapNames: string[];
  error?: string;
}

export async function survey(options: { perTopLevel: number; budget: number; only?: string[] }) {
  const canonical = resolve(library, 'canonical-v1');
  const mapping = (await Bun.file(resolve(canonical, 'name-mapping.json')).json()) as {
    rows: Array<{ name: string; action: string }>;
  };
  const mapped = new Set(mapping.rows.filter((row) => row.action !== 'defer').map((row) => row.name));

  const db = new Database(resolve(library, 'attribute-library-v1.sqlite'), { readonly: true });
  let picks = pickBranches(db, mapped, options.perTopLevel);
  db.close();
  if (options.only?.length) picks = picks.filter((pick) => options.only!.includes(pick.topLevel));

  const leaves = picks.reduce((total, pick) => total + pick.leaves, 0);
  console.log(`抽样：${picks.length} 个一级类目各取 ${options.perTopLevel} 个分支，共 ${leaves} 个末级类目`);
  for (const pick of picks)
    console.log(`  ${pick.topLevel.padEnd(10)} ${pick.branchPath.join('/').padEnd(34)} ${String(pick.leaves).padStart(2)} 末级  历史名已判定 ${(pick.judged * 100).toFixed(0)}%`);

  if (!options.budget) {
    console.log(`\n估价：末级请求 ${leaves} 次 + 分支固定 ${picks.length * 2} 次，按四分支实测均价约 ${(leaves * 0.0125 + picks.length * 0.03).toFixed(2)} 元`);
    console.log('加 --budget=<元> 才真跑（预算是每个分支各自的上限，不是总额）');
    return;
  }

  const outcomes: Outcome[] = [];
  for (const [index, pick] of picks.entries()) {
    const name = pick.branchPath.at(-1)!;
    console.log(`\n[${index + 1}/${picks.length}] ${pick.branchPath.join(' › ')}`);
    try {
      await run(name, options.budget);
      const mounted = (await Bun.file(resolve(library, 'branch-v1', name, 'mounted.json')).json()) as {
        gaps: Array<{ need: string }>;
        notGaps: unknown[];
        ruledOut?: unknown[];
        findings: unknown[];
        agreement: { meanJaccard: number };
        resolved: unknown[];
      };
      const manifest = (await Bun.file(resolve(library, 'branch-v1', name, 'manifest.json')).json()) as {
        baseSize: number;
        usage: { conservativeCny: number };
      };
      outcomes.push({
        pick,
        gaps: mounted.gaps.length,
        notGaps: mounted.notGaps.length,
        ruledOut: mounted.ruledOut?.length ?? 0,
        findings: mounted.findings.length,
        baseSize: manifest.baseSize,
        meanJaccard: mounted.agreement.meanJaccard,
        costCny: manifest.usage.conservativeCny,
        density: mounted.gaps.length / pick.leaves,
        gapNames: mounted.gaps.map((gap) => gap.need),
      });
    } catch (error) {
      // One branch failing must not lose the branches already paid for.
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  跳过：${message}`);
      outcomes.push({ pick, gaps: 0, notGaps: 0, ruledOut: 0, findings: 0, baseSize: 0, meanJaccard: 0, costCny: 0, density: 0, gapNames: [], error: message });
    }
  }

  await report(outcomes);
}

async function report(outcomes: Outcome[]) {
  const done = outcomes.filter((outcome) => !outcome.error).sort((a, b) => b.density - a.density);
  console.log('\n=== 各领域缺口密度（每末级类目平均缺几条属性，越高说明字典在该领域越不够用）===');
  console.log('一级类目      分支                        末级 基础集 真缺口 密度  引导召回不到 已裁定 结构检查 兄弟一致');
  for (const outcome of done)
    console.log(
      `${outcome.pick.topLevel.padEnd(12)}${outcome.pick.branchPath.slice(-2).join('/').padEnd(26)}${String(outcome.pick.leaves).padStart(4)}${String(outcome.baseSize).padStart(6)}${String(outcome.gaps).padStart(6)}${outcome.density.toFixed(2).padStart(6)}${String(outcome.notGaps).padStart(11)}${String(outcome.ruledOut).padStart(7)}${String(outcome.findings).padStart(8)}${outcome.meanJaccard.toFixed(2).padStart(9)}`,
    );

  const failed = outcomes.filter((outcome) => outcome.error);
  if (failed.length) {
    console.log(`\n未完成 ${failed.length} 个：`);
    for (const outcome of failed) console.log(`  ${outcome.pick.branchPath.join('/')}: ${outcome.error}`);
  }
  const spent = outcomes.reduce((total, outcome) => total + outcome.costCny, 0);
  console.log(`\n合计计费 ${spent.toFixed(4)} 元`);

  // Gaps demanded by more than one domain are the ones worth a dictionary batch: a gap only
  // one branch asks for belongs in that industry pack, not in the shared dictionary.
  const askedBy = new Map<string, Set<string>>();
  for (const outcome of done)
    for (const need of outcome.gapNames) {
      const domains = askedBy.get(need) ?? new Set<string>();
      domains.add(outcome.pick.topLevel);
      askedBy.set(need, domains);
    }
  const shared = [...askedBy.entries()].filter(([, domains]) => domains.size > 1).sort((a, b) => b[1].size - a[1].size);
  if (shared.length) {
    console.log('\n=== 多个领域都要的缺口（这些才值得进通用字典，只有一个领域要的应进行业包）===');
    for (const [need, domains] of shared) console.log(`  ${need.padEnd(16)} ${domains.size} 个领域: ${[...domains].join('、')}`);
  }

  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('各领域缺口密度');
  sheet.columns = [
    { header: '一级类目', key: 'top', width: 14 },
    { header: '分支', key: 'branch', width: 32 },
    { header: '末级数', key: 'leaves', width: 8 },
    { header: '历史名已判定占比', key: 'judged', width: 16 },
    { header: '基础集条数', key: 'base', width: 12 },
    { header: '字典真缺口', key: 'gaps', width: 12 },
    { header: '缺口密度（每末级）', key: 'density', width: 18 },
    { header: '引导召回不到', key: 'recall', width: 14 },
    { header: '命中已有裁定', key: 'ruled', width: 14 },
    { header: '结构检查', key: 'findings', width: 10 },
    { header: '兄弟一致性', key: 'jaccard', width: 12 },
    { header: '计费(元)', key: 'cost', width: 10 },
    { header: '缺的是什么', key: 'names', width: 70 },
  ];
  for (const outcome of done)
    sheet.addRow({
      top: outcome.pick.topLevel,
      branch: outcome.pick.branchPath.join('/'),
      leaves: outcome.pick.leaves,
      judged: Number((outcome.pick.judged * 100).toFixed(0)),
      base: outcome.baseSize,
      gaps: outcome.gaps,
      density: Number(outcome.density.toFixed(2)),
      recall: outcome.notGaps,
      ruled: outcome.ruledOut,
      findings: outcome.findings,
      jaccard: Number(outcome.meanJaccard.toFixed(2)),
      cost: Number(outcome.costCny.toFixed(4)),
      names: outcome.gapNames.join('、'),
    });

  const demand = book.addWorksheet('缺口的跨领域需求');
  demand.columns = [
    { header: '缺的属性', key: 'need', width: 22 },
    { header: '几个领域要', key: 'count', width: 12 },
    { header: '哪些领域', key: 'domains', width: 46 },
    { header: '建议', key: 'advice', width: 40 },
  ];
  for (const [need, domains] of shared)
    demand.addRow({ need, count: domains.size, domains: [...domains].join('、'), advice: '多领域共同需求，值得进通用字典下一批' });
  for (const [need, domains] of [...askedBy.entries()].filter(([, set]) => set.size === 1))
    demand.addRow({ need, count: 1, domains: [...domains][0], advice: '单一领域需求，宜进该行业包而非通用字典' });

  const notes = book.addWorksheet('说明');
  notes.columns = [
    { header: '项', key: 'item', width: 22 },
    { header: '说明', key: 'value', width: 108 },
  ];
  for (const [item, value] of [
    ['这份表回答什么', '继续投字典的钱该花在哪个领域。批次是按全量属性名频次切的，会偏向词汇集中的领域；缺口密度是按需求反过来量的。'],
    ['缺口密度怎么读', '每末级类目平均缺几条属性。分支大小不同，绝对缺口数不可比，密度可比。'],
    ['真缺口与引导召回不到', '归并环节能看到全字典而不只是本分支候选集：字典已有却没进候选集的算引导召回不到（改召回标签），只有字典真没有的才计入缺口。'],
    ['召回标签哪来的', '除四个手写试点分支外，召回标签与必填维度由该分支历史属性名反推，未经人工挑选。已验证推出的候选集能召回四个试点分支实际挂上的全部属性。'],
    ['分支怎么选的', `每个一级类目取末级数最多的一个分支，限定在 ${sizeRange.min}~${sizeRange.max} 末级——这是流水线实测过的规模；17 末级以上的分支（全树 167 个）尚未验证，不在本次抽样内。`],
    ['不能读出什么', '一个一级类目只抽了一个分支，密度是该领域的抽样估计而非普查。密度高说明值得进一步抽样，不足以直接下结论说该领域缺多少条。'],
  ])
    notes.addRow({ item, value });

  for (const each of [sheet, demand, notes]) {
    each.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    each.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF174D59' } };
    each.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    each.views = [{ state: 'frozen', ySplit: 1 }];
    each.eachRow((row, index) => {
      if (index > 1) row.alignment = { vertical: 'top', wrapText: true };
    });
    each.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: each.columns.length } };
  }
  const output = resolve(library, 'branch-v1', '_survey');
  await mkdir(output, { recursive: true });
  const path = resolve(output, '各领域缺口密度.xlsx');
  await book.xlsx.writeFile(path);
  await Bun.write(resolve(output, 'survey.json'), JSON.stringify({ schema: 'sanheng-branch-survey-v1', outcomes }, null, 2));
  console.log(`\n${path}`);
}
