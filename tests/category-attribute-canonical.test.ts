import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { batch, extract } from '../src/scenarios/category_attributes_governance/dictionary/canonical/extract.ts';
import type { NameEvidence } from '../src/scenarios/category_attributes_governance/dictionary/canonical/extract.ts';
import { applyDecisions, baseDictionary, mappingRows } from '../src/scenarios/category_attributes_governance/dictionary/canonical/build.ts';
import type { DecisionFile } from '../src/scenarios/category_attributes_governance/dictionary/canonical/build.ts';
import { renderBatch, renderName } from '../src/scenarios/category_attributes_governance/dictionary/canonical/render.ts';
import { validateDictionary } from '../src/scenarios/category_attributes_governance/dictionary/contracts.ts';
import { candidates, inspectLeaf, resolveLeaf, validateGuidance } from '../src/scenarios/category_attributes_governance/dictionary/canonical/mounting.ts';
import type { BranchTemplate } from '../src/scenarios/category_attributes_governance/dictionary/canonical/mounting.ts';
import { guidance, requiredDimensionsForGoods } from '../src/scenarios/category_attributes_governance/dictionary/canonical/guidance.ts';
import { openQuestions, pending, validateQuestions } from '../src/scenarios/category_attributes_governance/dictionary/canonical/questions.ts';
import type { OpenQuestion, QuestionSet } from '../src/scenarios/category_attributes_governance/dictionary/canonical/questions.ts';
import { openInventory, importSource } from '../src/scenarios/category_attributes_governance/dictionary/inventory.ts';
import type { Observation } from '../src/scenarios/category_attributes_governance/dictionary/inventory.ts';

function inventory(rows: Array<{ leaf: string; path: string[]; name: string; description?: string; type?: string; unit?: string }>) {
  const db = openInventory(':memory:');
  const observations: Observation[] = rows.map((row) => ({
    namespace: 'sanheng',
    category: { id: row.leaf, name: row.path.at(-1)!, path: row.path },
    property: { name: row.name, description: row.description ?? null, type: row.type ?? 'text', unit: row.unit ?? null, options: [], format: null },
  }));
  importSource(db, { label: '测试来源', kind: 'test', path: 'memory', content: JSON.stringify(rows) }, observations);
  return db;
}

const scopeOf = (names: string[], leaves = 10): NameEvidence[] =>
  names.map((name, index) => ({
    rank: index + 1, name, leafCategories: leaves, candidates: leaves,
    firstLevelSpread: [], variants: [], variantsTotal: 3, variantsSampled: 3,
    optionSamples: [], optionSamplesTruncated: false,
  }));

const decisions = (overrides: Partial<DecisionFile>): DecisionFile => ({
  schema: 'sanheng-canonical-decisions-v1', batch: 1, ranks: [1, 1], author: 'test', decisions: [], ...overrides,
});

describe('证据聚合', () => {
  test('按末级类目数排名，并保留每个变体的原始说明与单位', () => {
    const db = inventory([
      { leaf: 'a', path: ['根', '五金工具', '紧固件', '螺钉', '自攻钉'], name: '材质', description: '螺钉材质' },
      { leaf: 'b', path: ['根', '五金工具', '紧固件', '螺母', '六角螺母'], name: '材质', description: '螺母主体材质' },
      { leaf: 'c', path: ['根', '泵、阀及管路', '阀门', '手动阀门', '球阀'], name: '材质', description: '阀体主要材质' },
      { leaf: 'a', path: ['根', '五金工具', '紧固件', '螺钉', '自攻钉'], name: '长度', description: '螺钉公称长度', type: 'number', unit: 'mm' },
    ]);
    try {
      const result = extract(db);
      expect(result.names[0]!.name).toBe('材质');
      expect(result.names[0]!.leafCategories).toBe(3);
      expect(result.names[0]!.variantsTotal).toBe(3);
      // The described object survives verbatim; the program never normalises it away.
      expect(result.names[0]!.variants.map((v) => v.description).sort()).toEqual(['螺母主体材质', '螺钉材质', '阀体主要材质']);
      expect(result.names[1]!.variants[0]!.unit).toBe('mm');
    } finally { db.close(); }
  });

  test('剔除全体共有的路径前缀后再统计一级类目分布', () => {
    const db = inventory([
      { leaf: 'a', path: ['根', '五金工具', '紧固件', '螺钉', '自攻钉'], name: '品牌' },
      { leaf: 'c', path: ['根', '照明', '光源', 'LED光源', '灯泡'], name: '品牌' },
    ]);
    try {
      const result = extract(db);
      expect(result.commonPathPrefix).toEqual(['根']);
      expect(result.names[0]!.firstLevelSpread.map((s) => s.firstLevel).sort()).toEqual(['五金工具', '照明']);
    } finally { db.close(); }
  });

  test('批次按排名切分，不按语义分组', () => {
    const result = { names: scopeOf(['a', 'b', 'c', 'd', 'e']) } as never;
    expect(batch(result, 2).map((group) => group.length)).toEqual([2, 2, 1]);
    expect(() => batch(result, 0)).toThrow('批次大小');
  });
});

