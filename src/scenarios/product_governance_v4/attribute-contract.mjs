import { createHash } from 'node:crypto';

export const ATTRIBUTE_CONTRACT_VERSION = 1;
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const string = v => typeof v === 'string' && v.trim().length > 0;
const strings = v => Array.isArray(v) && v.length > 0 && v.every(string);
const unique = a => new Set(a).size === a.length;
const key = v => v.normalize('NFKC').trim().toLocaleLowerCase();
const finite = v => typeof v === 'number' && Number.isFinite(v);
export const stableJson = v => JSON.stringify(canonical(v));
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (!object(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canonical(v[k])]));
}
export const dictionaryHash = d => createHash('sha256').update(stableJson(d)).digest('hex');
const issue = (kind, path, message) => ({ kind, path, message });
const list = v => Array.isArray(v) ? v : [];
const meaningfulReferences = v => Array.isArray(v) && v.length > 0 && v.every(r => string(r) || (object(r) && string(r.sourceId) && string(r.locator)));

// Candidate dictionaries are versioned input data, never instructions or implicit approval.
/** @param {unknown} [catalog] External JSON is validated here, not assumed to be a valid registry. */
export function validateDictionaries(catalog = { version: 1, dictionaries: [] }) {
  const errors = [], add = (p, m) => errors.push(issue('dictionary_contract', p, m));
  if (!object(catalog) || catalog.version !== 1 || !Array.isArray(catalog.dictionaries)) return [issue('dictionary_contract', 'dictionaries', '需要 version=1 与 dictionaries 数组')];
  const identities = new Set();
  for (const [i, d] of catalog.dictionaries.entries()) {
    const p = `dictionaries[${i}]`;
    if (!object(d)) { add(p, '字典必须是对象'); continue; }
    for (const f of ['id', 'version', 'name', 'definition', 'owner', 'newValuePolicy']) if (!string(d[f])) add(`${p}.${f}`, '缺少非空字段');
    if (string(d.newValuePolicy) && d.newValuePolicy !== 'review_new_version') add(`${p}.newValuePolicy`, '新值须审校并发布新版本，不静默扩充');
    if (!['candidate', 'released', 'retired'].includes(d.status)) add(`${p}.status`, '状态为 candidate/released/retired');
    if (d.status === 'released' && !(object(d.approval) && ['by', 'at', 'reference'].every(f => string(d.approval[f])))) add(`${p}.approval`, 'released 必须带实际人工批准记录；程序仅核记录完整性');
    if (!meaningfulReferences(d.sourceReferences)) add(`${p}.sourceReferences`, '字典须有来源定位');
    const id = `${d.id}@${d.version}`;
    if (identities.has(id)) add(p, '字典 ID 与版本重复');
    identities.add(id);
    if (!Array.isArray(d.values) || !d.values.length) { add(`${p}.values`, '字典值不能为空'); continue; }
    const ids = new Set(), labels = new Map();
    for (const [j, v] of d.values.entries()) {
      const at = `${p}.values[${j}]`;
      if (!object(v)) { add(at, '字典值必须是对象'); continue; }
      if (!string(v.id) || !string(v.label) || !Array.isArray(v.aliases) || !v.aliases.every(string)) { add(at, '值必须含 id/label/aliases'); continue; }
      if (!['active', 'deprecated'].includes(v.status)) add(`${at}.status`, '值状态为 active/deprecated');
      if (ids.has(v.id)) add(`${at}.id`, '值 ID 重复');
      ids.add(v.id);
      for (const word of [v.label, ...v.aliases]) {
        const normalized = key(word);
        if (labels.has(normalized)) add(at, `标准名/别名冲突：${word}，已属于 ${labels.get(normalized)}`);
        labels.set(normalized, v.id);
      }
    }
  }
  return errors;
}

export function resolveDictionary(ref, catalog) {
  const matches = list(catalog?.dictionaries).filter(d => object(d) && d.id === ref?.id && d.version === ref?.version);
  if (matches.length !== 1) return { error: '字典 ID/版本不存在或不唯一' };
  const dictionary = matches[0];
  if (validateDictionaries({ version: 1, dictionaries: [dictionary] }).length) return { error: '引用的字典本身未通过合同检查' };
  if (dictionaryHash(dictionary) !== ref.sha256) return { error: '字典版本内容哈希不一致' };
  if (dictionary.status === 'retired') return { error: '不能新引用已退役字典' };
  return { dictionary };
}

function choices(p, catalog) {
  if (p.type === 'option') return list(p.typing?.choice?.allowedValues ?? p.enumValues);
  if (p.type === 'dictionary') return list(p.typing?.dictionary?.allowedValueIds);
  return [];
}

