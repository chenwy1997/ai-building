import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Dictionary } from '../../contracts.ts';
import { digest } from '../../contracts.ts';
import { guidance } from '../guidance.ts';
import { openQuestions, rulings } from '../questions.ts';
import type { LeafDelta } from '../mounting.ts';
import { validateGuidance } from '../mounting.ts';
import { ProducerConversation } from '../../../conversation.ts';
import { Meter, PRICE } from '../../../meter.ts';
import { deepseekRuntime } from '../../../../../ai/deepseek-runtime.ts';
import { branchContext, collectBranch, consistency, mount, numberedGaps, parseBase, parseLeaf, parseMergedGaps, shortlist } from './build.ts';
import type { BranchEvidence, Candidate, Gap, MergedGap, NotGap, RuledOut } from './build.ts';
import { baseSystem, branches, gapSystem, leafSystem } from './spec.ts';
import type { BranchSpec } from './spec.ts';
import { deriveSpec } from './autospec.ts';

const scenario = resolve(import.meta.dir, '../../..');
const library = resolve(scenario, 'workspace/dictionary/v1');
const canonical = resolve(library, 'canonical-v1');
const dbPath = resolve(library, 'attribute-library-v1.sqlite');

interface Prepared {
  spec: BranchSpec;
  dictionary: Dictionary;
  dictionaryHash: string;
  evidence: BranchEvidence;
  list: Candidate[];
  context: unknown;
  /** Historical attribute name to the property ids it was merged into, from the batches. */
  historyToProperties: Map<string, string[]>;
  output: string;
}

/**
 * Every third-level branch that carries the given node name. Ambiguity is real — 配件 and
 * 其他 recur all over the taxonomy — so the caller has to disambiguate rather than have one
 * silently picked.
 */
function branchPathsNamed(db: Database, node: string): string[][] {
  const rows = db.query(`SELECT DISTINCT path FROM candidates_v1 WHERE namespace = 'sanheng'`).all() as Array<{ path: string }>;
  const found = new Map<string, string[]>();
  for (const row of rows) {
    const path = JSON.parse(row.path) as string[];
    if (path.length < 3) continue;
    const branch = path.slice(1, -1);
    if (branch.at(-1) === node) found.set(branch.join('/'), branch);
  }
  return [...found.values()];
}

async function prepare(name: string): Promise<Prepared> {
  const dictionaryPath = resolve(canonical, 'property-dictionary.json');
  if (!(await Bun.file(dictionaryPath).exists())) throw new Error('缺少冻结字典，请先执行 canonical compile');
  const dictionary = (await Bun.file(dictionaryPath).json()) as Dictionary;
  validateGuidance(dictionary, guidance);

  const mapping = (await Bun.file(resolve(canonical, 'name-mapping.json')).json()) as { rows: Array<{ name: string; action: string; propertyId: string | null }> };
  const mapped = new Set(mapping.rows.filter((row) => row.action !== 'defer').map((row) => row.name));
  // A historical name may have been split across several properties, so this is one-to-many.
  const historyToProperties = new Map<string, string[]>();
  for (const row of mapping.rows) {
    if (!row.propertyId) continue;
    const seen = historyToProperties.get(row.name) ?? [];
    if (!seen.includes(row.propertyId)) historyToProperties.set(row.name, [...seen, row.propertyId]);
  }

  // A hand-written spec wins when there is one: the four pilots carry a premise stating which
  // dictionary judgement they were chosen to test, and that reasoning should not be
  // overwritten by derivation. Everything else derives its own, which is what makes the
  // remaining 1,623 branches reachable at all.
  const db = new Database(dbPath, { readonly: true });
  let spec: BranchSpec;
  let evidence: BranchEvidence;
  try {
    const authored = branches[name];
    if (authored) {
      spec = authored;
      evidence = collectBranch(db, spec, mapped);
    } else {
      const paths = branchPathsNamed(db, name);
      if (!paths.length)
        throw new Error(`类目树里没有名为「${name}」的三级分支；手写分支可选: ${Object.keys(branches).join('、')}`);
      if (paths.length > 1)
        throw new Error(`「${name}」在类目树里有 ${paths.length} 处，请用完整路径指明:\n  ${paths.map((path) => path.join('/')).join('\n  ')}`);
      const provisional: BranchSpec = { branchPath: paths[0]!, facets: [], requiredDimensions: [], premise: '' };
      evidence = collectBranch(db, provisional, mapped);
      spec = deriveSpec(evidence, { targets: historyToProperties }, guidance);
    }
  } finally {
    db.close();
  }
  const list = shortlist(dictionary, guidance, spec);
  const dictionaryHash = digest(dictionary);
  return {
    spec,
    dictionary,
    dictionaryHash,
    evidence,
    list,
    context: branchContext(spec, evidence, list, dictionaryHash),
    historyToProperties,
    output: resolve(library, 'branch-v1', name),
  };
}

