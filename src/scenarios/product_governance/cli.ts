import {join,resolve} from 'node:path';
import {mkdir,rm,readdir} from 'node:fs/promises';
import {callModel,type ModelConfig,type ModelRecord} from './adapters/models.ts';
import {evaluate,validateStandard,describeTask} from './domain/engine.ts';
import {validateReview,compareOpinions} from './domain/review.ts';
import type {CaseInput,Expectation,Standard,ValueResult} from './domain/types.ts';
import {syntheticCases,historicalCases,BRAND,COUNT} from './fixtures/cases.ts';
import {read,save,digest,append} from './runtime/storage.ts';
import {exportReport} from './runtime/report.ts';

const base=import.meta.dir,root=resolve(base,'../../..');
const [command='help',runArg,revision='r1']=process.argv.slice(2);
const run=resolve(runArg??join(root,'outputs/product-governance/step1-20261018'));
type Config={schema:string;maxExternalCalls:number;models:ModelConfig[]};
async function inputs(){return{standard:await read<Standard>(join(run,`standard-${revision}.json`)),config:await read<Config>(join(run,await Bun.file(join(run,`config-${revision}.json`)).exists()?`config-${revision}.json`:'config.json')),cases:await read<CaseInput[]>(join(run,await Bun.file(join(run,`cases-${revision}.json`)).exists()?`cases-${revision}.json`:'cases.json'))};}
async function prepare(){
 if(await Bun.file(join(run,'manifest.json')).exists()){console.log('运行已存在，使用已冻结输入：'+run);return;}
 const selected=await read<{file:string}>(join(base,'standards/current-pilot.json'));
 if(!/^pilot-v\d+\.json$/.test(selected.file))throw new Error('无效试点标准文件');
 const s=await read<Standard>(join(base,'standards',selected.file));validateStandard(s);
 const config=await read<Config>(join(base,'workflows/pilot-config.json'));
 if(new Set(config.models.map(m=>m.family)).size<2||config.models.reduce((n,m)=>n+m.maxCalls,0)>config.maxExternalCalls)throw new Error('需要两个模型家族，且调用配额不能超过运行总上限');
 const {cases:synthetic,expectations}=syntheticCases(),historical=await historicalCases(),cases=[...synthetic,...historical];
 await save(join(run,'standard-r1.json'),s);await save(join(run,'config.json'),config);await save(join(run,'cases.json'),cases);await save(join(run,'expectations.json'),expectations);
 await save(join(run,'manifest.json'),{runId:run.split('/').at(-1),createdAt:new Date().toISOString(),scope:'两个属性；规则反例与历史商品演示；不代表生产准确率',standardHash:digest(s),caseHash:digest(cases),configHash:digest(config),synthetic:synthetic.length,historical:historical.length,productionWrites:false,sourceSnapshot:'历史ES详情缓存的6条选定记录，非随机样本，未刷新上下架状态',categoryAssignment:'沿用历史建议归属，本轮没有重做分类审计'});
 await append(join(run,'events.jsonl'),{stage:'prepared',status:'completed',standardHash:digest(s),caseHash:digest(cases)});console.log('准备完成：'+run);
}
async function propose(){
 const {standard:s,config}=await inputs();
 const payload={task:describeTask(s,'independent_proposal',['architecture-v0.1'],['two_attribute_cards']),instructions:'独立提出两个属性定义，尚未看到另一模型答案。只输出JSON。每项简洁但完整。公共属性品牌适用于3类；每包片数仅用于湿纸巾。明确SKU与内包装，别名、必填、适用性、来源及规则反例。不能把产地/供应商/适配品牌当自身品牌；不能把整箱或混合包装均值当单包。不要联网，不推测已有商品事实。',business:{categories:s.categories,fieldTypes:['文本','数值','是否','选项','日期'],uses:['归类','展示','搜索','筛选'],attributes:['品牌','每包片数'],constraints:['无可靠SPU关联，先SKU','核心必填但未知留缺项','类目不改','模型意见由Codex最终裁定','明确的片/包可填；总量除包数须同规格同范围且赠品边界明确','用户要求来源、规则和评判集中配置']},outputSchema:{attributes:[{name:'',kind:'公共属性或类目特性属性',definition:'',fieldType:'',unit:null,scope:'',requiredReason:'',applicableCategories:[],sources:[],rules:[],counterexamples:[]}],risks:[]}};
 const records=await Promise.allSettled(config.models.map(m=>callModel(run,'proposal',m,payload)));
 let failed=false;for(let i=0;i<records.length;i++){const r=records[i]!;console.log(JSON.stringify({model:config.models[i]!.id,status:r.status==='fulfilled'?r.value.status:'failed',error:r.status==='rejected'?String(r.reason):r.value.error}));if(r.status==='rejected'||r.value.status!=='completed')failed=true;}
 if(failed)process.exitCode=1;
}
async function repairProposal(){
 const {config}=await inputs();
 for(const model of config.models){const original=await read<ModelRecord>(join(run,`models/proposal-${model.id}.json`));if(original.status==='completed')continue;
  const raw=await Bun.file(join(run,`models/proposal-${model.id}.raw.jsonl`)).text();
  const messages=raw.split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(e=>e.role==='assistant');const body=messages.at(-1)?.content;
  if(typeof body!=='string')throw new Error('原始返回不可用于格式修复');
  const repaired=await callModel(run,'proposal-repair',model,{task:'仅修复上一条独立提案的JSON格式，不修改业务观点，不增加/删除观点；保留错误业务观点供后续评审。输出一个合法JSON对象，正确转义所有引号，禁止在双引号数组混用单引号。',malformedJson:body});
  console.log(JSON.stringify({model:model.id,status:repaired.status,error:repaired.error}));if(repaired.status!=='completed')process.exitCode=1;
 }
}
async function rules(){
 const {standard:s,cases}=await inputs();validateStandard(s);
 const engineHash=digest(await Bun.file(join(base,'domain/engine.ts')).text());
 const priorPath=join(run,`evaluation-${revision}.json`);
 if(await Bun.file(priorPath).exists()){const prior=await read<any>(priorPath);if(prior.standardHash!==digest(s)||prior.caseHash!==digest(cases)||prior.engineHash!==engineHash)throw new Error('已冻结的标准/案例/执行器发生变化，请新建修订版本');console.log('复用已冻结规则结果：'+revision);return;}
 const results=cases.flatMap(c=>s.attributes.map(a=>evaluate(s,c,a.id)));
 const expected=await read<Expectation[]>(join(run,await Bun.file(join(run,`expectations-${revision}.json`)).exists()?`expectations-${revision}.json`:'expectations.json'));
 const checks=expected.map(e=>{const actual=results.find(r=>r.caseId===e.caseId&&r.attributeId===e.attributeId)!;return{...e,actual:{status:actual.status,value:actual.value},pass:e.status===actual.status&&e.value===actual.value};});
 await save(join(run,`results-${revision}.json`),results);await save(join(run,`checks-${revision}.json`),checks);
 await Bun.write(join(run,`context-${revision}.min.json`),JSON.stringify({standard:s,task:describeTask(s,'rule_evaluation',['frozen_inputs'],['rule_results','model_review']),standardHash:digest(s)}));
 await Bun.write(join(run,`engine-${revision}.ts`),await Bun.file(join(base,'domain/engine.ts')).text());
 await save(join(run,`evaluation-${revision}.json`),{standardHash:digest(s),caseHash:digest(cases),engineHash,resultsHash:digest(results),checks:checks.length,passed:checks.filter(c=>c.pass).length});
 console.log(JSON.stringify({checks:checks.length,passed:checks.filter(c=>c.pass).length,results:results.length}));if(checks.some(c=>!c.pass))process.exitCode=1;
}
async function review(){
 const {standard:s,config,cases}=await inputs();
 const results=await read<ValueResult[]>(join(run,`results-${revision}.json`));
 const proposals=await Promise.all(config.models.map(async(m,index)=>{let record=await read<ModelRecord>(join(run,`models/proposal-${m.id}.json`));if(record.status!=='completed'&&await Bun.file(join(run,`models/proposal-repair-${m.id}.json`)).exists())record=await read<ModelRecord>(join(run,`models/proposal-repair-${m.id}.json`));if(record.status!=='completed')throw new Error('独立提案未完成');const p=record.content as any;if(!Array.isArray(p?.attributes)||p.attributes.length!==2||!Array.isArray(p.risks))throw new Error('提案结构不完整');return{label:'方案'+(index+1),content:record.content};}));
 const targetIds=['Q02','Q04','Q05','Q07','Q09','Q15','B02','B04','B05','B08','H01','H03','H04','H06',...(revision==='r1'?[]:['H05','Q16','Q17'])];
 const targets=targetIds.map(caseId=>({caseId,attributeId:caseId.startsWith('B')||['H05','H06'].includes(caseId)?BRAND:COUNT}));
 const selections=targets.map(t=>({input:cases.find(c=>c.id===t.caseId),targetAttributeId:t.attributeId,ruleResult:results.find(r=>r.caseId===t.caseId&&r.attributeId===t.attributeId)}));
 const payload={task:describeTask(s,'cross_review_'+revision,['independent_proposals','rule_evaluation'],['review','case_opinions']),instructions:`你是独立评审员。评审两个匿名独立提案与统一草案，针对每个属性逐项给出全部10项rubric的意见（共20项）。必须审核下面每个指定案例（${targets.length}项），只对指定属性发表意见，不漏项。规则结果只是待审结果，不是答案；依据原文、观察量和规则查错。合成案例检查规则，历史商品仅作演示，不计算生产准确率。发现问题时明确严重性与可执行修改，语义归属不能仅靠字符串包含判定。无需复述输入，理由每条尽量30字内。只输出JSON；caseOpinions状态只可用 filled/needs_evidence/conflict/invalid/enum_candidate/not_applicable，有值须为字符串或数值，其他状态value必须null。`,standard:s,independentProposals:proposals,cases:selections,engineSource:await Bun.file(join(run,`engine-${revision}.ts`)).text(),outputSchema:{summary:'',checks:[{attributeId:'',criteria:[{criterionId:'',verdict:'pass|fail|uncertain',reason:''}]}],findings:[{id:'独立唯一编号',attributeId:'',severity:'high|medium|low',issue:'',recommendation:''}],caseOpinions:[{caseId:'',attributeId:'',status:'',value:null,reason:''}]}};
 await save(join(run,`review-targets-${revision}.json`),targets);
 const settled=await Promise.allSettled(config.models.map(async m=>{const record=await callModel(run,'review-'+revision,m,payload);if(record.status!=='completed')throw new Error(m.id+': '+record.error);const review=validateReview(record.content,s,targets);return{modelId:m.id,review,requestHash:record.requestHash};}));
 const reviews=[];for(let i=0;i<settled.length;i++){const r=settled[i]!;console.log(JSON.stringify({model:config.models[i]!.id,review:r.status,error:r.status==='rejected'?String(r.reason):undefined}));if(r.status==='fulfilled')reviews.push(r.value);}
 await save(join(run,`reviews-${revision}.json`),reviews);await save(join(run,`comparisons-${revision}.json`),compareOpinions(reviews,results));
 if(reviews.length!==config.models.length)process.exitCode=1;
}
async function main(){
 if(command==='help'){console.log('bun src/scenarios/product_governance/cli.ts prepare|propose|rules|review|report <run-dir> [r1|r2]');return;}
 await mkdir(run,{recursive:true});const lock=join(run,'.pipeline-lock');await mkdir(lock).catch(()=>{throw new Error('已有流程锁，请确认其他运行状态');});
 try{if(command==='prepare')await prepare();else if(command==='propose')await propose();else if(command==='repair-proposal')await repairProposal();else if(command==='rules')await rules();else if(command==='review')await review();else if(command==='report'){const exported=await exportReport(run,revision);await append(join(run,'events.jsonl'),{stage:'export_report',status:'completed',path:exported.path,revision});console.log(JSON.stringify(exported));}else throw new Error('未知命令');}finally{await rm(lock,{recursive:true});}
}
await main();