// Pure value checking. No coercion, unit conversion, alias replacement or default filling.
/** @param {unknown} [catalog] */
export function validateAttributeValue(p, value, catalog = { version: 1, dictionaries: [] }) {
  const errors = [], add = m => errors.push(m), t = p.typing ?? {};
  if (value === null) return errors; // unknown is a value state, not false/0/empty string
  if (p.type === 'text') {
    if (!string(value)) add('文本需非空字符串；未知用 null');
    else {
      const length = Array.from(value).length, c = t.text;
      if (c?.minLength != null && length < c.minLength) add('文本短于 minLength');
      if (c?.maxLength != null && length > c.maxLength) add('文本长于 maxLength');
    }
  } else if (p.type === 'number') {
    if (!finite(value)) add('数值需有限 number，不接受带单位字符串或布尔');
    else {
      const n = t.number;
      if (n?.min != null && value < n.min) add('数值小于 min');
      if (n?.max != null && value > n.max) add('数值大于 max');
      if (Number.isInteger(n?.precision)) {
        const scaled = value * 10 ** n.precision;
        if (Math.abs(scaled - Math.round(scaled)) > Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4) add('数值小数位超过 precision');
      }
    }
  } else if (p.type === 'boolean') {
    if (typeof value !== 'boolean') add('布尔只接受 true/false/null，不把“未知”转为否');
  } else if (['option', 'dictionary'].includes(p.type)) {
    const c = t.choice, multi = c?.mode === 'multiple';
    if (multi ? !Array.isArray(value) : !string(value)) { add(multi ? '多选需值数组' : '单选需一个值'); return errors; }
    const selected = multi ? value : [value], allowed = choices(p, catalog);
    if (!selected.length || !unique(selected)) add('已知选项不能是空数组或包含重复值；未知用 null');
    if (selected.some(v => !allowed.includes(v))) add(p.type === 'option' && c?.enumPolicy?.newValuePolicy === 'review_new_version'
      ? '值不在本类允许范围内；保留原值及证据，目录外新值待审，不自动改值或认定商品错误'
      : '值不在本类允许范围内；字典值使用稳定 ID');
    if (c?.minSelections != null && selected.length < c.minSelections) add('选择数量不足');
    if (c?.maxSelections != null && selected.length > c.maxSelections) add('选择数量超限');
    for (const group of list(c?.mutuallyExclusive)) if (Array.isArray(group) && group.filter(v => selected.includes(v)).length > 1) add('同时选择了互斥选项');
    if (p.type === 'dictionary') {
      const resolved = resolveDictionary(t.dictionary, catalog);
      if (resolved.error) add(resolved.error);
      else if (selected.some(id => !resolved.dictionary.values.some(v => v.id === id && v.status === 'active'))) add('字典值不存在或已废弃');
    }
  } else add('不支持的属性类型');
  return errors;
}