/**
 * Byte count on the same basis as the meter, so plan and run cannot disagree. Both bounds
 * are quoted because the gap between them is the whole point of reusing one cached prefix:
 * the floor assumes every leaf request hits the cache, the ceiling assumes none do.
 */
function estimate(context: unknown, leaves: number) {
  const prefix = Buffer.byteLength(JSON.stringify(context), 'utf8') + Buffer.byteLength(baseSystem, 'utf8') + 4096;
  const requests = 1 + leaves;
  const output = (requests * 2048 * PRICE.output) / 1e6;
  const floor = (prefix * PRICE.miss + prefix * leaves * PRICE.hit) / 1e6 + output;
  const ceiling = (prefix * requests * PRICE.miss) / 1e6 + output;
  return { prefix, requests, floor, ceiling };
}

async function plan(name: string) {
  const { spec, dictionary, evidence, list, context, output } = await prepare(name);
  await mkdir(output, { recursive: true });
  await Bun.write(resolve(output, '请求-基础集.json'), JSON.stringify({ system: baseSystem, context }, null, 2));
  await Bun.write(resolve(output, '请求-末级差异.json'), JSON.stringify({ system: leafSystem, leaves: evidence.leaves.map((leaf) => leaf.leafName) }, null, 2));

  const cost = estimate(context, evidence.leaves.length);
  const pairs = evidence.leaves.reduce((sum, leaf) => sum + leaf.historical.length, 0);
  console.log(`分支 ${spec.branchPath.join(' › ')}`);
  console.log(`  末级类目 ${evidence.leaves.length} 个，历史（属性名×末级）配对 ${pairs} 个`);
  console.log(`  候选集 ${list.length} 条（全字典 ${dictionary.properties.length} 条按召回标签 ${spec.facets.join('+')} 收窄）`);
  // Not "inexpressible": these names simply never entered the frequency batches, so the
  // model must either find a candidate that already covers them or report a gap.
  console.log(`  分支内未经批次判定的历史名 ${evidence.unmappedNames.length} 个: ${evidence.unmappedNames.join('、') || '无'}`);
  console.log(`\n共享前缀 ${cost.prefix.toLocaleString('en-US')} 字节，请求 ${cost.requests} 次（1次定基础集 + ${evidence.leaves.length}次末级差异）`);
  console.log(`估价 ${cost.floor.toFixed(4)} ~ ${cost.ceiling.toFixed(4)} 元（下限=末级请求全部命中缓存，上限=全部未命中；实际以 usage 结算）`);
  console.log(`\n请求体已写出，未调用任何接口: ${output}`);
}

