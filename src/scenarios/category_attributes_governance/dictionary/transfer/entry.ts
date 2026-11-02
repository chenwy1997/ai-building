import { mkdir, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildTransfer } from './build.ts';
import { digest, stable, toStdText } from '../contracts.ts';
import { locked } from '../../storage.ts';
export const version='hardware-transfer30-v1';
const root=resolve(import.meta.dir,'../../workspace/dictionary/v1');
const requirement={required:'必填',conditional:'条件必填',optional:'选填'};
const typeName={text:'文本',number:'数值',integer:'整数',boolean:'布尔',range:'区间'};
const esc=(s:unknown)=>String(s??'').replace(/\|/g,'\\|').replace(/\n/g,'<br>');
const pct=(n:number,d:number)=>(d?100*n/d:0).toFixed(1)+'%';
export function renderReport(p:ReturnType<typeof buildTransfer>){
 const m=p.metrics;
 return `# 五金工具 · 第二组30类属性模板\n\n这轮由本执行者编写属性需求、选配定义并核对；未调用DeepSeek或京东API。保留三横原类目名称、ID和层级，只处理属性模板。\n\n## 结果\n\n|指标|结果|\n|---|---:|\n|新处理类目|${m.categories}|\n|属性绑定|${m.bindings}|\n|直接采用既有定义|${m.directExistingBindings} / ${m.bindings}（${pct(m.directExistingBindings,m.bindings)}）|\n|其中第一包 / 既有通用种子|${m.directFrozenPackBindings} / ${m.extraSeedBindings}|\n|核心维度直接采用既有定义|${m.directExistingCriticalBindings} / ${m.criticalBindings}（${pct(m.directExistingCriticalBindings,m.criticalBindings)}）|\n|新增定义|${m.newDefinitions}|\n|新增中有明确旧概念关系 / 无关系记录|${m.relatedScopeDefinitions} / ${m.newWithoutPriorRelation}|\n|新增中跨类复用概念|${m.newDefinitionsSharedAcrossCategories}（多承接${m.extraBindingsFromSharedNewDefinitions}次绑定）|\n|合并字典|${m.combinedDefinitions} 个定义|\n|有公开待处理事项的类目|${m.categoriesWithOpenIssues}|\n|付费API请求|0|\n\n统计按本轮人工选配记录计算，不是对库中所有可能近义概念的穷尽检索结果。核心维度由本轮指定，排除品牌、型号及辅助选填项。扩大适用对象的新定义不算旧库直接复用；新增概念之间的复用另列。\n\n${p.evaluationBoundary}\n\n## 如何看待这版\n\n上一包对品牌、型号、几何尺寸、材料等维度有用，专业选型属性还不能覆盖不同工具。第二组新增${m.newDefinitions}个定义，也证明“有一个字典”不等于“整个五金品类已完成”。原30类加本轮30类共有60类开发参考，五金2258类尚未全覆盖。\n\n必填表示我们认为类目选型需要该维度；条件必填仅在条件成立时适用。缺少资料不应编造值。多数复合工况与规格仍为带格式的开放文本；没有强加封闭枚举，也未验证商品值填充。\n\n[查看30类完整模板](模板明细.md) · [逐类复用统计](reuse-report.json) · [待处理事项](unresolved.json)\n\n## 需要先核实的对象\n\n${p.unresolved.map(c=>`- **${c.name}**：${c.issues.join('；')}`).join('\n')}\n\n无待处理标记也只表示本轮未记录已知问题，不是独立行业验收通过。\n\n## 知识来源与边界\n\n${Object.entries(p.evidence).map(([key,e])=>`- [${key}：制造商资料](${e.url})：${e.claim} ${e.boundary}`).join('\n')}\n\n来源支持的是属性维度或对象边界，不表示全部属性已获外部证实。未把单个型号数值推广成全类约束。其余定义来自项目语义判断，均在定义basis中标明。\n\n## 复现与缓存\n\n\`bun run category-attributes-governance:hardware-transfer\`\n\n命令仅重建或复用这份已编写的30类包，不会自动分析新类目、不调用模型。定义写在dictionary/transfer/spec.ts，编译、关系记录、统计和导出函数可以复用。原冻结包不会被覆盖；输入或输出变化必须另升包版本。\n\ncontext-packs.json为每个工具族提供固定定义前缀，目标类目和新证据由未来调用方追加。它不是服务端缓存，也尚未接入DeepSeek请求；本轮没有缓存命中数据。不同工具族的前缀不同，不能承诺跨类命中。定义集来自本轮选配，不可用它检验独立检索能力。\n\n下一步应先核实有对象歧义的类目，再用另一组未参与编写的类目检验选配。当前不宜直接把2258类交给模型反复全量生成。\n`;
}
export function renderTemplates(p:ReturnType<typeof buildTransfer>){
 const origin={'frozen-hardware30':'第一包','existing-general-seed':'既有通用种子','new-this-round':'本轮新增'};
 return '# 第二组30类属性模板明细\n\n原类目保持不变；下表是属性定义，不含任何商品属性值。所有模板均为项目开发参考。\n\n'+p.templates.map(t=>{
 const stat=p.reuseByCategory.find(x=>x.id===t.category.id)!;
 return `## ${t.category.name}\n\n路径：${t.category.pathNames.join(' › ')}\n\n类目ID：\`${t.category.id}\`\n\n对象解释：${t.scope}\n\n${t.issues.length?'待处理：'+t.issues.join('；'):'状态：项目草稿，未做独立验收。'}\n\n旧定义直接采用 ${stat.directExisting}/${stat.total}；核心维度 ${stat.directExistingCritical}/${stat.critical}。\n\n|本类应用角色 / 属性名称|填写要求|类型 / 单位|定义与格式|定义来源|\n|---|---|---|---|---|\n`+t.attributes.map((a,i)=>{const app=t.applications[i]!;const unit=p.dictionary.units.find(u=>u.id===a.selectedUnitId)?.symbol??'—';return `|${esc(app.role)} / ${esc(a.name)}|${requirement[a.requirement]}${a.condition?'<br>'+esc(a.condition):''}|${typeName[a.type]} / ${unit}|${esc(a.definition)}${a.qualifications.length?'<br>'+esc(a.qualifications.join('；')):''}|${origin[app.origin as keyof typeof origin]}<br>\`${a.id}@${a.revision}\`|`;}).join('\n')+'\n';
 }).join('\n');
}
export async function main(){
 const base=await Bun.file(resolve(root,'hardware30-v1/property-dictionary.json')).json();
 const plan=await Bun.file(resolve(root,'hardware30-v1/holdout-plan.json')).json();
 const pack=buildTransfer(base,plan);
 const files:Record<string,string>={
  'property-dictionary.json':stable(pack.dictionary),'property-dictionary.std.txt':toStdText(pack.dictionary),
  'templates.json':stable({schema:pack.schema,status:pack.status,dictionaryHash:pack.dictionaryHash,templates:pack.templates}),
  'reuse-report.json':JSON.stringify({metrics:pack.metrics,categories:pack.reuseByCategory,conceptRelations:pack.conceptRelations,evaluationBoundary:pack.evaluationBoundary},null,2),
  'unresolved.json':JSON.stringify(pack.unresolved,null,2),'sources.json':JSON.stringify(pack.evidence,null,2),
  'context-packs.json':stable(pack.contexts),'查看结果.md':renderReport(pack),'模板明细.md':renderTemplates(pack),
 };
 const fileHashes=Object.fromEntries(Object.entries(files).map(([name,text])=>[name,digest(text)]));
 const fingerprint=digest({baseHash:pack.baseHash,planHash:pack.planHash,seedHash:pack.seedHash,fileHashes});
 const output=resolve(root,version);await mkdir(root,{recursive:true});
 await locked(root,async()=>{
  const manifestFile=Bun.file(resolve(output,'manifest.json'));
  if(await manifestFile.exists()){
   const old=await manifestFile.json();if(old.fingerprint!==fingerprint)throw Error('冻结包内容发生变化，必须先审阅并递增版本');
   for(const [name,hash] of Object.entries(fileHashes))if(!(await Bun.file(resolve(output,name)).exists())||digest(await Bun.file(resolve(output,name)).text())!==hash)throw Error(`冻结文件缺失或被修改：${name}`);
   console.log('输入未变，复用冻结包');return;
  }
  const tmp=output+'.tmp-'+process.pid;await mkdir(tmp,{recursive:true});
  try{
   for(const [name,text] of Object.entries(files))await Bun.write(resolve(tmp,name),text);
   await Bun.write(resolve(tmp,'manifest.json'),JSON.stringify({version,fingerprint,fileHashes,baseHash:pack.baseHash,planHash:pack.planHash,seedHash:pack.seedHash,metrics:pack.metrics,status:pack.status,holdoutStatus:'本轮已用于编写，转为开发参考',paidApiCalls:0},null,2));
   await rename(tmp,output);
  }catch(e){await rm(tmp,{recursive:true,force:true});throw e;}
 });
 console.log(JSON.stringify(pack.metrics,null,2));console.log(`查看：${resolve(output,'查看结果.md')}`);
}
if(import.meta.main)main().catch(e=>{console.error(e.message);process.exitCode=1;});