describe('模型请求的紧凑渲染', () => {
  const entry = (overrides: Partial<NameEvidence> = {}): NameEvidence => ({
    rank: 3, name: '材质', leafCategories: 6924, candidates: 13817,
    firstLevelSpread: [
      { firstLevel: '五金工具', leafCategories: 1915 },
      { firstLevel: '泵、阀及管路', leafCategories: 675 },
    ],
    variants: [
      { description: '主要材质', type: 'text', unit: null, format: 'a', requiredCount: 1, count: 1115, samplePaths: [['根', '运动相关', '体育用品', '乒乓球', '其他乒乓球装备']] },
      { description: '主要材质', type: 'text', unit: null, format: 'b', requiredCount: 1, count: 1106, samplePaths: [['根', '运动相关', '体育用品', '乒乓球', '其他乒乓球装备']] },
      { description: '阀体主要材质', type: 'text', unit: null, format: null, requiredCount: 0, count: 33, samplePaths: [['根', '泵、阀及管路', '阀门', '自动阀门', '过滤器']] },
    ],
    variantsTotal: 4180, variantsSampled: 3, optionSamples: ['不锈钢', '塑料'], optionSamplesTruncated: true,
    ...overrides,
  });

  test('同一说明在不同格式下的记录合并计数，并保留原文与示例类目', () => {
    const text = renderName(entry());
    expect(text).toContain('2221 [text|—] 主要材质');
    expect(text).toContain('← 乒乓球/其他乒乓球装备');
    expect(text).toContain('阀体主要材质');
    // 原始说明必须逐字保留，渲染不做任何名称归一化
    expect(text).not.toContain('本体材质');
  });

  test('标注变体总数与被截断的数量，不静默丢弃证据', () => {
    const text = renderName(entry(), { variantLines: 1 });
    expect(text).toContain('历史变体总数 4180');
    expect(text).toContain('（另有 1 种说明未列出）');
    expect(renderName(entry(), { spread: 1 })).toContain('另有 1 个一级类目');
    expect(renderName(entry())).toContain('值样本（采样，非封闭枚举）');
  });

  test('整批渲染带上判定前提，且远小于原始证据包', async () => {
    const names = [entry(), entry({ name: '长度', rank: 6 })];
    const text = renderBatch(names);
    expect(text).toContain('本批 2 个历史属性名');
    expect(text).toContain('同名不代表同义');
    expect(text).toContain('先去掉它再判断剩下的概念');
    expect(text.length).toBeLessThan(JSON.stringify(names).length);
  });
});

