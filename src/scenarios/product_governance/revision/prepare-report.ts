import {join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {read,save} from '../runtime/storage.ts';
import {ROOT} from '../expansion/settings.ts';
const dir=join(ROOT,'outputs/product-governance/clean-paper-21-revision-20261019');
const [s,changes,ref,mapping,review,regression]:any[]=await Promise.all(['design/standard.json','design/changes.json','reference-audit.json','reference-binding-mappings.json','design/adjudication.json','regression-plan.json'].map(f=>read(join(dir,f))));
const old:any=await read(join(ROOT,'outputs/product-governance/clean-paper-five-20261019/design/standard.json'));
const text=(v:any)=>v===null||v===undefined?'':typeof v==='string'?v:JSON.stringify(v);
const brief=(v:any)=>!v?'':typeof v!=='object'?text(v):text(Object.fromEntries(['id','name','attributeId','type','unit','enum','definition','rule','applicability','paths','applicabilityCondition','requirednessMode','atLeastOne'].filter(k=>v[k]!==undefined).map(k=>[k,v[k]])));
const name=(id:string)=>s.categories.find((c:any)=>c.id===id)?.name??id;
const statusNames=mapping.statusDefinitions;
const sources=(b:any)=>{
 const m=mapping.bindingMappings.find((x:any)=>x.categoryId===b.categoryId&&x.attributeId===b.attributeId);
 return m?`${m.referenceIds.map((id:string)=>{const r=ref.references.find((x:any)=>x.refId===id);return r?`${r.sheet} 第${r.row}行 ${r.attribute}`:id;}).join('；')||'原表无同对象同口径字段'}｜${m.reason}`:'本轮证据及建模修订；未标为震坤行直接来源';
};
const models=[];
for(const file of (await readdir(join(dir,'models'))).filter(f=>f.endsWith('.json')&&!f.includes('.raw.')&&!f.includes('.request.')&&!f.startsWith('ledger-'))){
 const r:any=await read(join(dir,'models',file));
 if(r.model?.id){let recovery:any=null;try{recovery=(await read<any>(join(dir,'normalized',file)))?.syntaxRecovery;}catch{}models.push({file,...r,recovery});}
}
models.sort((a,b)=>(a.startedAt??'').localeCompare(b.startedAt??''));
const tables:any[]=[];
tables.push({name:'修订总览',title:`清洁纸品21类属性修订｜${s.statistics.activeDefinitions}项现用定义、${s.bindings.length}条绑定（另留3项历史定义）`,headers:['末级类目','原属性数','修订属性数','四模型属性卡审核','震坤行参考层级','两批历史抽样件数','历史试填覆盖','新版商品重验状态','运营审核意见'],widths:[22,14,16,29,24,20,30,26,60],rows:s.categories.map((c:any)=>{const rows=regression.records.filter((r:any)=>r.categoryId===c.id);return [c.name,old.bindings.filter((b:any)=>b.categoryId===c.id).length,s.bindings.filter((b:any)=>b.categoryId===c.id).length,review.coverage.filter((r:any)=>r.categoryIds.includes(c.id)).map((r:any)=>r.model).join(' / '),ref.categoryCoverage.find((x:any)=>x.categoryId===c.id)?.relation??'',rows.length,rows.length?'已有商品试填记录':'本次两批样本未覆盖','尚未执行',''];}),editable:['I'],preview:'A2:H10',subtitle:'商品样本仅统计先3类150件、后5类250件，共8类400件；其余13类待补抽样。21类新版商品重验均未执行。'});
tables.push({name:'21类完整属性卡',title:'完整修订卡｜同一末级类目连续排列；运营待审核',headers:['末级类目','属性名','公共/特性','字段类型','必填方式','枚举或字典','标准单位','属性定义','填写规则','公式','适用条件','必填理由','数值口径元数据','取值层级','类目ID','完整类目路径','属性ID','参考依据','运营意见'],widths:[22,28,22,12,24,60,22,65,100,60,75,70,90,12,39,55,30,95,60],rows:s.categories.flatMap((c:any)=>s.bindings.filter((b:any)=>b.categoryId===c.id).map((b:any)=>{const a=s.definitions.find((x:any)=>x.id===b.attributeId);return [c.name,a.name,a.kind,a.type,b.requirednessMode==='measurement_group'?'组内至少一条路径完整':b.required?'适用时必填':b.requiredWhen?'条件必填':'选填',a.dictionary?`引用字典：${a.dictionary}`:(b.allowedValues??a.enum)?.join('；')??'',a.unit??'',a.definition,a.rule,a.formula||'无计算；按证据提取',`${b.applicability}\n适用：${text(b.applicabilityCondition)}；触发必填：${text(b.requiredWhen)}；组：${b.requirementGroupId??'无'}`,b.rationale,text(a.measurement??a.quantity),b.level,c.id,c.path,a.id,sources(b),''];})),editable:['S'],preview:'A2:G9'});
// Match the established category/attribute identification order from the prior workbook.
const cards=tables.find(t=>t.name==='21类完整属性卡');
const cardOrder=[0,14,15,16,1,2,3,4,13,6,5,7,10,8,9,11,12,17,18];
cards.headers=cardOrder.map(i=>cards.headers[i]);
cards.widths=cardOrder.map(i=>cards.widths[i]);
cards.rows=cards.rows.map((r:any[])=>cardOrder.map(i=>r[i]));
cards.preview='A2:F9';
const important=changes.changes.filter((x:any)=>x.reason||['measurement_group_revision','condition_fact_revision'].includes(x.kind));
tables.push({name:'修订与迁移',title:'变更理由与迁移要求｜旧值不直接覆盖',headers:['类型','类目/属性','原定义或值','修订定义或值','修改理由','迁移处理'],widths:[26,36,75,75,90,90],rows:[...important.map((x:any)=>[x.kind,x.attributeId??x.categoryId??x.after?.id??'',brief(x.before),brief(x.after),x.reason??'明确分组条件与至少一路完整语义','保留旧版，重新按新版证据核验']),...(review.appliedChanges??[]).map((x:any)=>['Codex终审修订',x.target??x.attributeId??x.fact??x.id??x.kind??'',brief(x.before),brief(x.after),x.reason,'按新标准重验，不回填旧评估'])],preview:'A2:B10'});
tables.push({name:'四模型裁定',title:`四模型独立意见与Codex逐项裁定｜${review.decisions.length}条`,headers:['意见ID','模型','末级类目','属性ID','模型级别','模型指出的问题','模型建议','Codex处理','最终理由'],widths:[24,14,23,40,14,95,95,24,100],rows:review.decisions.map((r:any)=>[r.id,r.model,name(r.categoryId),text(r.attributeId),r.severity,r.problem,r.proposedFix,r.action,r.reason]),preview:'A2:F9'});
tables.push({name:'震坤行原表对照',title:'震坤行原表逐项审计｜原字段不是商品参数证据',headers:['原文件','工作表','Excel行号','原类目','原属性','原必填','原类型','原枚举/示例','采用方式','原因'],widths:[30,24,15,30,24,12,14,95,28,95],rows:ref.references.map((r:any)=>['XX01案例模板.xlsx.xlsx',r.sheet,r.row,r.category,r.attribute,text(r.rawValues.L),text(r.rawValues.M),text(r.rawValues.N),r.decision.action,r.decision.reason]),preview:'A2:F11'});
tables.push({name:'边界与执行规则',title:'类目边界、条件事实与计量路径',headers:['规则类别','名称/ID','内容','当前状态'],widths:[22,38,135,40],rows:[...s.categories.map((c:any)=>['类目边界',c.name,text(c.boundary),'V2类目ID不变；边界待判商品不入填充率']),...(s.openDecisions??[]).map((d:any)=>['待确认业务边界',d.id,d.question+'\n'+d.rootDecision,'边缘商品待确认，排除计率']),...s.conditionFactDefinitions.map((f:any)=>['条件事实',f.fact,`定义：${f.definition}\n真证据：${f.trueEvidence}\n假证据：${f.falseEvidence}\n排除：${f.notEvidence}`,'未知不当否；须当前SKU证据']),...s.requirementGroups.map((g:any)=>['计量/信息组',name(g.categoryId)+' / '+g.id,text(g.paths??g.atLeastOne)+'\n'+g.reason,'至少一条适用且完整的路径']),...Object.entries(s.requirednessContract).map(([k,v])=>['执行口径',k,text(v),'新版本独立执行']),...(s.crossFieldRules??[]).map((x:any)=>['跨字段规则',x.id,text(x),'预检+Codex复核'])],preview:'A2:D8'});
tables.push({name:'商品重验清单',title:'历史商品待重验清单｜尚未生成新版填充率',headers:['历史批次','样本键','末级类目','商品源ID','商品标题','原归属状态','受影响属性ID','新版本处理状态','计率要求'],widths:[34,12,23,39,90,20,85,28,65],rows:regression.records.map((r:any)=>[r.batch,r.key,r.categoryName,r.productId,r.title,r.previousCategoryStatus,r.changedAttributeIds.join('；'),'待按修订版重新核验',r.ratePolicy]),preview:'A2:E9'});
tables.push({name:'审核状态与调用',title:'模型调用及闭环状态｜模型共识不等于准确率',headers:['阶段','模型','状态','响应模型名','输入Token','输出Token','说明/记录'],widths:[40,16,25,32,18,18,110],rows:[['标准版本','','待运营确认','','','',s.releaseId+'；原审核版：'+review.reviewedDraftHash+'；最终版：'+review.finalCandidateHash],...models.map(r=>[r.stage,r.model.id,r.recovery?'解析失败；已按原文恢复':r.status==='completed'?'已返回并复核':'调用失败（原记录）',r.responseModel??'未返回',r.usage?.prompt_tokens??r.usage?.input_tokens??'未返回',r.usage?.completion_tokens??r.usage?.output_tokens??'未返回',r.recovery?text(r.recovery)+'；原错误：'+r.error:r.error??r.file]),['商品新版本重验','','尚未执行','','','','本文件交付属性修订和卡片审核，不把历史百分比当新版结果'],['运营随机抽检','','待运营审核','','','','请在总览及完整属性卡的运营意见栏反馈'],['线上验收','','尚未执行','','','','先完成重验与运营审核，再准备小范围同步、搜索筛选及回滚验收']],preview:'A2:D11'});
await save(join(dir,'report-data.json'),{standardVersion:s.releaseId,sourcePath:ref.source.path,sourceHash:ref.source.sha256,tables});
console.log({sheets:tables.length,cards:s.bindings.length,reviewIssues:review.decisions.length,calls:models.length});
