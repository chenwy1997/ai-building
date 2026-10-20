import {join} from 'node:path';
import {read,save,digest} from '../runtime/storage.ts';
import {ROOT,RUN,MODELS,COMMON_RULES} from './settings.ts';
import {invoke} from './model-run.ts';
const mode=process.argv[2]??'initial';
const legacy:any=await read(join(ROOT,'outputs/clean-paper-remaining-20261016/attribute-model-all21.json'));
const current:any=await read(join(ROOT,'outputs/product-governance/three-category-20261019/design/standard.json'));
const draft:any=mode==='final'?await read(join(RUN,'design/standard-draft.json')):null;
const payload=mode==='initial'?{
 task:'独立审核清洁纸品21类现有属性稿，提出本轮统一建模和相邻归属边界的具体修订。现有3类新稿优先，旧稿不能直接压过已修订规则。',
 constraints:COMMON_RULES,categories:legacy.categories.map((c:any)=>({id:c.id,name:c.name,path:c.path,boundary:c.boundary})),
 legacy:legacy.attributes.map((a:any)=>({id:a.code,category:a.category,name:a.name,type:a.type,required:a.required,unit:a.unit,enum:a.enum,scope:a.scope,description:a.description})),
 current,output:{issues:[{category:'',attribute:'',severity:'high|medium|low',problem:'',proposedFix:'',basis:'类目逻辑|业务价值|规则一致性|来源证据'}],boundaries:[{categories:[],rule:'',positiveExample:'',negativeExample:''}],missingAttributes:[],notes:[]},
 instruction:'最多15项关键问题，给出具体可执行的修改。不得以提高填充率降低必填，也不按能找到资料决定必填。无需输出整套属性卡。'
}:{
 task:'对Codex统一的21类属性卡进行独立终审，只报告可定位的新问题。检查定义和类目绑定、条件必填、单位/层级、枚举/规则、相邻边界。',
 constraints:COMMON_RULES,standard:draft,standardHash:digest(draft),
 output:{overall:'pass|revise',issues:[{categoryId:'',attributeId:'',severity:'high|medium|low',problem:'',proposedFix:'',basis:'类目逻辑|业务价值|规则一致性|来源证据'}],acceptedChoices:[],notes:[]},
 instruction:'本轮范围明确是全部21类，不能自行缩回旧3类。最多15项，优先高影响且具体可定位的问题；检查五个本轮样本类：盒装抽纸、有芯小卷纸、手帕纸、抽式擦手纸、洗脸巾。数量/计数单位/内包装单位成组，不重复旧单包字段；必填条件与备选计量组须闭合；字典引用不等于空枚举。避免把提案与定稿差异本身当错误。不得声称法规、行业认证或运营已批准。严格JSON。'
};
await save(join(RUN,'design',mode+'-review-input.json'),payload);
await Promise.all(MODELS.map(async m=>{const stage='cards-'+mode;let r=await invoke(stage,m,payload,v=>Array.isArray(v.issues));if(!r)r=await invoke(stage+'-repair',m,{...payload,repair:'前次未返回完整可解析结构，请返回严格JSON。'},v=>Array.isArray(v.issues));if(!r)throw new Error(m.id+' cards review requires manual repair');}));
