import { expect, test } from 'bun:test';
import policy from '../knowledge/field-ownership.json';
import fixtures from './fixtures/field-selection-20261029.json';
import { checkRestorations, compareBaseline, validateDraft } from '../core';
import { restorationEligibility, optionalRestorationAllowed } from '../restoration';

const source = (name: string) => ({ categoryId: 'a', sourceName: name, decision: 'exclude', reason: '旧原生职责已承载' });
const body = (name: string, required = false) => ({ categoryId: 'a', name, key: name, required,
  restorationScope: { object: 'product_body', basis: '来源定义对象为商品本体，包装/运输参数另行区分。' } });
const check = (raw: string, p: any) => checkRestorations({ proposals: [], candidateDecisions: [source(raw)] }, [p],
  [{ ...source(raw), decision: 'keep', candidateName: p.name }], policy);

test('最新纠正保留保质期，保修期和质保期均不恢复', () => {
  expect(check('保质期', body('保质期')).errors).toEqual([]);
  for (const n of ['保修期', '质保期', '质保说明']) expect(check(n, body(n)).errors[0]?.kind).toBe('restoration_not_approved');
});

test('尺寸和重量是选填候选，泛平台字段的对象仍待核', () => {
  for (const n of ['商品重量', '商品长宽高']) expect(restorationEligibility({ sourceName: n }, policy).state).toBe('allowed_scope_pending');
  expect(check('商品长宽高', body('尺寸')).errors).toEqual([]);
  for (const n of ['单卷重量', '整机重量']) expect(check('商品重量', body(n)).errors).toEqual([]);
  expect(check('商品重量', body('整机重量', true)).errors[0]?.kind).toBe('restoration_not_approved');
});

test('恢复定义不能只有白名单名字而缺少本体对象及依据', () => {
  for (const scope of [undefined, { object: 'shipping', basis: '物流' }, { object: 'product_body', basis: '' }]) {
    expect(check('商品重量', { ...body('整机重量'), restorationScope: scope }).errors[0]?.kind).toBe('restoration_not_approved');
  }
});

test('包装尺寸和毛重不能通过改名或声明本体归入尺寸及重量', () => {
  for (const n of ['包装长宽高', '包装长度', '包装尺寸', '外箱尺寸']) {
    expect(check(n, body('尺寸')).errors[0]?.kind).toBe('restoration_not_approved');
  }
  for (const n of ['商品毛重', '物流重量', '含包装重量']) {
    expect(check(n, body('整机重量')).errors[0]?.kind).toBe('restoration_not_approved');
  }
});

test('尺寸与重量候选不能跨概念归并；逐项人工排除继续有效', () => {
  expect(check('商品长宽高', body('整机重量')).errors[0]?.kind).toBe('restoration_not_approved');
  expect(optionalRestorationAllowed(body('尺寸'), { ...source('商品长宽高'), humanReview: '不要' }, policy)).toBe(false);
});

test('真实待选记录分别转为本体候选待核或保持排除，不再要求同组重复授权', () => {
  const baseline = { proposals: [], candidateDecisions: fixtures.records.map(r => r.baseline) };
  const result = checkRestorations(baseline, [], fixtures.records.map(r => r.current), policy);
  expect(result.errors).toEqual([]);
  expect(result.eligible).toBe(2); expect(result.excluded).toBe(3); expect(result.pending).toBe(0);
  expect(result.restored).toBe(0);
  for (const row of result.decisions) {
    expect(row.historicalReason).toBe(baseline.candidateDecisions.find(x => x.categoryId === row.categoryId && x.sourceName === row.sourceName)?.reason);
    expect(row.previousReason).toBe(fixtures.records.find(x => x.current.categoryId === row.categoryId && x.current.sourceName === row.sourceName)?.current.reason);
  }
});

