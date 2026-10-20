import {join,resolve} from 'node:path';
import {read} from '../runtime/storage.ts';
import {callModel,type ModelConfig} from '../adapters/models.ts';
const root=resolve(import.meta.dir,'../../../..'),dir=join(root,'outputs/product-governance/three-category-20261019');
const config:any=await read(join(import.meta.dir,'config.json'));
const standard=await read(join(dir,'design/standard-draft.json'));
const proposals=await Promise.all(['deepseek','kimi'].map(async(m)=>({model:m,content:(await read<any>(join(dir,`models/design-propose-${m}.json`))).content})));
await Promise.all(config.models.map(async(m:ModelConfig)=>{
 const r=await callModel(dir,'design-cross-review',m,{task:'复核合并后的完整属性卡，并与两个独立建议交叉核对。检查语义、必填理由、单位/包装层级、公共绑定、枚举、可执行规则。只报告具体问题；不重新输出全部卡。',standard,proposals,
 output:{overall:'pass|revise',issues:[{attributeId:'',severity:'high|medium|low',problem:'',recommendedChange:'',basis:'类目逻辑|业务用途|明确来源|规则一致性'}],omissions:[],acceptedChoices:[]},
 constraints:['不同模型同意不代表正确；严禁以提高填充率作为降必填理由','未知不等于否；不能由类目名、品牌常识或包装色推断属性值','最后由Codex审判，运营随机抽检未进行；此次仅离线试点'],instruction:'输出严格JSON，最多12个关键问题，精炼。'});
 console.log(m.id,r.status,r.error??'');
}));