/** @param {unknown} [catalog] */
export function validateAttribute(p, catalog = { version: 1, dictionaries: [] }) {
  const errors = [], add = (path, message, kind = 'attribute_type') => errors.push(issue(kind, path, message));
  if (!object(p)) return [issue('attribute_type', '', '属性必须是对象')];
  const t = p.typing;
  if (!object(t) || t.version !== ATTRIBUTE_CONTRACT_VERSION) return [issue('attribute_type', 'typing.version', '新属性/实质修改须提供 typing.version=1；旧稿须与基线逐项一致才可沿用')];
  for (const f of ['rationale', 'object']) if (!string(t[f])) add(`typing.${f}`, '缺少类型选择依据或计量/描述对象');
  for (const f of ['definitionId', 'definitionVersion']) if (!string(p[f])) add(f, '需要共享定义的稳定标识与版本；不同含义分别标识');
  if (!['text', 'number', 'boolean', 'option', 'dictionary'].includes(p.type)) add('type', '不支持的类型');
  if (p.scope !== 'SKU' || typeof p.required !== 'boolean') add('required', '仅 SKU，必填只允许 boolean');
  for (const f of ['name', 'definition', 'purpose']) if (!string(p[f])) add(f, '缺少非空属性定义字段');
  if (!strings(p.rules)) add('rules', '填写规则需非空字符串数组');
  if (!Array.isArray(p.enumValues)) add('enumValues', '需要数组；非内联选项填空数组');
  if (p.type !== 'option' && list(p.enumValues).length) add('enumValues', '文本/数值/布尔/字典不能带另一份内联选项');
  if ('defaultValue' in p && p.defaultValue !== null) add('defaultValue', '本合同不推断默认值；未知保留 null');
  const allowedKeys = new Set(['version', 'rationale', 'object', ...(p.type === 'text' ? ['text'] : []), ...(p.type === 'number' ? ['number'] : []), ...(['option', 'dictionary'].includes(p.type) ? ['choice'] : []), ...(p.type === 'dictionary' ? ['dictionary'] : [])]);
  for (const k of Object.keys(t)) if (!allowedKeys.has(k)) add(`typing.${k}`, '当前类型不适用或未知配置，不能静默忽略');
  const nestedKeys = { text: ['formatHint', 'minLength', 'maxLength'], number: ['quantityKind', 'precision', 'min', 'max', 'constraintReferences'],
    choice: ['mode', 'dimension', 'rationale', 'boundaryReferences', 'minSelections', 'maxSelections', 'mutuallyExclusive', 'measurement', 'enumPolicy', 'allowedValues', 'applicabilityReferences'], dictionary: ['id', 'version', 'sha256', 'allowedValueIds'] };
  for (const [field, keys] of Object.entries(nestedKeys)) if (object(t[field])) {
    for (const k of Object.keys(t[field])) if (!keys.includes(k)) add(`typing.${field}.${k}`, '未知类型配置，不能静默忽略');
  }
  if (p.type === 'text') {
    const c = t.text;
    if (!object(c) || !string(c.formatHint)) add('typing.text', '文本须说明格式，可保留组合尺寸');
    else {
      for (const k of ['minLength', 'maxLength']) if (c[k] !== null && (!Number.isInteger(c[k]) || c[k] < 0)) add(`typing.text.${k}`, '需非负整数或 null');
      if (c.minLength != null && c.maxLength != null && c.minLength > c.maxLength) add('typing.text', '长度上下界倒置');
    }
  }
  if (p.type === 'number') {
    const n = t.number;
    if (!string(p.unit)) add('unit', '数值须有固定单位；无量纲显式用 1');
    if (!object(n)) add('typing.number', '数值须说明量纲/计量含义');
    else {
      if (!string(n.quantityKind)) add('typing.number.quantityKind', '数值须说明量纲/计量含义');
      if (n.precision !== null && (!Number.isInteger(n.precision) || n.precision < 0 || n.precision > 12)) add('typing.number.precision', '精度为 0—12 位或 null，不默认取整');
      for (const k of ['min', 'max']) if (n[k] !== null && !finite(n[k])) add(`typing.number.${k}`, '范围为有限数值或 null');
      if (finite(n.min) && finite(n.max) && n.min > n.max) add('typing.number', '数值上下界倒置');
      if ((n.min !== null || n.max !== null || n.precision !== null) && !meaningfulReferences(n.constraintReferences)) add('typing.number.constraintReferences', '硬范围/精度需来源依据，不把样本最小最大值当边界');
    }
  }
  if (['boolean', 'dictionary'].includes(p.type) && p.unit) add('unit', '布尔/字典不另带计量单位');
  if (p.type === 'option' && p.unit && !t.choice?.measurement) add('unit', '数值枚举须带数值、单位及选项映射，不能只有显示单位');
  if (['option', 'dictionary'].includes(p.type)) {
    const c = t.choice, values = choices(p, catalog);
    if (!object(c)) add('typing.choice', '选项必须明确单选/多选与值域依据');
    else {
      if (c.allowedValues !== undefined) {
        if (p.type !== 'option' || !strings(c.allowedValues) || !unique(c.allowedValues) || c.allowedValues.some(v => !list(p.enumValues).includes(v))) add('typing.choice.allowedValues', '本类子集须非空、无重复且属于共享枚举');
        if (!meaningfulReferences(c.applicabilityReferences)) add('typing.choice.applicabilityReferences', '本类选项子集须有适用依据，不按同名或平台频次推断');
      }
      if (c.enumPolicy !== undefined) {
        const e = c.enumPolicy;
        if (p.type !== 'option' || !object(e) || !['platform_reference','normative_standard','procurement_review'].includes(e.basisKind) || e.newValuePolicy !== 'review_new_version' || !string(e.version) || !strings(e.sourceFamilyIds) || !unique(e.sourceFamilyIds)) add('typing.choice.enumPolicy', '枚举需标依据类别、版本、独立来源家族和新值待审政策');
        else if (e.basisKind === 'normative_standard' && (!meaningfulReferences(e.standardReferences) || !string(e.applicableScope) || !string(e.verifiedAt))) add('typing.choice.enumPolicy', '正式标准须记录标准定位、核实日期和适用范围；平台筛选项不能冒充标准');
      }
      if (c.measurement !== undefined) {
        const m = c.measurement;
        if (p.type !== 'option' || !object(m) || !string(m.quantityKind) || !string(m.unit) || m.unit !== p.unit || !Array.isArray(m.values)) add('typing.choice.measurement', '数值枚举需明确同一计量对象、固定单位和逐选项数值映射');
        else {
          const mapped = m.values;
          if (mapped.length !== list(p.enumValues).length || mapped.some(v => !object(v) || !string(v.option) || !finite(v.value) || !list(p.enumValues).includes(v.option)) || !unique(mapped.map(v => v?.option))) add('typing.choice.measurement.values', '每个共享选项须且仅须一个有限数值；组合/范围不能伪造单值');
          if (!unique(mapped.map(v => v?.value))) add('typing.choice.measurement.values', '相同计量值不能重复为多个选项，如 35L/35.0L');
          if (mapped.some(v => object(v) && finite(v.value) && v.option !== `${v.value}${m.unit}`)) add('typing.choice.measurement.values', '数值枚举选项须为规范数值+固定单位，换算保留原值及来源');
        }
      }
      if (!['single', 'multiple'].includes(c.mode)) add('typing.choice.mode', '选择 single 或 multiple');
      if (!string(c.dimension) || !string(c.rationale)) add('typing.choice', '明确同一维度及单/多选业务理由');
      if (!meaningfulReferences(c.boundaryReferences)) add('typing.choice.boundaryReferences', '选项边界须有依据，样本集合不自动等于全集');
      if (!Number.isInteger(c.minSelections) || c.minSelections < 1) add('typing.choice.minSelections', '已知值至少选择一个；未知用 null，与必填无关');
      if (c.maxSelections !== null && (!Number.isInteger(c.maxSelections) || c.maxSelections < c.minSelections || c.maxSelections > values.length)) add('typing.choice.maxSelections', '选择数量应落在允许值数量以内');
      if (c.mode === 'single' && (c.minSelections !== 1 || c.maxSelections !== 1)) add('typing.choice', '单选的最少/最多选择数均为 1');
      if (c.minSelections > values.length) add('typing.choice.minSelections', '最少选择数大于允许值数量');
      if (!Array.isArray(c.mutuallyExclusive)) add('typing.choice.mutuallyExclusive', '互斥组需数组，无互斥填 []');
      const groupUniverse = p.type === 'option' ? list(p.enumValues) : values;
      for (const [i, g] of list(c.mutuallyExclusive).entries()) if (!strings(g) || g.length < 2 || !unique(g) || g.some(v => !groupUniverse.includes(v))) add(`typing.choice.mutuallyExclusive[${i}]`, '互斥组须含至少两个不同且允许的值');
    }
    if (!strings(values) || !unique(values.map(v => typeof v === 'string' ? key(v) : v))) add(p.type === 'option' ? 'enumValues' : 'typing.dictionary.allowedValueIds', '允许值须非空、无重复');
    if (p.type === 'option' && (!strings(p.enumValues) || !unique(list(p.enumValues).map(v => typeof v === 'string' ? key(v) : v)))) add('enumValues', '共享选项须非空、无重复');
    if (p.type === 'option' && values.some(v => typeof v === 'string' && (v.trim() !== v || /[\r\n]/.test(v)))) add('enumValues', '选项不能带边缘空格或换行');
  }
  if (p.type === 'dictionary') {
    const r = t.dictionary;
    if (!object(r) || !['id', 'version', 'sha256'].every(f => string(r[f]))) add('typing.dictionary', '字典引用须固定 ID、版本、内容哈希和允许值子集');
    else {
      const resolved = resolveDictionary(r, catalog);
      if (resolved.error) add('typing.dictionary', resolved.error, 'dictionary_reference');
      else if (list(r.allowedValueIds).some(id => !resolved.dictionary.values.some(v => v.id === id && v.status === 'active'))) add('typing.dictionary.allowedValueIds', '子集存在未知或废弃值', 'dictionary_reference');
    }
  }
  if (!Array.isArray(p.valueExamples) || !p.valueExamples.length) add('valueExamples', '至少提供一个规范填写示例，并标明构造或来源规范化');
  for (const [i, example] of list(p.valueExamples).entries()) {
    const at = `valueExamples[${i}]`;
    if (!object(example) || !Object.hasOwn(example, 'value') || !['constructed', 'source_normalized'].includes(example.origin)) { add(at, '示例需 value 与 origin=constructed/source_normalized'); continue; }
    if (example.origin === 'source_normalized' && (!meaningfulReferences(example.sourceReferences) || !Object.hasOwn(example, 'rawValue'))) add(at, '来源规范化示例须保留原值与来源；不代表目标 SKU 已核实');
    for (const e of validateAttributeValue(p, example.value, catalog)) add(`${at}.value`, e, 'attribute_example');
  }
  if (list(p.valueExamples).length && p.valueExamples.every(e => e?.value === null)) add('valueExamples', '不能仅用 null 示例逃避填写验证');
  return errors;
}

