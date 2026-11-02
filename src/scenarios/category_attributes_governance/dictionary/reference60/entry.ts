import { mkdir, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digest, stable, toStdText } from '../contracts.ts';
import { locked } from '../../storage.ts';
import { buildReference } from './build.ts';
import type { Inputs } from './build.ts';
import { inputHashes, scopeHolds, version } from './review.ts';
const root=resolve(import.meta.dir,'../../workspace/dictionary/v1');
const req={required:'必填',conditional:'条件必填',optional:'选填'};
const types={text:'文本',number:'数值',integer:'整数',boolean:'布尔',range:'区间'};
const esc=(v:unknown)=>String(v??'').replace(/\|/g,'\\|').replace(/\n/g,'<br>');
export function renderTemplates(p:ReturnType<typeof buildReference>){
 return '# 五金60类属性参考模板\n\n保留原类目ID、名称和层级。56类可进入开发对照试跑，4类暂存对象范围问题。这里是类目属性定义，不是商品值。参考就绪不等于独立行业验收。\n\n'+p.templates.map(t=>`## ${t.category.name}\n\n${t.category.pathNames.join(' › ')}\n\nID：\`${t.category.id}\`\n\n状态：${t.status==='reference-ready'?'开发对照就绪':'对象范围待确认，不进入模型评分'}。${t.scopeQuestion??''}\n\n核对结论：${t.reviewNote}\n\n|属性|填写要求|类型 / 单位|定义、对象及格式|\n|---|---|---|---|\n`+t.attributes.map(a=>{
 const u=p.dictionary.units.find(u=>u.id===a.selectedUnitId)?.symbol??'—';
 return `|${esc(a.name)}<br>\`${a.id}@${a.revision}\`|${req[a.requirement]}${a.condition?'<br>'+esc(a.condition):''}|${types[a.type]} / ${u}|对象：${esc(a.object)}<br>${esc(a.definition)}${a.qualifications.length?'<br>'+esc(a.qualifications.join('；')):''}|`;
 }).join('\n')+'\n').join('\n');
}
export function renderSummary(p:ReturnType<typeof buildReference>){
 const m=p.metrics;
 return `# 五金60类参考版 ${version}\n\n本轮完成60类逐类语义核对，原类目未改动。由本执行者编写并核对，未调用DeepSeek或京东API，不是独立行业验收。\n\n## 当前结果\n\n- **${m.referenceReady}类可用于下一步开发对照，${m.scopeHeld}类仅暂存范围条件样板。** 后者不进入自动评分与发布。\n- 类目属性从${m.sourceBindings}项调整到${m.bindings}项：新增${m.addedBindings}、移出${m.removedBindings}，另外${m.replacedBindings}项换用正确对象定义、${m.policyChanges}项调整填写策略。\n- ${m.changedCategories}类有实际调整，其余保留并记录核对理由。${m.revisedDefinitions}个定义升版本，涉及${m.definitionRevisionBindings}项绑定；统计维度不相加。\n- 新增${m.newDefinitions}个知识定义；当前${m.activeDefinitions}个概念、含历史修订共${m.definitionVersions}个定义版本。原两个冻结包保持不变。\n- 没有付费请求、没有缓存命中实测、没有启动服务。\n\n[查看60类完整模板](属性模板.md) · [查看逐项变更](变更清单.md) · [逐类核对记录](review-records.json) · [原问题处理结果](issue-resolutions.json)\n\n## 本次修正的实际问题\n\n1. 电锤按工具设计电压选配；充电组套按实际电池型号分别记录电压。\n2. 防爆套筒扳杆记录向套筒传力的输出接口，避免套用输入接口定义。\n3. 液压捣固机区分振动与击打，补外接回油背压；手持机不强求轨距。\n4. 轨缝调整器区分推拉方向、推力、拉力及有效行程，补夹持方式。\n5. 发热芯区分引线和端子连接；刀具、剥线钳、弹簧夹补安装配合或适用尺寸。\n6. 移除运输包装尺寸、产地及重复列表，保留必要销售配置。\n\n“还没有某型号的实际参数”不再作为模板未完成的理由。模板只定义应填的维度、对象、单位和条件。型号数值和证书随后依商品资料填写，不在本轮编造。\n\n## 仍然待确认的4个对象范围\n\n${Object.entries(scopeHolds).map(([name,q])=>`- **${name}**：${q}`).join('\n')}\n\n这4项是三横业务范围信息，不能通过另一厂家的某个型号替代确认。本轮仍提供条件模板，保留原名称和路径，没有把它们伪装成已验收结果。\n\n## 如何验收后续模型输出\n\n先跑trial-plan.json固定的10类。参考答案与模型上下文分别存放，避免把答案传给模型再宣称独立正确。此10类属于已知开发样板上的回归检查，不是盲测。\n\n- 必须保持类目身份；属性响应能够引用已存在的定义和版本。\n- 核对关键选型维度有无遗漏、错误适用；条件属性按适用分支判定，不要求所有商品都填。\n- 输入与输出、主体与配件、额定与峰值、尺寸方向和量纲不得混淆。\n- 允许有依据的等义拆分或合并，经人工裁定记录，不能仅按属性ID完全相等判优劣。\n- 新概念只作为建议隔离保存；未知值、材料推性能和伪造封闭枚举不能采用。\n- 10类核心遗漏、错误适用和关键条件错误均为0后再扩样；这是本项目的试跑门槛，不是行业认证标准。\n\n试跑配置先冻结为思考关闭、上限10元；本轮仅生成计划，没有执行模型调用。自动语义评分器未实现。\n\n## 可复现入口\n\n\`bun run category-attributes-governance:hardware-reference\`\n\n只读两份冻结样板，用本轮显式审阅记录编译输出；不会触发模型。相同输入校验并复用产物；变化必须新建版本。审核记录是知识数据，不是遇到关键词就自动套模板的规则。\n\n压缩文件保留全部定义字段，运行时再按工具族取相关定义形成稳定前缀；目前没有接入DeepSeek，也不应为提高命中率而把整个字典逐请求发送。\n\n## 本轮补充资料\n\n${Object.entries(p.sources).map(([key,s])=>`- [${key}：原始资料](${s.url})：${s.finding} ${s.boundary}`).join('\n')}\n`;
}
export function renderChanges(p:ReturnType<typeof buildReference>){
 const labels:Record<string,string>={add:'新增',remove:'移出',select:'填写策略',replace:'换用定义','definition-revision':'定义升版'};
 const selectionText=(s:{propertyId:string;revision:number;requirement:string;condition?:string}|null)=>s?`${s.propertyId}@${s.revision} / ${s.requirement}${s.condition?' / '+s.condition:''}`:'—';
 return '# 五金60类变更清单\n\n所有改动保留原定义与源包。删除只发生在新参考版的类目绑定中。\n\n|类目|操作|原绑定|新绑定|原因|\n|---|---|---|---|---|\n'+p.changes.map(c=>`|${esc(c.category)}|${labels[c.kind]}|${esc(selectionText(c.before))}|${esc(selectionText(c.after))}|${esc(c.reason)}|`).join('\n')+'\n\n## 定义修改\n\n'+p.definitionChanges.map(c=>`- **${c.after.name}** \`${c.id}@${c.after.revision}\`：${c.reason}\n  - 原定义：${c.before?.definition??'新增'}\n  - 新定义：${c.after.definition}\n`).join('\n');
}
export async function main(){
 const inputs={} as Inputs;for(const k of Object.keys(inputHashes) as Array<keyof Inputs>)inputs[k]=await Bun.file(resolve(root,k)).json();
 const p=buildReference(inputs);
 const files:Record<string,string>={
  'property-dictionary.json':stable(p.dictionary),'active-dictionary.std.txt':toStdText(p.activeDictionary),
  'templates.json':stable({version,status:p.status,templates:p.templates}),
  'changes.json':stable({bindings:p.changes,definitions:p.definitionChanges}),
  'review-records.json':JSON.stringify(p.templates.map(t=>({category:t.category,status:t.status,reviewNote:t.reviewNote,scopeQuestion:t.scopeQuestion,acceptance:t.acceptance})),null,2),
  'issue-resolutions.json':JSON.stringify(p.issueResolutions,null,2),'trial-plan.json':JSON.stringify(p.trialPlan,null,2),
  'sources.json':JSON.stringify(p.sources,null,2),'查看结果.md':renderSummary(p),'属性模板.md':renderTemplates(p),'变更清单.md':renderChanges(p),
 };
 const fileHashes=Object.fromEntries(Object.entries(files).map(([k,v])=>[k,digest(v)]));
 const fingerprint=digest({version,inputHashes,fileHashes});
 const output=resolve(root,version);await mkdir(root,{recursive:true});
 await locked(root,async()=>{
  const mf=Bun.file(resolve(output,'manifest.json'));
  if(await mf.exists()){
   if((await mf.json()).fingerprint!==fingerprint)throw Error('参考版已冻结，变化必须审阅并升级版本');
   for(const[k,h]of Object.entries(fileHashes))if(!(await Bun.file(resolve(output,k)).exists())||digest(await Bun.file(resolve(output,k)).text())!==h)throw Error(`冻结产物被修改 ${k}`);
   console.log('输入及产物一致，复用冻结参考版');return;
  }
  const tmp=output+'.tmp-'+process.pid;await mkdir(tmp,{recursive:true});
  try{for(const[k,v]of Object.entries(files))await Bun.write(resolve(tmp,k),v);
   await Bun.write(resolve(tmp,'manifest.json'),JSON.stringify({version,status:p.status,fingerprint,inputHashes,fileHashes,metrics:p.metrics,modelExecuted:false},null,2));
   await rename(tmp,output);
  }catch(e){await rm(tmp,{recursive:true,force:true});throw e;}
 });
 console.log(JSON.stringify(p.metrics,null,2));console.log('查看：'+resolve(output,'查看结果.md'));
}
if(import.meta.main)main().catch(e=>{console.error(e.message);process.exitCode=1;});