export async function run(name: string, budget: number) {
  const prepared = await prepare(name);
  const { spec, dictionary, dictionaryHash, evidence, list, context, output } = prepared;
  await mkdir(output, { recursive: true });

  const runtime = await deepseekRuntime(true);
  const meter = new Meter(output, budget, runtime.chat);
  await meter.init();
  const ask = async (messages: ReturnType<ProducerConversation['request']>, phase: string, category: string) => {
    const response = await meter.request(
      {
        model: runtime.model,
        messages,
        temperature: 0,
        max_tokens: 8192,
        response_format: { type: 'json_object' },
        // Selection from a few dozen candidates is deliberately not a reasoning task. Left
        // enabled, Flash spends the whole completion budget on reasoning_content and
        // returns empty content at finish_reason=length.
        thinking: { type: 'disabled' },
      },
      category,
      phase,
    );
    const choice = response.choices[0];
    const reply = choice?.message?.content;
    if (choice?.finish_reason === 'length') throw new Error(`${phase} ${category} 输出被 max_tokens 截断，请调大后重试`);
    if (!reply?.trim()) throw new Error(`${phase} ${category} 返回空内容（finish_reason=${choice?.finish_reason ?? '未知'}）`);
    return reply;
  };

  const conversation = new ProducerConversation(baseSystem, context);
  const baseMessages = conversation.request('为本分支定出基础属性集', { 分支: spec.branchPath.join(' › ') });
  const baseReply = await ask(baseMessages, 'base', spec.branchPath.at(-1)!);
  // Latest revision of every dictionary property, so a selection the derived shortlist missed
  // can still be pinned instead of killing the branch. Derivation replaced hand-picked facets;
  // this is what keeps a slightly narrow shortlist from reading as a dictionary failure.
  const revisions = new Map<string, number>();
  for (const property of dictionary.properties)
    if ((revisions.get(property.id) ?? -1) < property.revision) revisions.set(property.id, property.revision);
  const recallMisses: Array<{ propertyId: string; where: string }> = [];

  const { base, gaps: baseGaps, recallMisses: baseMisses } = parseBase(baseReply, list, revisions);
  recallMisses.push(...baseMisses);
  conversation.commit(baseMessages, baseReply);
  console.log(`基础集 ${base.length} 条，缺口申报 ${baseGaps.length} 项`);

  // The leaf system prompt differs from the base one, so it is appended per request rather
  // than committed: every leaf request then shares the identical cached prefix.
  const deltas: LeafDelta[] = [];
  const collected: Gap[] = [...baseGaps];
  const dropped: string[] = [];
  for (const leaf of evidence.leaves) {
    const messages = [
      ...conversation.request('写出该末级类目相对基础属性集的差异', { 末级类目: leaf.leafName, 基础属性集: base.map((item) => item.propertyId) }),
      { role: 'system' as const, content: leafSystem },
    ];
    const reply = await ask(messages, 'leaf', leaf.leafName);
    const parsed = parseLeaf(reply, leaf, list, base, revisions);
    recallMisses.push(...parsed.recallMisses);
    deltas.push(parsed.delta);
    collected.push(...parsed.gaps);
    for (const note of parsed.dropped) dropped.push(`${leaf.leafName}: ${note}`);
    const { add, remove, override } = parsed.delta;
    console.log(`  ${leaf.leafName.padEnd(18)} 增${add?.length ?? 0} 删${remove?.length ?? 0} 改${override?.length ?? 0} 缺口${parsed.gaps.length}`);
  }
  if (dropped.length) console.log(`\n吸收的冗余动作 ${dropped.length} 条（不构成差异，已记入 manifest）`);

  const mounted = mount(dictionary, guidance, spec, base, deltas, collected);
  const agreement = consistency(mounted.resolved);

  // One extra request, because leaves report gaps independently and the same missing
  // property arrives several times under different names. Merging is semantic, so it stays
  // with the model; the raw reports are kept so any merge can be traced back.
  let merged: MergedGap[] = [];
  let notGaps: NotGap[] = [];
  let ruledOut: RuledOut[] = [];
  if (mounted.gaps.length) {
    const messages = [
      { role: 'system' as const, content: gapSystem },
      {
        role: 'user' as const,
        content: JSON.stringify({
          分支: spec.branchPath.join(' › '),
          原始缺口申报: numberedGaps(mounted.gaps),
          // Without this the consolidator has to guess whether an existing property covers a
          // report. A leaf that both mounted a property and flagged it as not quite fitting
          // is describing a wording problem, not a missing property.
          各末级实际挂载结果: Object.fromEntries(mounted.resolved.map((leaf) => [leaf.leafName, leaf.selections.map((selection) => selection.propertyId)])),
          已裁定事项: rulings(openQuestions),
          // The whole dictionary, not just the branch shortlist, because a report the shortlist
          // cannot express may still be a property the dictionary has — that is a recall failure
          // in the facet labels, not a missing property, and the two need opposite fixes. Facet
          // labels are now derived per branch rather than hand-picked, so a shortlist that comes
          // out too narrow would otherwise show up as fictitious dictionary gaps.
          全字典属性一览: [...new Map(dictionary.properties.map((property) => [property.id, property])).values()].map(
            (property) => `${property.id} ${property.name}（${property.type}${property.unitIds.length ? ' ' + property.unitIds.join('/') : ''}）${property.object}`,
          ),
        }),
      },
    ];
    const consolidated = parseMergedGaps(
      await ask(messages, 'gaps', spec.branchPath.at(-1)!),
      mounted.gaps,
      new Set(dictionary.properties.map((property) => property.id)),
      new Set(rulings(openQuestions).map((ruling) => ruling.编号)),
    );
    merged = consolidated.gaps;
    notGaps = consolidated.notGaps;
    ruledOut = consolidated.ruledOut;
    console.log(`\n缺口归并：${mounted.gaps.length} 条原始申报 → 真缺口 ${merged.length} 个、已被现有属性覆盖 ${notGaps.length} 条、命中已有裁定 ${ruledOut.length} 条`);
    for (const gap of merged) console.log(`  缺 ${gap.need.padEnd(12)} ${String(gap.leaves.length).padStart(2)}个末级  ${gap.type}${gap.units.length ? `(${gap.units.join('/')})` : ''}  合并自序号 ${gap.from.join('、')}`);
    for (const entry of notGaps) console.log(`  非缺口 ${entry.reports.map((report) => report.need).join('、')} → 已有 ${entry.coveredBy}，是引导没让末级选中它`);
    for (const entry of ruledOut) console.log(`  已裁定 ${entry.reports.map((report) => report.need).join('、')} → 命中 ${entry.ruling}，按裁定处理，不进字典`);
  }
  const usage = meter.summary();

  await Bun.write(resolve(output, 'branch-template.json'), JSON.stringify(mounted.template, null, 2));
  await Bun.write(
    resolve(output, 'mounted.json'),
    JSON.stringify(
      { schema: 'sanheng-branch-mounted-v1', dictionaryHash, resolved: mounted.resolved, findings: mounted.findings, rawGaps: mounted.gaps, gaps: merged, notGaps, ruledOut, agreement },
      null,
      2,
    ),
  );
  await Bun.write(
    resolve(output, 'manifest.json'),
    JSON.stringify(
      {
        schema: 'sanheng-branch-manifest-v1',
        generatedAt: new Date().toISOString(),
        branchPath: spec.branchPath,
        premise: spec.premise,
        dictionaryHash,
        model: runtime.model,
        leaves: mounted.resolved.length,
        baseSize: base.length,
        findings: mounted.findings.length,
        rawGapReports: mounted.gaps.length,
        gaps: merged.length,
        notGaps: notGaps.length,
        ruledOut: ruledOut.length,
        absorbedRedundantActions: dropped,
        // Properties the model wanted that the derived shortlist did not offer. Zero means the
        // derivation was wide enough for this branch; a long list means its facet labels need
        // widening, and is not a dictionary gap.
        recallMisses,
        agreement,
        usage,
        status: '挂载初稿，已通过契约校验与结构检查；未经品类专家验收，不得作为正式模板发布',
      },
      null,
      2,
    ),
  );
  const path = await workbook(prepared, mounted, merged, notGaps, ruledOut, agreement);

  console.log(`\n兄弟一致性：平均 Jaccard ${agreement.meanJaccard.toFixed(2)}，最低 ${agreement.minJaccard.toFixed(2)}，全兄弟共有 ${agreement.sharedByAll.length} 条`);
  console.log(`结构检查 ${mounted.findings.length} 条，字典真缺口 ${merged.length} 个，引导召回不到 ${notGaps.length} 条，命中已有裁定 ${ruledOut.length} 条`);
  if (recallMisses.length) {
    const unique = [...new Set(recallMisses.map((miss) => miss.propertyId))];
    console.log(`候选集漏给了 ${unique.length} 条字典已有属性，模型仍点名要（已接受并记入 manifest）: ${unique.join('、')}`);
  }
  console.log(`请求 ${usage.requests} 次，本地复用 ${usage.localReplays} 次，缓存命中率 ${(usage.hitRate * 100).toFixed(1)}%，保守计费 ${usage.conservativeCny.toFixed(4)} 元`);
  console.log(`\n${path}`);
}