describe('归并决定的契约校验', () => {
  test('接受合并、拆分与待审，并统计折叠掉的变体', () => {
    const scope = scopeOf(['净重', '重量', '规格']);
    const { dictionary, coverage } = applyDecisions(baseDictionary, decisions({
      decisions: [
        { name: '净重', action: 'map', targets: [{ propertyId: 'sh.own.net_mass' }] },
        { name: '重量', action: 'map', targets: [{ propertyId: 'sh.own.net_mass' }] },
        { name: '规格', action: 'defer', reason: '含药品剂量与包装规格等多种含义，缺少共同测量对象。' },
      ],
    }), scope);
    expect(dictionary.properties.length).toBe(baseDictionary.properties.length);
    expect(coverage.mapped.names).toBe(2);
    expect(coverage.deferred.names).toBe(1);
    // Two different historical names collapsing onto one canonical id is the point of the task.
    expect(coverage.variantsCollapsed).toBe(6);
  });

  test('map只能有一个目标，split至少两个且每个要写适用情形', () => {
    const scope = scopeOf(['公称直径']);
    const split = (targets: Array<{ propertyId: string; when?: string }>) =>
      applyDecisions(baseDictionary, decisions({ decisions: [{ name: '公称直径', action: 'split', targets }] }), scope);
    expect(() => applyDecisions(baseDictionary, decisions({
      decisions: [{ name: '公称直径', action: 'map', targets: [{ propertyId: 'sh.geometry.bore_diameter' }, { propertyId: 'sh.geometry.shaft_diameter' }] }],
    }), scope)).toThrow('map只能有一个目标');
    expect(() => split([{ propertyId: 'sh.geometry.bore_diameter', when: '内径' }])).toThrow('split至少要有两个目标');
    expect(() => split([{ propertyId: 'sh.geometry.bore_diameter', when: '内径' }, { propertyId: 'sh.geometry.shaft_diameter' }])).toThrow('必须说明适用情形');
  });

  test('待审必须写理由且不能同时给出映射目标', () => {
    const scope = scopeOf(['适用场景']);
    expect(() => applyDecisions(baseDictionary, decisions({
      decisions: [{ name: '适用场景', action: 'defer', reason: '  ' }],
    }), scope)).toThrow('defer必须说明理由');
    expect(() => applyDecisions(baseDictionary, decisions({
      decisions: [{ name: '适用场景', action: 'defer', reason: '描述客户现场条件', targets: [{ propertyId: 'sh.own.brand' }] }],
    }), scope)).toThrow('defer不能同时给出映射目标');
  });

  test('本批每个属性名必须决定且只能决定一次，目标必须已存在', () => {
    const scope = scopeOf(['品牌', '型号']);
    expect(() => applyDecisions(baseDictionary, decisions({
      decisions: [{ name: '品牌', action: 'map', targets: [{ propertyId: 'sh.own.brand' }] }],
    }), scope)).toThrow('未决定');
    expect(() => applyDecisions(baseDictionary, decisions({
      decisions: [
        { name: '品牌', action: 'map', targets: [{ propertyId: 'sh.own.brand' }] },
        { name: '品牌', action: 'map', targets: [{ propertyId: 'sh.own.model' }] },
      ],
    }), scope)).toThrow('被决定两次');
    expect(() => applyDecisions(baseDictionary, decisions({
      decisions: [{ name: '品牌', action: 'map', targets: [{ propertyId: 'sh.does.not.exist' }] }],
    }), scope)).toThrow('映射目标不存在');
    expect(() => applyDecisions(baseDictionary, decisions({
      decisions: [{ name: '外径', action: 'map', targets: [{ propertyId: 'sh.own.brand' }] }],
    }), scopeOf(['外径']).concat(scopeOf(['品牌'])))).toThrow('未决定');
  });

  test('新属性沿用契约：数值属性必须有同量纲单位，代号类必须是文本', () => {
    const scope = scopeOf(['公称压力']);
    const propose = (overrides: Record<string, unknown>) => applyDecisions(baseDictionary, decisions({
      newUnits: [{ id: 'MPa', symbol: 'MPa', quantity: 'pressure' }],
      newProperties: [{
        id: 'sh.pressure.rated_working', name: '额定工作压力', definition: '正常连续工作压力。',
        object: '承压腔', type: 'number', unitIds: ['MPa'], excludedMeanings: ['最大工作压力'], qualifications: [],
        ...overrides,
      } as never],
      decisions: [{ name: '公称压力', action: 'map', targets: [{ propertyId: 'sh.pressure.rated_working' }] }],
    }), scope);
    expect(propose({}).dictionary.properties.at(-1)!.quantity).toBe('pressure');
    expect(() => propose({ unitIds: ['MPa', 'mm'] })).toThrow('单位物理量不匹配');
    expect(() => propose({ type: 'text' })).toThrow('非数值属性不能指定物理量');
    expect(() => propose({ type: 'number', unitIds: [] })).toThrow('数值属性缺少量纲');
  });

  test('已有属性不可被新增覆盖；扩展单位范围走新修订并保留原版本', () => {
    const scope = scopeOf(['长度']);
    expect(() => applyDecisions(baseDictionary, decisions({
      newProperties: [{ id: 'sh.own.brand', name: '品牌', definition: '改写', object: '目标商品', type: 'text', unitIds: [], excludedMeanings: [], qualifications: [] } as never],
      decisions: [{ name: '长度', action: 'map', targets: [{ propertyId: 'sh.own.brand' }] }],
    }), scope)).toThrow('已存在');

    const { dictionary } = applyDecisions(baseDictionary, decisions({
      newUnits: [{ id: 'cm', symbol: 'cm', quantity: 'length' }],
      amendUnitIds: [{ propertyId: 'sh.geometry.overall_length', unitIds: ['mm', 'cm', 'm'], reason: '历史候选在三种单位下均有使用' }],
      decisions: [{ name: '长度', action: 'map', targets: [{ propertyId: 'sh.geometry.overall_length' }] }],
    }), scope);
    const versions = dictionary.properties.filter((p) => p.id === 'sh.geometry.overall_length');
    expect(versions.map((p) => p.revision)).toEqual([1, 2]);
    expect(versions[0]!.unitIds).toEqual(['mm', 'm']);
    expect(versions[1]!.unitIds).toEqual(['mm', 'cm', 'm']);
    // Mapping always points at the newest revision so callers cannot silently use a stale unit list.
    expect(mappingRows(decisions({ decisions: [{ name: '长度', action: 'map', targets: [{ propertyId: 'sh.geometry.overall_length' }] }] }), dictionary, scope)[0]!.propertyName).toBe('总长');
  });

  test('单位不可被重定义，修订必须有实际变化和理由', () => {
    const scope = scopeOf(['长度']);
    const base = decisions({ decisions: [{ name: '长度', action: 'map', targets: [{ propertyId: 'sh.geometry.overall_length' }] }] });
    expect(() => applyDecisions(baseDictionary, { ...base, newUnits: [{ id: 'mm', symbol: '毫米', quantity: 'length' }] }, scope)).toThrow('不可被重定义');
    expect(() => applyDecisions(baseDictionary, { ...base, amendUnitIds: [{ propertyId: 'sh.geometry.overall_length', unitIds: ['mm', 'm'], reason: '无变化' }] }, scope)).toThrow('没有实际变化');
    expect(() => applyDecisions(baseDictionary, { ...base, amendUnitIds: [{ propertyId: 'sh.geometry.overall_length', unitIds: ['mm', 'm', 'cm'], reason: ' ' }] }, scope)).toThrow('缺少理由');
  });
});

