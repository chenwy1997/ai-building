import {join,resolve} from 'node:path';
import {read,save,exists,hash,pool} from '../runtime/store.ts';
import {DeepSeek} from '../providers/deepseek.ts';
import {fixedPrefixInput} from '../providers/prefix.ts';
import {reviewSchema,validate} from '../domain/meta.ts';
const root=resolve(process.argv[2]!),rev=join(root,'revisions/closure-r3'),f=await read(join(rev,'frozen.json')),gate=await read(join(rev,'pilot-gate.json'));
const instructions='你是属性变更的专项复核员，只找仍存在且会影响执行的真实问题。不要重复提出已正确解决的事项。模型意见不是准确率。合法ID由正则约束不需提前注册；model_knowledge允许text元数据，只有非空quote非法；选项之外enumValues应为空。\n'+Object.values(f.meta.standards).join('\n');const client=new DeepSeek(root,instructions,50);await client.init();
const result=await pool(f.branch.filter((c:any)=>c.isLeaf&&!gate.cards.some((x:any)=>x.categoryId===c.id)),async(c:any)=>{
 const dir=join(rev,'categories',c.id),d=await read(join(dir,'adjudicated.json')),file=join(dir,'codex-change-recheck.json');
 const ids=new Set(d.changes.filter((x:any)=>x.kind==='semantic').map((x:any)=>x.attributeId));
 const input={category:c,boundary:d.card.boundary,changes:d.changes.filter((x:any)=>x.kind==='semantic'),definitions:d.card.attributes,bindings:d.card.bindings,rules:d.card.rules.filter((x:any)=>ids.has(x.attributeId)),limitations:d.card.unresolved,task:'仅复核本次语义改动与其依赖的条件/规则冲突，重点核心必填不能按资料是否存在、计量对象和单位。不要对未提供的未变规则/来源作缺失推断。不要求猜测样本不存在的事实。已明确待运营边界只作为限制，不重复报错。无执行问题findings为空。'};
 if(await exists(file)){if((await read(file)).inputHash!==hash(input))throw Error('changed targeted review input');return;}
 let response:any;try{response=await client.generate('codex_changed_fields_recheck',input,reviewSchema,5500,'none');}catch(e:any){
 if(!e.message.includes('criterion:enum mismatch'))throw e;
 const body={model:'deepseek-flash',instructions,input:fixedPrefixInput('codex_changed_fields_recheck',input).text,reasoning:{effort:'none'},max_output_tokens:5500,text:{format:{type:'json_schema',name:'governance_codex_changed_fields_recheck',schema:reviewSchema}}};
 const id=hash({path:'/responses',body}),raw=await read(join(root,'calls',id,'response.json'));const value=JSON.parse(raw.output.flatMap((x:any)=>x.content??[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join(''));
 for(const x of value.findings)if(!reviewSchema.properties!.findings!.items!.properties!.criterion!.enum!.includes(x.criterion)){x.issue='[原criterion='+x.criterion+'] '+x.issue;x.criterion='其他';}
 if(validate(reviewSchema,value).length)throw e;response={value,callHash:id,normalization:'仅将非法评审分类映射其他，业务意见保留。'};
 }await save(file,{inputHash:hash(input),cardHash:d.cardHash,...response});console.log(JSON.stringify({category:c.name,findings:response.value.findings.length}));
},{initial:6,max:6,auto:false});await save(join(rev,'targeted-recheck-status.json'),result);
