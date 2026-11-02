import { digest, toStdText } from '../contracts.ts';
import type { buildHardware } from './build.ts';
export const selectionTask = '保持原类目ID、名称和层级。根据定义、描述对象和证据选择属性ID及版本，并提出类目必填策略。候选名称不是适用性证明。不得改写标准定义、强加封闭枚举或编造商品参数；缺少概念时单独提出新定义。';
export function buildContextPacks(pack:ReturnType<typeof buildHardware>) {
  const branches=[...new Set(pack.templates.map(t=>t.category.pathNames[2]!))].sort();
  return branches.map(branch=>{
    const templates=pack.templates.filter(t=>t.category.pathNames[2]===branch);
    const ids=new Set(templates.flatMap(t=>t.selections.map(s=>s.propertyId)));
    const properties=pack.dictionary.properties.filter(p=>ids.has(p.id));
    const unitIds=new Set(properties.flatMap(p=>p.unitIds));
    const dictionary={...pack.dictionary,properties,units:pack.dictionary.units.filter(u=>unitIds.has(u.id))};
    // Shared definition prefix only. Target leaf and evidence are appended by a future model caller.
    // No target-specific ideal selections or expected answers are included here.
    const prefix=selectionTask+'\n行业：五金工具/'+branch+'\n'+toStdText(dictionary);
    return {branch,definitionCount:properties.length,prefixHash:digest(prefix),utf8Bytes:Buffer.byteLength(prefix),prefix};
  });
}