describe('挂载引导与继承', () => {
  // 逐批叠加，与 compile 的顺序一致：引导必须对照累积到最新的字典校验，而不是只对第1批
  const dictionaryOf = async () => {
    const root = resolve(import.meta.dir, '../src/scenarios/category_attributes_governance');
    let dictionary = baseDictionary;
    for (let batch = 1; ; batch += 1) {
      const id = String(batch).padStart(4, '0');
      const evidence = resolve(root, `workspace/dictionary/v1/canonical-v1/packages/batch-${id}.json`);
      const decision = resolve(root, `dictionary/canonical/decisions/batch-${id}.json`);
      if (!(await Bun.file(evidence).exists()) || !(await Bun.file(decision).exists())) break;
      const decisionFile = (await Bun.file(decision).json()) as DecisionFile;
      const scope = (await Bun.file(evidence).json()).names as NameEvidence[];
      dictionary = applyDecisions(dictionary, decisionFile, scope).dictionary;
    }
    return dictionary === baseDictionary ? null : dictionary;
  };

  test('每条属性都有引导，互为口径与配对的关系必须双向声明', async () => {
    const dictionary = await dictionaryOf();
    if (!dictionary) return;
    expect(() => validateGuidance(dictionary, guidance)).not.toThrow();
    const ids = new Set(dictionary.properties.map((property) => property.id));
    expect(guidance.entries.length).toBe(ids.size);

    const oneSided = {
      schema: 'sanheng-mounting-guidance-v1' as const,
      entries: [
        { propertyId: 'sh.own.brand', dimension: '身份' as const, facets: ['通用'], selectWhen: '任何实物商品', alternativeOf: ['sh.own.model'] },
        { propertyId: 'sh.own.model', dimension: '身份' as const, facets: ['通用'], selectWhen: '有型号时' },
      ],
    };
    expect(() => validateGuidance(dictionary, oneSided)).toThrow('必须双向声明');
  });

  test('按行业标签召回候选：只占字典一小部分，且不串入别的行业', () => {
    // 字典会长到上千条，召回不可能永远是十条；要守的是“占比小”而不是绝对条数
    const total = guidance.entries.length;
    const pipe = candidates(guidance, ['通用', '实物', '管路', '流体']);
    expect(pipe.length / total).toBeLessThan(0.35);

    // 服务类目没有外形尺寸、材质、颜色：这些只对实物商品通用，不能靠“通用”标签串进来
    const service = candidates(guidance, ['通用', '服务']).map((entry) => entry.propertyId);
    expect(service).toContain('sh.service.lead_time');
    for (const off of ['sh.geometry.overall_length', 'sh.material.body', 'sh.appearance.color', 'sh.own.net_mass']) {
      expect(service).not.toContain(off);
    }

    expect(candidates(guidance, ['穿戴']).map((entry) => entry.propertyId)).toContain('sh.material.fabric');
    // 召回只决定“给选择者看什么”，不决定类目要挂什么
    expect(candidates(guidance, ['穿戴']).map((entry) => entry.propertyId)).not.toContain('sh.material.wetted');
    expect(candidates(guidance, ['不存在的标签'])).toEqual([]);
  });

  test('兄弟末级共享基础集，只能按写明理由的增删改产生差异', async () => {
    const dictionary = await dictionaryOf();
    if (!dictionary) return;
    const pick = (propertyId: string, requirement: 'required' | 'optional' | 'conditional' = 'required'): never =>
      ({ propertyId, revision: dictionary.properties.filter((p) => p.id === propertyId).sort((a, b) => b.revision - a.revision)[0]!.revision, requirement, rationale: '阀门选型基础维度' }) as never;
    const template: BranchTemplate = {
      schema: 'sanheng-branch-template-v1',
      branchPath: ['泵、阀及管路', '阀门', '手动阀门'],
      base: [pick('sh.own.brand'), pick('sh.own.model'), pick('sh.pipe.nominal_diameter_dn'), pick('sh.pressure.nominal_rating'), pick('sh.material.wetted'), pick('sh.pipe.connection_form')],
      leaves: [
        { leafId: 'v1', leafName: '手动截止阀' },
        { leafId: 'v2', leafName: '手动盲板阀', remove: [{ propertyId: 'sh.pipe.connection_form', reason: '盲板阀按夹装于两法兰之间交付，不单独描述连接形式' }] },
      ],
    };

    const first = resolveLeaf(dictionary, template, template.leaves[0]!);
    const second = resolveLeaf(dictionary, template, template.leaves[1]!);
    // 历史交付里这两个末级用了两套名字；继承之后差异只能是那一条显式删除
    expect(first.selections.length).toBe(6);
    expect(second.selections.length).toBe(5);
    expect(first.selections.map((s) => s.propertyId).filter((id) => !second.selections.some((o) => o.propertyId === id))).toEqual(['sh.pipe.connection_form']);
    expect(second.removed).toEqual(['sh.pipe.connection_form']);

    expect(() => resolveLeaf(dictionary, template, { leafId: 'v3', leafName: '手动球阀', remove: [{ propertyId: 'sh.pipe.connection_form', reason: '  ' }] })).toThrow('必须写理由');
    expect(() => resolveLeaf(dictionary, template, { leafId: 'v4', leafName: '手动闸阀', remove: [{ propertyId: 'sh.own.net_mass', reason: '不需要' }] })).toThrow('基础集里没有的属性');
    expect(() => resolveLeaf(dictionary, template, { leafId: 'v5', leafName: '手动蝶阀', add: [pick('sh.own.brand')] })).toThrow('已在基础集中');
    expect(() => resolveLeaf(dictionary, template, { leafId: 'v6', leafName: '手动针阀', override: [{ propertyId: 'sh.own.model', requirement: 'required', reason: '同上' }] })).toThrow('没有实际变化');
  });

  test('结构检查能发现缺身份、同需求两种口径、配对口径缺一半', async () => {
    const dictionary = await dictionaryOf();
    if (!dictionary) return;
    const pick = (propertyId: string): never =>
      ({ propertyId, revision: dictionary.properties.filter((p) => p.id === propertyId).sort((a, b) => b.revision - a.revision)[0]!.revision, requirement: 'optional', rationale: '测试' }) as never;
    const template: BranchTemplate = {
      schema: 'sanheng-branch-template-v1',
      branchPath: ['泵、阀及管路', '阀门', '手动阀门'],
      // 同时挂了PN等级代号与MPa数值，且没有任何身份属性，还只挂了O形圈线径而没挂内径
      base: [pick('sh.pressure.nominal_rating'), pick('sh.pressure.rated_working'), pick('sh.oring.cross_section_diameter')],
      leaves: [{ leafId: 'v1', leafName: '手动截止阀' }],
    };
    const findings = inspectLeaf(guidance, resolveLeaf(dictionary, template, template.leaves[0]!), requiredDimensionsForGoods);
    const codes = findings.map((finding) => finding.code);
    expect(codes).toContain('缺维度');
    expect(codes).toContain('同需求多口径');
    expect(codes).toContain('缺配对口径');
    expect(findings.find((finding) => finding.code === '同需求多口径')!.propertyIds.sort()).toEqual(['sh.pressure.nominal_rating', 'sh.pressure.rated_working']);
    expect(findings.find((finding) => finding.code === '缺配对口径')!.propertyIds).toContain('sh.oring.free_inner_diameter');

    // 同一对口径只报一次，不因为双向声明重复报
    expect(codes.filter((code) => code === '同需求多口径').length).toBe(1);
  });

  // 三个分支连续撤掉 10 组过强配对之后立的闸门。配对是必填约束，误报会让复核的人学会忽略结构检查，
  // 那比没有这个检查更糟。名单外的配对必须先在 guidance.ts 头部写明反证，再加进这里。
  test('配对口径限于已逐一反证过的名单，新增须先写反证', () => {
    const audited = new Set(
      [
        ['sh.geometry.overall_length', 'sh.geometry.overall_width'],
        ['sh.geometry.overall_height', 'sh.geometry.overall_length'],
        ['sh.geometry.overall_height', 'sh.geometry.overall_width'],
        ['sh.oring.cross_section_diameter', 'sh.oring.free_inner_diameter'],
        ['sh.battery.nominal_voltage', 'sh.battery.rated_capacity'],
        ['sh.shelflife.unopened', 'sh.storage.condition'],
        ['sh.configuration.sensor_included', 'sh.configuration.sensor_type'],
        ['sh.service.acceptance_requirement', 'sh.service.scope_and_quantity'],
        ['sh.pharma.dosage_form', 'sh.pharma.strength'],
      ].map((pair) => pair.sort().join('↔')),
    );
    const declared = new Set<string>();
    for (const entry of guidance.entries)
      for (const companion of entry.companions ?? []) declared.add([entry.propertyId, companion].sort().join('↔'));
    expect([...declared].filter((pair) => !audited.has(pair))).toEqual([]);

    // 配对是双向的，单边声明会让结构检查只在一个方向上生效
    for (const pair of declared) {
      const [left, right] = pair.split('↔') as [string, string];
      const lookup = (id: string) => guidance.entries.find((entry) => entry.propertyId === id);
      expect(lookup(left)?.companions ?? []).toContain(right);
      expect(lookup(right)?.companions ?? []).toContain(left);
    }
  });
});

