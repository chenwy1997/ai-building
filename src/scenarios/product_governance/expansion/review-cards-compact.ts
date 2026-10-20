import {join} from 'node:path';
import {read,save,digest} from '../runtime/storage.ts';
import {RUN,MODELS,COMMON_RULES} from './settings.ts';
import {invoke} from './model-run.ts';
const s:any=await read(join(RUN,'design/standard-draft.json')),model=MODELS.find(m=>m.id==='kimi')!;
const pick=(x:any,keys:string[])=>Object.fromEntries(keys.filter(k=>x[k]!==undefined).map(k=>[k,x[k]]));
const groups=Array.from({length:3},(_,i)=>s.categories.slice(i*7,(i+1)*7));
const results=await Promise.all(groups.map(async(cats:any[],i:number)=>{
 const ids=new Set(cats.map(c=>c.id)),bindings=s.bindings.filter((b:any)=>ids.has(b.categoryId)),attrIds=new Set(bindings.map((b:any)=>b.attributeId));
 const payload={task:'独立终审清洁纸品21类标准的其中7类。这三份分组覆盖全部21类，无需重写属性卡，只报告真实未解决问题。',scope:cats.map(c=>c.name),draftHash:digest(s),
  categories:cats.map(c=>pick(c,['id','name','path','boundary'])),definitions:s.definitions.filter((a:any)=>attrIds.has(a.id)).map((a:any)=>pick(a,['id','name','type','unit','definition','rule','enum','selection','dictionary','formula','quantity'])),
  bindings:bindings.map((b:any)=>pick(b,['categoryId','attributeId','required','requiredWhen','allowedValues','applicability'])),requirementGroups:s.requirementGroups.filter((g:any)=>ids.has(g.categoryId)),rules:COMMON_RULES,
  rootProposedClarifications:['required=true仅在适用范围内核心必填；明确条件为否才不适用，未知仍待补证。分节节数、连续卷长、按重销售会加可执行applicabilityRule，已计数商品不强制重量或连续卷长。至少一条计量路径完整，未知不能全部豁免。','洗脸巾计数单位移除卷；卷仍可作内包装单位。数量+计数单位+内包装单位成组核验。','相同SKU来源同值不同张/片/抽用词，可按选定原证据单位整组记录并保留另一原表述，不宣称转换，不把措辞差异本身当冲突。','10+6须内包证据才能合计；防盗不等于带锁；盒装每盒抽数先确认直接硬盒。','生活用纸登记明确干式抽取厕用卫生纸，已全V2核对无更专门末级；预浸湿厕纸与普通面巾纸不能据此入宽类。'],
  output:{overall:'pass|revise',issues:[{categoryId:'',attributeId:'',severity:'high|medium|low',problem:'',proposedFix:'',basis:'类目逻辑|业务价值|规则一致性|来源证据'}],notes:[]},
  instruction:'最多6个仍需修改的具体问题，必须引用ID；已被rootProposedClarifications解决的不重复报。只按当前资料，不声称法规或运营已审核。严格JSON。'};
 const stage='cards-final-compact-'+(i+1);await save(join(RUN,'design',stage+'.input.json'),payload);
 const r=await invoke(stage,model,payload,v=>Array.isArray(v.issues));if(!r)throw new Error('compact group failed '+(i+1));return r;
}));
await save(join(RUN,'normalized/cards-final-kimi.json'),{model:'kimi',stage:'cards-final-combined',aggregation:true,sourceRecords:results.map(r=>r.sourceRecord),originalStatus:'aggregated-completed-records',content:{overall:results.some(r=>r.content.overall==='revise')?'revise':'pass',issues:results.flatMap((r,i)=>r.content.issues.map((x:any)=>({...x,reviewGroup:i+1}))),notes:results.flatMap(r=>r.content.notes??[])}});
console.log({groups:3,categories:groups.flat().length,issues:results.reduce((n,r)=>n+r.content.issues.length,0)});