test('既有认可尺寸和单卷重量保留，不因恢复资格强制改名和重写', () => {
  const accepted = ['尺寸', '单卷重量'].map(n => ({ ...body(n), definition: '原认可口径', restorationScope: undefined }));
  const result = checkRestorations({ proposals: accepted, candidateDecisions: [source('商品重量'), source('商品长宽高')] }, accepted,
    [{ ...source('商品重量'), decision: 'keep', candidateName: '单卷重量' }, { ...source('商品长宽高'), decision: 'keep', candidateName: '尺寸' }], policy);
  expect(result.errors).toEqual([]); expect(compareBaseline(accepted, accepted).every(x => x.status === 'preserved')).toBe(true);
});

test('明确用户排除与原生入口已核实是两回事，不误拦合法排除', () => {
  const d = { categories: [{ categoryId: 'a', category: '测试' }], proposals: [], candidateDecisions: [
    { ...source('质保期'), decision: 'exclude', exclusionBasis: 'explicit_policy', reason: '按用户决定保持排除，历史原生warranty未核实' }] };
  const pool = { categories: [{ id: 'a', evidence: [], pool: [{ name: '质保期' }] }] };
  expect(validateDraft(d, pool, ['a'], policy).errors).toEqual([]);
  d.candidateDecisions[0]!.sourceName = '保质期';
  pool.categories[0]!.pool[0]!.name = '保质期';
  expect(validateDraft(d, pool, ['a'], policy).errors.some(e => e.kind === 'unscoped_exclusion')).toBe(true);
});

test('新网页来源标签不能把保修期或包装尺寸绕过用户排除', () => {
  for (const [raw, name] of [['v4网页候选：保修期', '保修期'], ['v4网页候选：包装长宽高', '尺寸']]) {
    const p = body(name!);
    const result = checkRestorations({ proposals: [], candidateDecisions: [] }, [p],
      [{ categoryId: 'a', sourceName: raw, candidateName: name, decision: 'keep' }], policy);
    expect(result.errors[0]?.kind).toBe('restoration_not_approved');
  }
});

test('来源已声明shipping不能通过目标body声明洗掉测量对象冲突', () => {
  const p = body('尺寸'), old = source('商品长宽高');
  const result = checkRestorations({ proposals: [], candidateDecisions: [old] }, [p],
    [{ ...old, decision: 'keep', candidateName: '尺寸', restorationScope: { object: 'shipping', basis: '平台记录是运输包装' } }], policy);
  expect(result.errors[0]?.kind).toBe('restoration_not_approved');
});

test('当前逐项人工否决优先于组级恢复资格', () => {
  const p = body('整机重量'), old = source('商品重量');
  const baseline = { proposals: [], candidateDecisions: [old] };
  expect(checkRestorations(baseline, [p], [{ ...old, decision: 'keep', candidateName: p.name, humanReview: '不要' }], policy).errors[0]?.kind).toBe('restoration_not_approved');
  const deferred = checkRestorations(baseline, [], [{ ...old, decision: 'defer', humanReview: '不要' }], policy);
  expect(deferred.decisions[0]?.decision).toBe('exclude');
  expect(deferred.decisions[0]?.restorationState).toBe('excluded_by_user');
});

test('认可尺寸定义不等于认可新包装来源归并到它', () => {
  const p = body('尺寸');
  const r = checkRestorations({ proposals: [p], candidateDecisions: [] }, [p],
    [{ ...source('包装长宽高'), decision: 'merge', candidateName: '尺寸' }], policy);
  expect(r.errors[0]?.kind).toBe('restoration_not_approved');
});

test('明确shipping对象先于名字判断，未知外形别名不能洗成尺寸', () => {
  const p = body('尺寸');
  const r = checkRestorations({ proposals: [], candidateDecisions: [] }, [p],
    [{ ...source('外形规格'), decision: 'merge', candidateName: '尺寸', restorationScope: { object: 'shipping', basis: '运输件' } }], policy);
  expect(r.errors[0]?.kind).toBe('restoration_not_approved');
});

test('规范化括号时保留包装物流限定，不擦除关键语义', () => {
  for (const [raw, name] of [['【包装】尺寸', '尺寸'], ['【物流】重量', '整机重量']]) {
    expect(check(raw!, body(name!)).errors[0]?.kind).toBe('restoration_not_approved');
  }
});