describe('前批可被后续证据修正', () => {
  type Amendment = { trigger: string; what: string; why: string; legitimacy: string };
  const load = async (batch: string) => {
    const root = resolve(import.meta.dir, '../src/scenarios/category_attributes_governance');
    return (await Bun.file(resolve(root, `dictionary/canonical/decisions/batch-${batch}.json`)).json()) as
      DecisionFile & { amendments?: Amendment[] };
  };

  test('凡改过的批次都必须写明改了什么、依据是什么、为何有权改', async () => {
    for (const batch of ['0001', '0002', '0003']) {
      for (const amendment of (await load(batch)).amendments ?? []) {
        for (const field of [amendment.trigger, amendment.what, amendment.why, amendment.legitimacy]) {
          expect(field?.trim().length ?? 0).toBeGreaterThan(0);
        }
      }
    }
  });

  test('第3批把第2批打包的「适用人群」拆成性别与年龄段', async () => {
    const second = await load('0002');
    const ids = (second.newProperties ?? []).map((property) => property.id);
    expect(ids).not.toContain('sh.applicability.target_user');
    expect(ids).toContain('sh.applicability.gender');
    expect(ids).toContain('sh.applicability.age_band');

    const person = second.decisions.find((decision) => decision.name === '适用人群')!;
    expect(person.action).toBe('split');
    expect(person.targets!.map((target) => target.propertyId).sort()).toEqual(['sh.applicability.age_band', 'sh.applicability.gender']);
    // 「通用」在两个维度上都可能成立，不能当第三个取值混进来
    expect(person.defer!.map((deferral) => deferral.scope).join()).toContain('通用');
    expect((second.amendments ?? []).map((amendment) => amendment.trigger).join()).toContain('第3批');
  });

  test('q-区间值类型 裁定后，区间是一个值而不是两条属性，量程按被测量的量分列', async () => {
    const root = resolve(import.meta.dir, '../src/scenarios/category_attributes_governance');
    let dictionary = baseDictionary;
    for (const batch of ['0001', '0002', '0003']) {
      const evidence = resolve(root, `workspace/dictionary/v1/canonical-v1/packages/batch-${batch}.json`);
      if (!(await Bun.file(evidence).exists())) return;
      const file = (await Bun.file(resolve(root, `dictionary/canonical/decisions/batch-${batch}.json`)).json()) as DecisionFile;
      dictionary = applyDecisions(dictionary, file, (await Bun.file(evidence).json()).names as NameEvidence[]).dictionary;
    }
    const byId = (id: string) => dictionary.properties.filter((property) => property.id === id).sort((a, b) => b.revision - a.revision)[0];

    // 上下限两条属性的做法已撤回：拆开时类目只挂一侧在契约上合法，是结构漏洞
    for (const retired of ['sh.thermal.working_temperature_min', 'sh.thermal.working_temperature_max', 'sh.thermal.control_range_min', 'sh.thermal.control_range_max']) {
      expect(byId(retired)).toBeUndefined();
    }
    for (const ranged of ['sh.thermal.working_temperature', 'sh.thermal.control_range']) {
      expect(byId(ranged)!.type).toBe('range');
    }

    // 量程按被测量的量分列，量纲由属性本身固定而不是留到挂载时选
    const ranges = ['sh.metrology.measuring_range_temperature', 'sh.metrology.measuring_range_length', 'sh.metrology.measuring_range_pressure'];
    const quantities = ranges.map((id) => {
      expect(byId(id)!.type).toBe('range');
      expect(byId(id)!.unitIds.length).toBe(1);
      return byId(id)!.quantity;
    });
    expect(new Set(quantities).size).toBe(ranges.length);

    // 区间属性同样要有量纲与单位，不能当成文本混过去
    expect(() => validateDictionary(dictionary)).not.toThrow();
    expect(() => validateDictionary({
      ...dictionary,
      properties: [{ ...byId('sh.thermal.working_temperature')!, quantity: null, unitIds: [] }],
    })).toThrow('数值属性缺少量纲');
  });

  test('q-功能 裁定后，只收有单一测试方法的三项，标签本身不得成为取值', async () => {
    const feature = (await load('0002')).decisions.find((decision) => decision.name === '功能')!;
    expect(feature.action).toBe('split');
    expect(feature.targets!.map((target) => target.propertyId).sort()).toEqual([
      'sh.textile.air_permeability', 'sh.textile.hydrostatic_pressure', 'sh.textile.upf_rating',
    ]);
    // 测试方法分多套体系的与纯勾选项各留一条理由，不能笼统一句带过
    const scopes = feature.defer!.map((deferral) => deferral.scope).join();
    expect(scopes).toContain('耐磨');
    expect(scopes).toContain('预约');

    // 与粘度、硬度同一条原则：没有测试方法与标尺的标签不构成可比取值
    const props = (await load('0002')).newProperties!;
    for (const id of ['sh.textile.air_permeability', 'sh.textile.hydrostatic_pressure']) {
      const property = props.find((candidate) => candidate.id === id)!;
      expect(property.qualifications.join()).toContain('标签不构成取值');
    }
  });

  test('q-规格 实测后，「规格」与被它阻塞的「规格尺寸」都不能再留在待审', async () => {
    const spec = (await load('0001')).decisions.find((decision) => decision.name === '规格')!;
    expect(spec.action).toBe('split');
    // 实测的结论是以映射到已有属性为主，只新增三条已有属性接不住的
    const targets = spec.targets!.map((target) => target.propertyId);
    for (const existing of ['sh.packaging.unit_quantity', 'sh.content.net_mass', 'sh.thread.designation', 'sh.own.model']) {
      expect(targets).toContain(existing);
    }
    for (const added of ['sh.pharma.strength', 'sh.tool.across_flats', 'sh.paper.sheet_size_designation']) {
      expect(targets).toContain(added);
    }
    // 占位写法必须明确不给属性，否则占位会被固化成标准定义
    expect(spec.defer!.map((deferral) => deferral.scope).join()).toContain('配件');

    const size = (await load('0002')).decisions.find((decision) => decision.name === '规格尺寸')!;
    expect(size.action).toBe('split');
    expect(size.targets!.map((target) => target.propertyId)).toContain('sh.tool.across_flats');

    // 已裁定的问题必须留下结论，不能只改决定文件
    expect(openQuestions.questions.find((question) => question.id === 'q-规格')?.resolution?.verdict).toBeTruthy();
  });
});

