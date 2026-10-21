import {join,resolve} from 'node:path';
import {read,save,exists} from '../runtime/store.ts';
import {DeepSeek} from '../providers/deepseek.ts';
import {obj,str,arr} from '../trial/contracts.ts';
const root=resolve(process.argv[2]!),dir=join(root,'revisions/closure-r3/naming-r1'),file=join(dir,'kitchen-count-names.json');
if(await exists(file))process.exit(0);
const patch=(await read(join(dir,'patches-final/15c851c5-7435-4843-8df6-4bd61dd3c1d5.json'))).value;
const ds=new DeepSeek(root,'依据既定属性命名规范，提出准确自然的业务名称。只输出JSON。数量和计数单位分开，属性名称不要塞入可选单位清单；不同范围不能合并。',50);await ds.init();
const r=await ds.generate('naming_count_labels',{
 attributes:patch.replacements.slice(0,4).map((r:any)=>({attributeId:r.attribute.id,definition:r.attribute.definition,fieldType:r.attribute.fieldType,allowedUnits:r.attribute.enumValues,scope:r.binding.scope})),
 feedback:'四字段结构保持不变。卷计数允许节/段，包计数允许抽/张，因此数量名不应偏称某一种单位；已有独立单位字段。这是当前手帕纸/洗脸巾同类命名原则，但不合并类目属性ID。请只独立提出四个自然清晰的名称，保留卷/包必要范围，单位名称无需再重复“数…计数…”；不用提供规则或长解释。'
},obj({names:arr(obj({attributeId:str(),name:str(),reason:str()}))}),1500,'none');
await save(file,r);
