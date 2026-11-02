import { dictionaryHash } from '../../attribute-contract.mjs';

// Technical acceptance data only. No proposed changes to the 232 governed categories.
export const dictionary: any = {
  id: 'test.color', version: '1', name: '验收用颜色', definition: '只验证版本、别名和子集，不代表正式颜色全集',
  owner: '离线测试', status: 'candidate', newValuePolicy: 'review_new_version', sourceReferences: ['test-fixture:颜色配置验收'],
  values: [{ id: 'black', label: '黑', aliases: ['黑色'], status: 'active' }, { id: 'gray', label: '灰', aliases: ['灰色'], status: 'active' }, { id: 'old', label: '旧色', aliases: [], status: 'deprecated' }],
};
export const catalog = () => ({ version: 1, dictionaries: [structuredClone(dictionary)] });
const choice = (mode = 'single') => ({ mode, dimension: '验收用单一维度', rationale: mode === 'single' ? '验收用单值配置' : '验收用同一对象同时具有多个值', boundaryReferences: ['test-fixture:封闭值域验收'], minSelections: 1, maxSelections: mode === 'single' ? 1 : 2, mutuallyExclusive: [] });
export function proposal(type = 'text', mode = 'single'): any {
  const p: any = { categoryId: 'offline-a', category: '离线类型验收类目', key: `test.${type}.${mode}`, name: `验收${type}${mode}`,
    scope: 'SKU', type, unit: null, required: false, definition: `验收${type}${mode}的定义，不用于生产`, purpose: '离线验证类型配置',
    rules: ['未知不推断；示例仅为离线验收'], enumValues: [], sourceSpuCount: 0, evidenceKeys: [], sourceReferences: ['test-fixture:类型合同'],
    definitionId: `test.${type}.${mode}`, definitionVersion: '1', typing: { version: 1, rationale: '离线验收，非业务属性采用依据', object: '验收对象' },
    valueExamples: [{ value: '180×134 mm', origin: 'constructed' }] };
  if (type === 'text') p.typing.text = { formatHint: '保留组合顺序与单位', minLength: null, maxLength: null };
  if (type === 'number') { p.unit = '层'; p.typing.number = { quantityKind: 'layer_count', precision: 0, min: 1, max: null, constraintReferences: ['test-fixture:整数计数'] }; p.valueExamples[0].value = 3; }
  if (type === 'boolean') p.valueExamples[0].value = false;
  if (type === 'option') { p.enumValues = ['甲', '乙']; p.typing.choice = choice(mode); p.valueExamples[0].value = mode === 'single' ? '甲' : ['甲', '乙']; }
  if (type === 'dictionary') { p.typing.choice = choice(mode); p.typing.dictionary = { id: dictionary.id, version: dictionary.version, sha256: dictionaryHash(dictionary), allowedValueIds: ['black', 'gray'] }; p.valueExamples[0].value = mode === 'single' ? 'gray' : ['black', 'gray']; }
  return p;
}
export function packageFor(ps: any[]) {
  const categories = [...new Set(ps.map(p => p.categoryId))].map(id => ({ categoryId: id, category: ps.find(p => p.categoryId === id).category }));
  const draft = { attributeContractVersion: 1, categories, proposals: ps, candidateDecisions: ps.map(p => ({ categoryId: p.categoryId, category: p.category, sourceName: p.name, candidateName: p.name, decision: 'keep', reason: '离线配置验收，不是业务采用', evidenceKeys: [] })) };
  const pool = { categories: categories.map(c => ({ id: c.categoryId, name: c.category, products: [], evidence: [], pool: ps.filter(p => p.categoryId === c.categoryId).map(p => ({ name: p.name })) })) };
  const matrix = { families: [], standaloneCategories: categories.map(c => ({ categoryId: c.categoryId, reason: '离线类型验收对象' })) };
  return { draft, pool, matrix };
}