describe('待裁定清单', () => {
  const set = (overrides: Partial<OpenQuestion>): QuestionSet => ({
    schema: 'sanheng-open-questions-v1',
    questions: [{
      id: 'q1', subject: '某属性名', question: '该不该保留？', kind: '业务归属', answerableBy: '业务负责人',
      evidence: [], defaultDecision: '暂不进入标准字典，保留在候选层。', reversible: true,
      reversibleBecause: '候选层保留原始记录。', impact: { leafCategories: 10 },
      ...overrides,
    }],
  });

  test('实际清单通过校验，每一项都有默认结论且可逆', () => {
    expect(() => validateQuestions(openQuestions)).not.toThrow();
    expect(openQuestions.questions.length).toBeGreaterThan(0);
    for (const question of openQuestions.questions) {
      expect(question.defaultDecision.trim().length).toBeGreaterThan(0);
      expect(question.reversible).toBe(true);
    }
    // 每个 defer 都必须在清单里有对应条目：待审属性名不能悄悄消失
    for (const id of ['q-规格', 'q-区间值类型', 'q-功能']) {
      expect(openQuestions.questions.map((question) => question.id)).toContain(id);
    }
    // 裁定过的问题必须留下结论、裁定人与日期，不能只改决定文件
    for (const id of ['q-规格', 'q-区间值类型', 'q-功能', 'q-适用场景']) {
      const resolution = openQuestions.questions.find((question) => question.id === id)?.resolution;
      expect(resolution?.verdict.trim().length ?? 0).toBeGreaterThan(0);
      expect(resolution?.by.trim().length ?? 0).toBeGreaterThan(0);
    }
    expect(pending(openQuestions).length).toBe(0);
    // 配件类型经实测已裁定，不应再留在清单里
    expect(openQuestions.questions.map((question) => question.subject).join()).not.toContain('配件类型');
  });

  test('不允许以等待作为状态：必须有默认结论且默认必须可逆', () => {
    expect(() => validateQuestions(set({ defaultDecision: '   ' }))).toThrow('不允许以等待作为状态');
    expect(() => validateQuestions(set({ reversible: false }))).toThrow('不可逆');
    expect(() => validateQuestions(set({ reversibleBecause: '' }))).toThrow('为何可逆');
  });

  test('能用手头数据实测的问题，未附证据不得上报给人', () => {
    expect(() => validateQuestions(set({ kind: '可实测', answerableBy: '现有数据实测', evidence: [] })))
      .toThrow('必须先附实测证据');
    expect(() => validateQuestions(set({ kind: '可实测', answerableBy: '现有数据实测', evidence: ['848条候选中取值与末级类目名重合0条'] })))
      .not.toThrow();
    expect(() => validateQuestions(set({ kind: '业务归属', answerableBy: '现有数据实测' }))).toThrow('类型应为可实测');
  });

  test('编号不得重复', () => {
    const duplicated = set({});
    duplicated.questions.push({ ...duplicated.questions[0]! });
    expect(() => validateQuestions(duplicated)).toThrow('编号重复');
  });
});