async function workbook(prepared: Prepared, mounted: ReturnType<typeof mount>, merged: MergedGap[], notGaps: NotGap[], ruledOut: RuledOut[], agreement: ReturnType<typeof consistency>) {
  const { spec, dictionary, evidence, output } = prepared;
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  const units = new Map(dictionary.units.map((unit) => [unit.id, unit.symbol]));
  const properties = new Map(dictionary.properties.map((property) => [`${property.id}@${property.revision}`, property]));
  const label = { required: '必填', conditional: '条件必填', optional: '选填' } as const;
  const types = { text: '文本', number: '数值', integer: '整数', boolean: '是否', range: '区间' } as const;
  const nameOf = (id: string) => dictionary.properties.find((property) => property.id === id)?.name ?? id;

  const template = book.addWorksheet('分支属性模板');
  template.columns = [
    { header: '末级类目', key: 'leaf', width: 20 },
    { header: '属性名称', key: 'name', width: 18 },
    { header: '属性ID', key: 'id', width: 38 },
    { header: '来源', key: 'source', width: 10 },
    { header: '填写要求', key: 'requirement', width: 10 },
    { header: '适用条件', key: 'condition', width: 30 },
    { header: '值类型', key: 'type', width: 8 },
    { header: '单位', key: 'unit', width: 10 },
    { header: '描述对象', key: 'object', width: 26 },
    { header: '定义', key: 'definition', width: 56 },
    { header: '选用理由', key: 'rationale', width: 52 },
    { header: '专家意见（同意/删除/改必填）', key: 'verdict', width: 26 },
  ];
  for (const leaf of mounted.resolved) {
    const added = new Set(leaf.added);
    const overridden = new Set(leaf.overridden);
    for (const selection of leaf.selections) {
      const property = properties.get(`${selection.propertyId}@${selection.revision}`)!;
      const unitId = selection.unitId ?? property.unitIds[0];
      template.addRow({
        leaf: leaf.leafName,
        name: property.name,
        id: property.id,
        source: added.has(property.id) ? '末级新增' : overridden.has(property.id) ? '末级改策略' : '分支基础集',
        requirement: label[selection.requirement],
        condition: selection.condition ?? '',
        type: types[property.type],
        unit: unitId ? units.get(unitId) ?? '' : '',
        object: property.object,
        definition: property.definition,
        rationale: selection.rationale,
        verdict: '',
      });
    }
  }

  const base = book.addWorksheet('分支基础集');
  base.columns = [
    { header: '属性名称', key: 'name', width: 18 },
    { header: '属性ID', key: 'id', width: 38 },
    { header: '填写要求', key: 'requirement', width: 10 },
    { header: '适用条件', key: 'condition', width: 30 },
    { header: '选用理由', key: 'rationale', width: 60 },
    { header: '被哪些末级删除', key: 'removed', width: 30 },
    { header: '被哪些末级改策略', key: 'overridden', width: 30 },
  ];
  for (const selection of mounted.template.base) {
    const property = properties.get(`${selection.propertyId}@${selection.revision}`)!;
    base.addRow({
      name: property.name,
      id: property.id,
      requirement: label[selection.requirement],
      condition: selection.condition ?? '',
      rationale: selection.rationale,
      removed: mounted.resolved.filter((leaf) => leaf.removed.includes(property.id)).map((leaf) => leaf.leafName).join('、'),
      overridden: mounted.resolved.filter((leaf) => leaf.overridden.includes(property.id)).map((leaf) => leaf.leafName).join('、'),
    });
  }

  const delta = book.addWorksheet('末级差异与理由');
  delta.columns = [
    { header: '末级类目', key: 'leaf', width: 20 },
    { header: '差异', key: 'kind', width: 12 },
    { header: '属性名称', key: 'name', width: 18 },
    { header: '属性ID', key: 'id', width: 38 },
    { header: '理由（差异必须能被兄弟间区别解释）', key: 'reason', width: 70 },
    { header: '专家意见', key: 'verdict', width: 20 },
  ];
  for (const leaf of mounted.template.leaves) {
    for (const item of leaf.add ?? []) delta.addRow({ leaf: leaf.leafName, kind: '新增', name: nameOf(item.propertyId), id: item.propertyId, reason: item.rationale, verdict: '' });
    for (const item of leaf.remove ?? []) delta.addRow({ leaf: leaf.leafName, kind: '删除', name: nameOf(item.propertyId), id: item.propertyId, reason: item.reason, verdict: '' });
    for (const item of leaf.override ?? []) delta.addRow({ leaf: leaf.leafName, kind: `改为${label[item.requirement]}`, name: nameOf(item.propertyId), id: item.propertyId, reason: item.reason, verdict: '' });
  }

  const gaps = book.addWorksheet('字典缺口');
  gaps.columns = [
    { header: '缺什么', key: 'need', width: 18 },
    { header: '描述对象', key: 'object', width: 22 },
    { header: '建议值类型', key: 'type', width: 10 },
    { header: '物理量', key: 'quantity', width: 12 },
    { header: '建议单位', key: 'units', width: 14 },
    { header: '涉及数', key: 'count', width: 8 },
    { header: '为什么字典需要补', key: 'why', width: 56 },
    { header: '对应历史属性名', key: 'historicalNames', width: 22 },
    { header: '涉及末级类目', key: 'leaves', width: 38 },
    { header: '归并自申报序号', key: 'from', width: 16 },
    { header: '归并疑虑', key: 'note', width: 34 },
    { header: '裁定（补入字典/并入现有/不收）', key: 'verdict', width: 28 },
  ];
  for (const gap of merged)
    gaps.addRow({
      ...gap,
      type: types[gap.type],
      quantity: gap.quantity ?? '',
      units: gap.units.join(' / '),
      count: gap.leaves.length,
      historicalNames: gap.historicalNames.join('、'),
      leaves: gap.leaves.join('、'),
      from: gap.from.join('、'),
      verdict: '',
    });

  // The raw reports stay in the deliverable: a merge that looks wrong must be checkable
  // against what each leaf actually said, not just against the merged conclusion.
  const rawGaps = book.addWorksheet('缺口原始申报');
  rawGaps.columns = [
    { header: '序号', key: 'index', width: 6 },
    { header: '申报名', key: 'need', width: 18 },
    { header: '申报的描述对象', key: 'object', width: 30 },
    { header: '申报理由', key: 'why', width: 76 },
    { header: '对应历史属性名', key: 'historicalNames', width: 22 },
    { header: '申报末级类目', key: 'leaves', width: 38 },
  ];
  mounted.gaps.forEach((gap, index) => rawGaps.addRow({ ...gap, index: index + 1, historicalNames: gap.historicalNames.join('、'), leaves: gap.leaves.join('、') }));

  // Reports the consolidator attributed to an existing property. These are guidance defects,
  // not dictionary defects, and filing them as gaps would grow the dictionary for needs it
  // already covers.
  const recall = book.addWorksheet('引导召回不到');
  recall.columns = [
    { header: '末级申报的名字', key: 'need', width: 20 },
    { header: '其实已有的属性', key: 'coveredBy', width: 38 },
    { header: '属性名称', key: 'name', width: 18 },
    { header: '为何末级没选中它', key: 'why', width: 70 },
    { header: '涉及末级类目', key: 'leaves', width: 34 },
    { header: '处理（放宽选用说明/加召回标签/确认无关）', key: 'verdict', width: 34 },
  ];
  for (const entry of notGaps)
    recall.addRow({
      need: entry.reports.map((report) => report.need).join('、'),
      coveredBy: entry.coveredBy,
      name: nameOf(entry.coveredBy),
      why: entry.why,
      leaves: [...new Set(entry.reports.flatMap((report) => report.leaves))].join('、'),
      verdict: '',
    });

  // A report a standing ruling already disposed of. Kept visible so the ruling is seen to
  // hold rather than being quietly overturned one branch at a time.
  const settled = book.addWorksheet('命中已有裁定');
  settled.columns = [
    { header: '末级申报的名字', key: 'need', width: 20 },
    { header: '命中裁定', key: 'ruling', width: 16 },
    { header: '裁定怎么说，该末级应当怎么办', key: 'why', width: 62 },
    { header: '重开裁定的理由（归并时同时主张过是真缺口）', key: 'contested', width: 52 },
    { header: '涉及末级类目', key: 'leaves', width: 34 },
    { header: '复核（维持裁定/重开裁定）', key: 'verdict', width: 26 },
  ];
  for (const entry of ruledOut)
    settled.addRow({
      need: entry.reports.map((report) => report.need).join('、'),
      ruling: entry.ruling,
      why: entry.why,
      contested: entry.contested ?? '',
      leaves: [...new Set(entry.reports.flatMap((report) => report.leaves))].join('、'),
      verdict: '',
    });

  const check = book.addWorksheet('结构检查');
  check.columns = [
    { header: '末级类目', key: 'leafName', width: 20 },
    { header: '问题', key: 'code', width: 14 },
    { header: '说明', key: 'detail', width: 76 },
    { header: '涉及属性', key: 'propertyIds', width: 50 },
    { header: '处理', key: 'verdict', width: 24 },
  ];
  for (const finding of mounted.findings) check.addRow({ ...finding, propertyIds: finding.propertyIds.join('、'), verdict: '' });

  const compare = book.addWorksheet('与历史交付对照');
  compare.columns = [
    { header: '末级类目', key: 'leaf', width: 20 },
    { header: '历史属性数', key: 'before', width: 12 },
    { header: '本次属性数', key: 'after', width: 12 },
    { header: '历史有本次无', key: 'dropped', width: 40 },
    { header: '本次新补', key: 'gained', width: 40 },
    { header: '历史名未经批次判定，无法对照', key: 'unjudged', width: 34 },
  ];
  // Comparison goes through the batch mapping, not through property names: history called it
  // 公称通径 and the dictionary calls it 公称通径DN代号, so matching by name would report
  // every inherited property as newly added. A split name resolves to several properties
  // whose `when` clauses are mutually exclusive, so it counts as covered once any one of
  // them is mounted — demanding all of them would report 过流件材质 and 面料材质 as dropped
  // from every leaf that correctly mounted only 本体材质.
  for (const leaf of mounted.resolved) {
    const history = evidence.leaves.find((item) => item.leafId === leaf.leafId)!;
    const now = new Set(leaf.selections.map((selection) => selection.propertyId));
    const lost: string[] = [];
    const unjudged: string[] = [];
    for (const item of history.historical) {
      const ids = prepared.historyToProperties.get(item.name);
      if (!ids?.length) unjudged.push(item.name);
      else if (!ids.some((id) => now.has(id))) lost.push(`${item.name}（原归并到 ${ids.map(nameOf).join('/')}）`);
    }
    const historyIds = new Set(history.historical.flatMap((item) => prepared.historyToProperties.get(item.name) ?? []));
    compare.addRow({
      leaf: leaf.leafName,
      before: history.historical.length,
      after: leaf.selections.length,
      dropped: lost.join('；'),
      gained: [...now].filter((id) => !historyIds.has(id)).map(nameOf).join('、'),
      unjudged: unjudged.join('、'),
    });
  }

  const summary = book.addWorksheet('说明');
  summary.columns = [
    { header: '项', key: 'item', width: 24 },
    { header: '内容', key: 'value', width: 110 },
  ];
  for (const [item, value] of [
    ['分支', spec.branchPath.join(' › ')],
    ['试点前提', spec.premise],
    ['末级类目数', String(mounted.resolved.length)],
    ['分支基础集', `${mounted.template.base.length} 条`],
    ['候选集收窄', `全字典 ${dictionary.properties.length} 条 → 召回标签 ${spec.facets.join('+')} → 候选 ${prepared.list.length} 条`],
    ['兄弟一致性', `平均 Jaccard ${agreement.meanJaccard.toFixed(2)}，最低 ${agreement.minJaccard.toFixed(2)}，全兄弟共有 ${agreement.sharedByAll.length} 条。差异不是漂移：每一条增删改都在「末级差异与理由」页带着理由`],
    ['字典缺口', `${merged.length} 个真缺口，归并自 ${mounted.gaps.length} 条各末级独立申报；缺口是模型申报而非程序推断，须逐项裁定后才进字典`],
    ['引导召回不到', `${notGaps.length} 条：属性字典里已有，但引导的选用说明或召回标签没让末级类目选中它。这是引导缺陷不是字典缺陷，改引导即可，不新增属性`],
    ['命中已有裁定', `${ruledOut.length} 条：字典阶段已经裁定过不收。三个桶对应三种动作——真缺口加属性，引导召回不到改引导，命中裁定什么都不加`],
    ['其中有争议', `${ruledOut.filter((entry) => entry.contested).length} 条：归并时既命中裁定又被主张是真缺口。裁定默认维持，那一页带着重开的理由，请裁决维持还是重开`],
    ['结构检查', `${mounted.findings.length} 条，仅供审阅，不会自动改模板`],
    ['状态', '挂载初稿。属性定义来自冻结字典，不可在本表修改；本表只裁定该不该挂、必填与否'],
    ['证据性质', '历史属性数取自历史模板的忠实聚合，历史上有不代表该有，出现频次不证明必填'],
  ])
    summary.addRow({ item, value });

  for (const sheet of [template, base, delta, gaps, rawGaps, recall, settled, check, compare, summary]) {
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF174D59' } };
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.eachRow((row, index) => {
      if (index > 1) row.alignment = { vertical: 'top', wrapText: true };
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  }
  const path = resolve(output, `${spec.branchPath.at(-1)}属性模板-运营验收.xlsx`);
  await book.xlsx.writeFile(path);
  return path;
}

export async function main(argv = process.argv.slice(2)) {
  const action = argv[0] ?? 'help';
  const option = (key: string) => argv.find((item) => item.startsWith(`--${key}=`))?.slice(key.length + 3);
  const name = option('branch') ?? '法兰';
  if (action === 'plan') return plan(name);
  if (action === 'run') {
    const budget = Number(option('budget') ?? '2');
    if (!Number.isFinite(budget) || budget <= 0) throw new Error('--budget 必须为正数（元）');
    return run(name, budget);
  }
  if (action === 'survey') {
    const { survey } = await import('./survey.ts');
    return survey({
      perTopLevel: Number(option('per') ?? '1'),
      budget: Number(option('budget') ?? '0'),
      only: option('only')?.split(',').filter(Boolean),
    });
  }
  if (action !== 'help') throw new Error(`未知子命令: ${action}`);
  console.log(
    '分支属性挂载：把冻结字典挂到一个真实分支上，产出运营可验收的属性模板。\n' +
      '  plan --branch=法兰            本地组装证据与候选集，写出请求体并估价，不调用接口。\n' +
      '  run  --branch=法兰 --budget=2 定基础集，再逐末级类目写差异，最后归并缺口申报。\n' +
      '                                过 Meter 记账，响应本地缓存，改解析重跑不再计费。\n' +
      '  survey                        23个一级类目各抽一个分支，横向量各领域的缺口密度。\n' +
      '                                不带 --budget 只出抽样计划与估价，带上才真跑。\n' +
      `手写分支（带试点前提）: ${Object.keys(branches).join('、')}；其余分支的召回标签与必填维度由历史反推。\n` +
      '属性定义取自 canonical compile 的冻结字典；本阶段只决定挂不挂与必填与否，不改定义。\n' +
      '模型选不出来的需求记为缺口，不得发明属性ID。归并时区分两种缺口：字典真缺属性，\n' +
      '与字典已有但引导没召回到——后者改引导即可，混在一起会让字典为已覆盖的需求继续膨胀。',
  );
}

if (import.meta.main) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