export function definitionSignature(p) {
  const t = p.typing ?? {};
  return stableJson({ name: p.name, type: p.type, scope: p.scope, definition: p.definition, object: t.object, unit: p.unit ?? null,
    quantityKind: t.number?.quantityKind, mode: t.choice?.mode, dimension: t.choice?.dimension,
    measurement: t.choice?.measurement, enumPolicy: t.choice?.enumPolicy,
    enumValues: p.type === 'option' ? p.enumValues : undefined,
    dictionary: p.type === 'dictionary' ? { id: t.dictionary?.id, version: t.dictionary?.version, sha256: t.dictionary?.sha256 } : undefined });
}

export function validateSharedDefinitions(proposals) {
  const errors = [], seen = new Map();
  for (const [i, p] of list(proposals).entries()) {
    if (!object(p) || !p.typing || !p.definitionId || !p.definitionVersion) continue;
    const id = `${p.definitionId}@${p.definitionVersion}`, signature = definitionSignature(p), previous = seen.get(id);
    if (previous && previous.signature !== signature) errors.push(issue('shared_definition_conflict', `proposals[${i}]`, `${id} 的名称、对象、定义、类型、量纲、单位或选项语义与 ${previous.categoryId} 不一致`));
    if (previous && previous.required !== p.required) errors.push(issue('shared_required_conflict', `proposals[${i}].required`, `${id} 的必填声明不一致，先核业务必要性，不隐式继承`));
    if (!previous) seen.set(id, { signature, required: p.required, categoryId: p.categoryId });
  }
  return errors;
}

