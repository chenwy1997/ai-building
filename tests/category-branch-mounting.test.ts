import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Dictionary } from '../src/scenarios/category_attributes_governance/dictionary/contracts.ts';
import { applyDecisions, baseDictionary } from '../src/scenarios/category_attributes_governance/dictionary/canonical/build.ts';
import type { DecisionFile } from '../src/scenarios/category_attributes_governance/dictionary/canonical/build.ts';
import type { NameEvidence } from '../src/scenarios/category_attributes_governance/dictionary/canonical/extract.ts';
import { guidance } from '../src/scenarios/category_attributes_governance/dictionary/canonical/guidance.ts';
import { validateGuidance } from '../src/scenarios/category_attributes_governance/dictionary/canonical/mounting.ts';
import { branchContext, collectBranch, consistency, mount, parseBase, parseLeaf, parseMergedGaps, shortlist } from '../src/scenarios/category_attributes_governance/dictionary/canonical/branch/build.ts';
import { flangeBranch } from '../src/scenarios/category_attributes_governance/dictionary/canonical/branch/spec.ts';

const canonical = resolve(import.meta.dir, '../src/scenarios/category_attributes_governance/dictionary/canonical');
const library = resolve(import.meta.dir, '../src/scenarios/category_attributes_governance/workspace/dictionary/v1');

async function dictionaryOf(): Promise<Dictionary> {
  const decisions = resolve(canonical, 'decisions');
  const files = (await readdir(decisions)).filter((name) => name.endsWith('.json')).sort();
  let dictionary = baseDictionary;
  for (const file of files) {
    const decision = (await Bun.file(resolve(decisions, file)).json()) as DecisionFile;
    const pack = await Bun.file(resolve(library, 'canonical-v1/packages', `batch-${String(decision.batch).padStart(4, '0')}.json`)).json();
    dictionary = applyDecisions(dictionary, decision, pack.names as NameEvidence[]).dictionary;
  }
  return dictionary;
}

const branchOf = () => {
  const db = new Database(resolve(library, 'attribute-library-v1.sqlite'), { readonly: true });
  try {
    return collectBranch(db, flangeBranch, new Set());
  } finally {
    db.close();
  }
};