describe('第1批实际决定', () => {
  test('与冻结的证据包一起通过契约校验，且把复合写法拆开', async () => {
    const root = resolve(import.meta.dir, '../src/scenarios/category_attributes_governance');
    const file = resolve(root, 'dictionary/canonical/decisions/batch-0001.json');
    const evidence = resolve(root, 'workspace/dictionary/v1/canonical-v1/packages/batch-0001.json');
    if (!(await Bun.file(evidence).exists())) return; // 证据包在workspace，未构建时跳过
    const decisionFile = (await Bun.file(file).json()) as DecisionFile;
    const scope = (await Bun.file(evidence).json()).names as NameEvidence[];
    const { dictionary, coverage } = applyDecisions(baseDictionary, decisionFile, scope);

    expect(coverage.names).toBe(40);
    // 只剩「适用场景」：配件类型与规格都已由实测收回待审
    expect(coverage.deferred.names).toBe(1);
    const rows = mappingRows(decisionFile, dictionary, scope);
    // 尺寸与外形尺寸是长宽高合写，必须落到三个几何属性上，不保留复合文本属性
    for (const name of ['尺寸', '外形尺寸']) {
      expect(rows.filter((row) => row.name === name).map((row) => row.propertyId).sort()).toEqual([
        'sh.geometry.overall_height', 'sh.geometry.overall_length', 'sh.geometry.overall_width',
      ]);
    }
    // 分级代号与数值必须分开，否则两个行业的选型互相污染
    expect(rows.filter((row) => row.name === '公称直径').map((row) => row.propertyId).sort()).toEqual([
      'sh.fastener.shank_nominal_diameter', 'sh.pipe.nominal_diameter_dn',
    ]);
    expect(dictionary.properties.find((p) => p.id === 'sh.pipe.nominal_diameter_dn')!.type).toBe('text');
    // 跨名称合并：电压与额定电压、净重与重量指向同一标准属性
    const idsFor = (name: string) => rows.filter((row) => row.name === name).map((row) => row.propertyId);
    expect(idsFor('电压')).toContain('sh.electrical.rated_input_voltage');
    expect(idsFor('净重')).toEqual(idsFor('重量'));
  });
});