export function attributeTypeLabel(p) {
  if (p.type === 'dictionary') return `字典${p.typing?.choice?.mode === 'multiple' ? '多选' : '单选'}`;
  if (p.type === 'option') return p.typing?.choice?.mode === 'multiple' ? '多选枚举' : p.typing ? '单选枚举' : '选项（待复核）';
  return ({ text: '文本', number: '数值', boolean: '布尔' })[p.type] ?? `未知类型：${p.type}`;
}

export function attributeValueSummary(p, catalog) {
  if (!p.typing) return '沿用旧稿，类型配置尚未复核';
  if (p.type === 'dictionary') {
    const r = p.typing.dictionary, d = resolveDictionary(r, catalog);
    if (d.error) return d.error;
    return `${d.dictionary.name}@${r.version}（${d.dictionary.status === 'candidate' ? '候选待审' : '已发布'}）：` + r.allowedValueIds.map(id => d.dictionary.values.find(v => v.id === id)?.label ?? id).join('；');
  }
  if (p.type === 'option') return choices(p, catalog).join('；');
  if (p.type === 'number') {
    const n = p.typing.number;
    return `${n.quantityKind}；精度${n.precision === null ? '未限定' : n.precision + '位'}；范围 ${n.min ?? '未限定'} 至 ${n.max ?? '未限定'}`;
  }
  return p.type === 'boolean' ? '是/否；未知留空' : p.typing.text.formatHint;
}

/** @param {{dictionaryId?: string, version?: string, text?: string, offset?: number, limit?: number}} [options] */
export function queryDictionaries(catalog, options = {}) {
  const { dictionaryId, version, text = '', offset = 0, limit = 50 } = options;
  const errors = validateDictionaries(catalog);
  if (errors.length) throw Error('Invalid dictionaries: ' + JSON.stringify(errors));
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('Invalid dictionary pagination');
  const selected = catalog.dictionaries.filter(d => (!dictionaryId || d.id === dictionaryId) && (!version || d.version === version));
  if (dictionaryId && !selected.length) throw Error('Dictionary ID/version not found');
  const rows = selected.flatMap(d => d.values.map(v => ({ dictionaryId: d.id, version: d.version, sha256: dictionaryHash(d), dictionaryName: d.name, dictionaryStatus: d.status, ...v })))
    .filter(v => !text || key(JSON.stringify(v)).includes(key(text)));
  return { usage: 'dictionary_reference_not_target_adoption', total: rows.length, offset, nextOffset: offset + limit < rows.length ? offset + limit : null,
    dictionaries: selected.map(({ values, ...d }) => ({ ...d, sha256: dictionaryHash({ ...d, values }), valueCount: values.length })), rows: rows.slice(offset, offset + limit) };
}