describe('分支挂载', () => {
  test('候选集把全字典收窄到可选规模，且覆盖法兰的选型需求', async () => {
    const dictionary = await dictionaryOf();
    validateGuidance(dictionary, guidance);
    const list = shortlist(dictionary, guidance, flangeBranch);

    // The point of the facet shortlist: selection from a few dozen, not the whole dictionary.
    expect(list.length).toBeGreaterThan(20);
    expect(list.length).toBeLessThan(dictionary.properties.length * 0.4);

    const ids = list.map((item) => item.propertyId);
    for (const needed of ['sh.pipe.nominal_diameter_dn', 'sh.pressure.nominal_rating', 'sh.material.body', 'sh.standard.compliance', 'sh.pipe.connection_form'])
      expect(ids).toContain(needed);
    // Nothing from an unrelated domain should reach a pipe-fitting branch.
    for (const unrelated of ['sh.pharma.strength', 'sh.textile.upf_rating', 'sh.service.provider']) expect(ids).not.toContain(unrelated);
    // Definitions must come through verbatim so a caller cannot restate them.
    const dn = list.find((item) => item.propertyId === 'sh.pipe.nominal_diameter_dn')!;
    expect(dn.revision).toBe(dictionary.properties.filter((p) => p.id === dn.propertyId).at(-1)!.revision);
    expect(dn.selectWhen.length).toBeGreaterThan(0);
  });

  test('分支证据是历史模板的忠实聚合，16个兄弟的漂移可被量出来', () => {
    const evidence = branchOf();
    expect(evidence.leaves.length).toBe(16);
    const named = new Map(evidence.leaves.map((leaf) => [leaf.leafName, leaf]));
    expect(named.has('带颈对焊法兰(WN)')).toBe(true);

    // The defect this branch is meant to expose: a pressure rating on almost no sibling.
    const withPressure = evidence.leaves.filter((leaf) => leaf.historical.some((item) => item.name === '压力等级'));
    expect(withPressure.length).toBeLessThan(3);
    const withDn = evidence.leaves.filter((leaf) => leaf.historical.some((item) => item.name === '公称通径'));
    expect(withDn.length).toBeLessThan(evidence.leaves.length);
  });

  test('模型只能从候选集里选，越界与无理由一律拒收', async () => {
    const dictionary = await dictionaryOf();
    const list = shortlist(dictionary, guidance, flangeBranch);

    expect(() => parseBase(JSON.stringify({ base: [{ propertyId: 'sh.invented.thing', requirement: 'required', rationale: '法兰要用' }] }), list)).toThrow(/候选集之外/);
    // A property that exists in the dictionary but is not on this branch's shortlist.
    expect(() => parseBase(JSON.stringify({ base: [{ propertyId: 'sh.textile.upf_rating', requirement: 'required', rationale: '法兰要用' }] }), list)).toThrow(/候选集之外/);
    expect(() => parseBase(JSON.stringify({ base: [{ propertyId: 'sh.own.brand', requirement: 'required', rationale: '  ' }] }), list)).toThrow(/rationale/);
    expect(() => parseBase(JSON.stringify({ base: [{ propertyId: 'sh.own.brand', requirement: 'conditional', rationale: '有品牌时' }] }), list)).toThrow(/condition/);
    expect(() => parseBase(JSON.stringify({ base: [] }), list)).toThrow(/非空数组/);
    expect(() =>
      parseBase(JSON.stringify({ base: [{ propertyId: 'sh.own.brand', requirement: 'required', rationale: '一' }, { propertyId: 'sh.own.brand', requirement: 'optional', rationale: '二' }] }), list),
    ).toThrow(/重复选择/);

    // Revision is filled by the program, so a model cannot pin a stale definition.
    const parsed = parseBase(JSON.stringify({ base: [{ propertyId: 'sh.own.brand', revision: 99, requirement: 'required', rationale: '法兰按品牌采购' }] }), list);
    expect(parsed.base[0]!.revision).toBe(list.find((item) => item.propertyId === 'sh.own.brand')!.revision);
  });

  test('挂载后兄弟一致性显著高于历史，差异必须带理由才存在', async () => {
    const dictionary = await dictionaryOf();
    const evidence = branchOf();
    const list = shortlist(dictionary, guidance, flangeBranch);
    const pick = (id: string, requirement: 'required' | 'optional' = 'required') => ({ propertyId: id, requirement, rationale: `法兰按${id}选型` });
    const { base } = parseBase(
      JSON.stringify({
        base: ['sh.own.brand', 'sh.own.model', 'sh.standard.compliance', 'sh.material.body', 'sh.pipe.nominal_diameter_dn', 'sh.pressure.nominal_rating', 'sh.pipe.connection_form'].map((id) => pick(id)),
      }),
      list,
    );

    const deltas = evidence.leaves.map((leaf) => {
      const reply =
        leaf.leafName === '法兰配件'
          ? JSON.stringify({
              remove: [{ propertyId: 'sh.pipe.connection_form', reason: '兜底配件桶内不是成品法兰，没有统一的连接形式' }],
              add: [{ propertyId: 'sh.accessory.part_type', requirement: 'required', rationale: '兜底桶须区分桶内是哪个部件' }],
              gaps: [{ need: '密封面形式', object: '法兰密封面', why: '候选集里没有描述密封面形式的属性', historicalNames: ['密封面形式'] }],
            })
          : JSON.stringify({ gaps: [{ need: '密封面形式', object: '法兰密封面', why: '候选集里没有描述密封面形式的属性', historicalNames: ['密封面形式'] }] });
      return parseLeaf(reply, leaf, list);
    });

    const mounted = mount(dictionary, guidance, flangeBranch, base, deltas.map((item) => item.delta), deltas.flatMap((item) => item.gaps));
    const agreement = consistency(mounted.resolved);

    // History measured 0.66 mean / 0.25 min on these same 16 leaves.
    expect(agreement.meanJaccard).toBeGreaterThan(0.9);
    expect(agreement.sharedByAll.length).toBeGreaterThan(3);
    expect(agreement.sharedByAll).toContain('sh.pressure.nominal_rating');

    // Gaps are merged across leaves and carry who needs them, so they can be adjudicated.
    const gap = mounted.gaps.find((item) => item.need === '密封面形式')!;
    expect(gap.leaves.length).toBe(16);
    expect(mounted.gaps.every((item) => item.why.trim().length > 0)).toBe(true);

    // An unreasoned or fabricated delta cannot reach a template.
    const template = mounted.template;
    expect(() =>
      mount(dictionary, guidance, flangeBranch, base, [{ leafId: 'x', leafName: '假末级', remove: [{ propertyId: 'sh.own.brand', reason: '' }] }], []),
    ).toThrow(/理由/);
    expect(() =>
      mount(dictionary, guidance, flangeBranch, base, [{ leafId: 'x', leafName: '假末级', remove: [{ propertyId: 'sh.textile.upf_rating', reason: '不适用' }] }], []),
    ).toThrow(/基础集里没有/);
    expect(template.base.length).toBe(7);
  });

  test('缺口归并只由模型判定同义，涉及范围由程序算，且不得丢弃原始申报', () => {
    const raw = [
      { need: '密封面形式', object: '法兰密封面', why: '候选集无密封面形式', historicalNames: ['密封面形式'], leaves: ['平焊法兰', '法兰盖(BL)'] },
      { need: '法兰厚度', object: '法兰盘', why: '候选集无盘体厚度', historicalNames: ['法兰厚度'], leaves: ['平焊法兰'] },
      { need: '法兰盖厚度', object: '法兰盘', why: '候选集无盘体厚度', historicalNames: ['厚度'], leaves: ['法兰盖(BL)'] },
    ];
    // Reports are referenced by index: `need` is not unique, three leaves all say 密封面形式.
    const thickness = { need: '法兰厚度', object: '法兰盘', type: 'number', quantity: 'length', units: ['mm'], why: '承压与刚度的直接尺寸', from: [2, 3], note: '' };
    const face = { need: '密封面形式', object: '法兰密封面', type: 'text', quantity: null, units: [], why: '决定与垫片的密封配合', from: [1], note: '' };

    const { gaps: merged } = parseMergedGaps(JSON.stringify({ gaps: [face, thickness] }), raw);
    // Leaf coverage is arithmetic over the absorbed reports, not something the model reports.
    expect(merged.find((gap) => gap.need === '法兰厚度')!.leaves).toEqual(['平焊法兰', '法兰盖(BL)']);
    expect(merged.find((gap) => gap.need === '法兰厚度')!.historicalNames).toEqual(['厚度', '法兰厚度']);
    expect(merged.find((gap) => gap.need === '密封面形式')!.leaves.length).toBe(2);

    // A merge that quietly drops a report would understate what the dictionary is missing.
    expect(() => parseMergedGaps(JSON.stringify({ gaps: [face] }), raw)).toThrow(/漏掉了原始申报/);
    // One report can feed two gaps: 防寒服 filed 充绒量 and 含绒量 as one line and they are
    // different properties. The leaf genuinely needs both, so coverage is not inflated.
    const split = parseMergedGaps(JSON.stringify({ gaps: [face, thickness, { ...face, need: '密封面加工精度', from: [1] }] }), raw);
    expect(split.gaps.map((gap) => gap.need).sort()).toEqual(['密封面加工精度', '密封面形式', '法兰厚度']);
    expect(split.gaps.find((gap) => gap.need === '密封面加工精度')!.leaves).toEqual(['平焊法兰', '法兰盖(BL)']);
    // A report claimed as both a gap and already ruled out is the consolidator being torn.
    // The ruling holds — it was adjudicated with reasons — and the gap argument rides along as
    // the grounds for reopening it, so a person settles it instead of the parser guessing.
    const torn = parseMergedGaps(
      JSON.stringify({ gaps: [face, thickness], ruledOut: [{ from: [1], ruling: 'q-功能', why: '作用宣称不进字典' }] }),
      raw,
    );
    expect(torn.gaps.map((gap) => gap.need)).toEqual(['法兰厚度']);
    expect(torn.ruledOut[0]!.contested).toContain('密封面形式');

    // Claiming a report is both missing and already covered is a contradiction with no default.
    expect(() =>
      parseMergedGaps(
        JSON.stringify({ gaps: [face, thickness], notGaps: [{ from: [1], coveredBy: 'sh.own.brand', why: '其实已覆盖' }] }),
        raw,
      ),
    ).toThrow(/不能同时成立/);
    expect(() => parseMergedGaps(JSON.stringify({ gaps: [face, { ...thickness, from: [2, 3, 9] }] }), raw)).toThrow(/不存在的申报序号/);
    // The dictionary's own numeric constraint applies to a proposed gap too.
    expect(() => parseMergedGaps(JSON.stringify({ gaps: [face, { ...thickness, quantity: null, units: [] }] }), raw)).toThrow(/物理量与单位/);
    expect(() => parseMergedGaps(JSON.stringify({ gaps: [{ ...face, quantity: 'length', units: ['mm'] }, thickness] }), raw)).toThrow(/不得带物理量或单位/);
    expect(() => parseMergedGaps(JSON.stringify({ gaps: [face, { ...thickness, type: 'decimal' }] }), raw)).toThrow(/未知值类型/);

    // A report the consolidator attributes to an existing property is a guidance defect, not
    // a missing property, and must be told apart from a real gap.
    const covered = parseMergedGaps(
      JSON.stringify({ gaps: [face], notGaps: [{ from: [2, 3], coveredBy: 'sh.geometry.overall_thickness', why: '整体厚度已覆盖法兰盘厚度，只是选用说明只写了板材' }] }),
      raw,
      new Set(['sh.geometry.overall_thickness']),
    );
    expect(covered.gaps.length).toBe(1);
    expect(covered.notGaps[0]!.reports.flatMap((report) => report.leaves)).toEqual(['平焊法兰', '法兰盖(BL)']);
    expect(() =>
      parseMergedGaps(JSON.stringify({ gaps: [face], notGaps: [{ from: [2, 3], coveredBy: 'sh.made.up', why: '瞎写' }] }), raw, new Set(['sh.geometry.overall_thickness'])),
    ).toThrow(/coveredBy 指向不存在的属性/);
  });

  test('请求上下文带着证据性质声明，不把历史当成正确答案', async () => {
    const dictionary = await dictionaryOf();
    const evidence = branchOf();
    const context = branchContext(flangeBranch, evidence, shortlist(dictionary, guidance, flangeBranch), 'hash') as Record<string, unknown>;
    expect(String(context['证据性质'])).toContain('历史上有不代表该有');
    expect(String(context['证据性质'])).toContain('出现频次不证明必填');
    expect((context['末级类目'] as unknown[]).length).toBe(16);
  });
});
