import fs from 'node:fs/promises';
import path from 'node:path';
import { assemble, readJson, semanticHash, writeJson } from '../core';
import { proposal } from './fixtures/type-contract';
import { typeSelection } from './fixtures/type-selection';

// Optional end-to-end fixture for the real Excel exporter, never a business generation command.
const outArg = process.argv[2];
if (!outArg) throw Error('Usage: bun tests/create-type-acceptance.ts NEW_OUTPUT_DIRECTORY');
const out = path.resolve(outArg);
await fs.mkdir(out, { recursive: false }); // Refuse to overwrite any existing acceptance or review directory.
const specs = [['text','single','组合尺寸'],['number','single','层数'],['boolean','single','是否印花'],['option','single','单选结构'],['option','multiple','多选用途'],['dictionary','single','单选颜色'],['dictionary','multiple','多选颜色']];
const ps = specs.map(([type, mode, name]) => ({ ...proposal(type, mode), name }));
ps[5].valueExamples = [{ value: 'gray', origin: 'source_normalized', rawValue: '灰色', sourceReferences: ['test-fixture:模拟别名映射，不是实际商品'] }];
const old = { ...structuredClone(ps[3]), type: 'text', enumValues: [] };
const preserved = { ...proposal(), categoryId: 'offline-b', category: '历史兼容验收', name: '沿用的文本属性' };
for (const p of [old, preserved]) for (const k of ['typing','definitionId','definitionVersion','valueExamples']) delete p[k];
const { manifest } = await typeSelection(path.join(out, 'inputs'), [ps], [old, preserved],
  [{ categoryId: old.categoryId, key: old.key, beforeHash: semanticHash(old), reason: '技术夹具验证文本转单选枚举，不代表批准业务变更' }]);
const policy = await readJson(path.resolve(import.meta.dir, '../knowledge/field-ownership.json'));
const result = await assemble(manifest, out, policy);
await writeJson(path.join(out, 'supplemental-sources.json'), { records: [{ group: '技术构造样例', id: 'test-fixture', title: '仅用于运行时与Excel验收', sourceKind: 'constructed', limitation: '未生成或审校任何清洁用品业务属性' }] });
console.log(JSON.stringify({ out, ...result, modelRequests: 0, productionWrites: 0, usage: 'technical_acceptance_only' }));
