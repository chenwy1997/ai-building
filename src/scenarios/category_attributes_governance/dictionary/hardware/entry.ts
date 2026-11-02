import { Database } from 'bun:sqlite';
import { mkdir, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildHardware } from './build.ts';
import { buildContextPacks } from './context.ts';
import { digest, toStdText, stable } from '../contracts.ts';
import { locked } from '../../storage.ts';

const root=resolve(import.meta.dir,'../../workspace');
const version='hardware30-v1';
const output=resolve(root,'dictionary/v1',version);
const htmlEscape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const requirement={required:'必填',conditional:'条件必填',optional:'选填'};
function inspectInventory(excluded:Set<string>) {
  const db=new Database(resolve(root,'dictionary/v1/attribute-library-v1.sqlite'),{readonly:true});
  try {
    const cats=db.query(`SELECT DISTINCT category_id,category_name,path FROM candidates_v1 WHERE namespace='sanheng' AND json_extract(path,'$[1]')='五金工具' ORDER BY category_id`).all() as Array<{category_id:string;category_name:string;path:string}>;
    const unique=new Map<string,typeof cats[number]>();
    for(const c of cats){if(unique.has(c.category_id)&&unique.get(c.category_id)!.path!==c.path)throw Error(`同ID类目路径冲突 ${c.category_id}`);unique.set(c.category_id,c);}
    const branches=[...new Set(cats.map(c=>JSON.parse(c.path)[2] as string))].sort();
    const holdout=branches.map(branch=>{
      const candidates=[...unique.values()].filter(c=>JSON.parse(c.path)[2]===branch&&!excluded.has(c.category_id)).sort((a,b)=>digest(`hardware-holdout-v1:${a.category_id}`).localeCompare(digest(`hardware-holdout-v1:${b.category_id}`),'en'));
      if(!candidates.length)throw Error(`分支没有可留出类目 ${branch}`);
      const c=candidates[0]!;return {id:c.category_id,name:c.category_name,path:JSON.parse(c.path),status:'未编写独立标签，未评估'};
    });
    const counts=db.query(`SELECT count(*) contextualCandidates,count(DISTINCT name) distinctNames FROM candidates_v1 WHERE namespace='sanheng' AND json_extract(path,'$[1]')='五金工具'`).get();
    return {categories:unique.size,branches:branches.length,counts,holdout};
  }finally{db.close();}
}
function render(pack:ReturnType<typeof buildHardware>,inventory:ReturnType<typeof inspectInventory>,contexts:ReturnType<typeof buildContextPacks>) {
  const blocks=pack.templates.map(t=>{
    const changes=pack.comparisons.filter(c=>c.categoryId===t.category.id);
    const rows=t.attributes.map((a,i)=>{
      const app=t.applications[i]!;const c=changes.find(c=>c.sourceKey===app.sourceKey)!;
      const unit=a.selectedUnitId?pack.dictionary.units.find(u=>u.id===a.selectedUnitId)!.symbol:'—';
      return `<tr data-changed="${c.action==='保留并定ID'?'false':'true'}"><td>${htmlEscape(a.name)}<small>${htmlEscape(a.id)}</small></td><td>${requirement[a.requirement]}${a.condition?'<small>'+htmlEscape(a.condition)+'</small>':''}</td><td>${htmlEscape(a.type)}<small>${htmlEscape(unit)}</small></td><td>${htmlEscape(a.definition)}${a.qualifications.length?'<small>'+a.qualifications.map(htmlEscape).join('；')+'</small>':''}</td><td>${htmlEscape(c.action)}<small>${htmlEscape(c.reason)}</small></td></tr>`;
    }).join('');
    const removed=changes.filter(c=>!c.after).map(c=>`<p class="removed">移出：${htmlEscape(c.before?.[1])} — ${htmlEscape(c.reason)}</p>`).join('');
    return `<section class="category" data-search="${htmlEscape(t.category.pathNames.join(' '))}"><h2>${htmlEscape(t.category.name)} <span>${t.attributes.length} 个属性</span></h2><p>${htmlEscape(t.category.pathNames.join(' › '))}</p><table><thead><tr><th>属性与固定ID</th><th>填写要求</th><th>类型 / 单位</th><th>定义及格式</th><th>与原样板对照</th></tr></thead><tbody>${rows}</tbody></table>${removed}</section>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>五金工具属性包｜30类对照</title><style>body{font:15px/1.65 system-ui,sans-serif;margin:0;background:#f5f7fa;color:#142c3a}header,main{max-width:1500px;margin:auto;padding:28px}header{background:#e9f2f3}h1{margin:0}h2{font-size:22px}h2 span{font-size:14px;color:#657a86}small{display:block;color:#536977;font-size:12px;margin-top:5px;overflow-wrap:anywhere}section{background:white;padding:20px;margin:24px 0;border:1px solid #d6e0e6;border-radius:8px;overflow:auto}table{border-collapse:collapse;width:100%;min-width:850px}th,td{padding:12px;text-align:left;border-bottom:1px solid #dce5e9;vertical-align:top}th{background:#edf3f4}th:nth-child(1){width:18%}th:nth-child(2){width:13%}th:nth-child(3){width:8%}th:nth-child(4){width:38%}.removed{color:#735126}input[type=search]{padding:12px;width:min(420px,80vw);border:1px solid #a9bbc5;border-radius:5px}label{margin:10px}a{color:#075f75}li{margin:8px 0}.bar{position:sticky;top:0;background:#e9f2f3;padding:12px;z-index:1}</style><header><h1>五金工具属性包 · 30类对照</h1><p>原类目保持不变 · 本地编译 · 未调用付费模型</p><p>${pack.metrics.concepts} 个项目属性定义，${pack.metrics.templateAttributes} 个类目属性绑定，${pack.metrics.sharedConcepts} 个跨类复用概念。原样板 ${pack.metrics.sourceAttributes} 项，本轮删除 ${pack.metrics.removed} 项、新增 ${pack.metrics.added} 项。</p><p>五金候选覆盖 ${inventory.categories} 类。本页仅是 30 类开发参考，尚未通过独立行业验收；待解决事项列于页尾。${contexts.length} 个稳定分支知识包已准备，未测 DeepSeek 缓存命中率。</p></header><main><div class="bar"><input id="query" type="search" placeholder="搜索类目，如套筒、O形圈"><label><input type="checkbox" id="changed">只显示有调整的字段</label><span id="count"></span></div>${blocks}<section><h2>待解决问题</h2><ul>${pack.unresolved.map(x=>`<li><b>${htmlEscape(x.category)}</b>：${htmlEscape(x.issue)}<br>${htmlEscape(x.action)}</li>`).join('')}</ul></section><section><h2>本輪制造商资料核对</h2><ul>${Object.values(pack.sources).map(s=>`<li><a href="${htmlEscape(s.url)}">${htmlEscape(s.url.split('/')[2])}</a>：${htmlEscape(s.summary)}<small>${htmlEscape(s.scope)}</small></li>`).join('')}</ul><p>未将厂家某型号参数转换成全类枚举。更多原始京东引用保留在模板JSON的证据与引用字段中；引用存在本身不代表全部定义已被证明。</p></section></main><script>const q=document.querySelector('#query'),only=document.querySelector('#changed');function filter(){let n=0;document.querySelectorAll('.category').forEach(s=>{s.hidden=!s.dataset.search.includes(q.value.trim());if(!s.hidden)n++;s.querySelectorAll('tbody tr').forEach(r=>r.hidden=only.checked&&r.dataset.changed==='false')});document.querySelector('#count').textContent='显示 '+n+' / 30 类'}q.addEventListener('input',filter);only.addEventListener('change',filter);filter();</script></html>`;
}
export async function main() {
  const source=await Bun.file(resolve(root,'reference/hardware30-expert-reference-v1/results.json')).text();
  const pack=buildHardware(source),contexts=buildContextPacks(pack);
  const inventory=inspectInventory(new Set(pack.templates.map(t=>t.category.id)));
  const fingerprint=digest({pack,contexts,inventory});
  await mkdir(resolve(output,'..'),{recursive:true});
  await locked(resolve(output,'..'),async()=>{
    const manifestPath=resolve(output,'manifest.json');
    if(await Bun.file(manifestPath).exists()){
      const previous=await Bun.file(manifestPath).json();
      if(previous.fingerprint!==fingerprint)throw Error(`${version} 已冻结且内容发生变化；请审阅变更并递增包版本，不覆盖原包。`);
      console.log(`输入未变，复用已有属性包：${output}`);return;
    }
    const tmp=`${output}.tmp-${process.pid}`;await mkdir(tmp,{recursive:true});
    try {
      await Bun.write(resolve(tmp,'property-dictionary.json'),stable(pack.dictionary));
      await Bun.write(resolve(tmp,'property-dictionary.std.txt'),toStdText(pack.dictionary));
      await Bun.write(resolve(tmp,'templates.json'),stable({schema:pack.schema,status:pack.status,sourceHash:pack.sourceHash,dictionaryHash:pack.dictionaryHash,templates:pack.templates}));
      await Bun.write(resolve(tmp,'comparison.json'),JSON.stringify({comparisons:pack.comparisons,revisions:pack.revisions},null,2));
      await Bun.write(resolve(tmp,'context-packs.json'),JSON.stringify(contexts));
      await Bun.write(resolve(tmp,'holdout-plan.json'),JSON.stringify({selection:'每个五金二级分支选取一个未参与本轮30类整理的类目；按固定盐和ID哈希确定，不按已知结果选样。历史库可能包含这些类目的旧候选，这不是对历史训练数据的隔离。',status:'未评估；需独立编写参考答案',categories:inventory.holdout},null,2));
      await Bun.write(resolve(tmp,'unresolved.json'),JSON.stringify(pack.unresolved,null,2));
      await Bun.write(resolve(tmp,'查看对照.html'),render(pack,inventory,contexts));
      const metrics=pack.metrics;
      const md=`# 五金工具属性包 ${version}\n\n本轮以现有30类参考为基础，由本执行者做语义整理并用本地编译器输出。未调用DeepSeek或京东API。属于开发参考，不是独立盲测通过的交付定版。\n\n- 五金候选库：${inventory.categories} 个末级类目、${inventory.branches} 个二级分支。\n- 对照模板：${metrics.categories} 类、${metrics.templateAttributes} 个属性绑定。\n- 属性包：${metrics.concepts} 个不同定义，其中 ${metrics.sharedConcepts} 个跨类复用，共节省 ${metrics.reusedBindings} 次重复定义。\n- 原参考 ${metrics.sourceAttributes} 项，本轮删除 ${metrics.removed} 项、新增 ${metrics.added} 项；${metrics.semanticEdits} 项显式语义审阅修改，另有 ${metrics.openEnumConversions} 项枚举转开放文本。各统计维度不相加。\n- 稳定分支上下文：${contexts.length} 包，不包含逐类标准答案。缓存命中率尚未实测。\n\n[打开30类对照表](查看对照.html) · [未解决问题](unresolved.json) · [下一轮30类留出计划](holdout-plan.json)\n\n## 关键处理\n\nO形圈承压参数移出本体属性，保留为应用条件问题；硬度保留测试标度；电钻和钳子保留工况；锯片厚度和锯路分开；钉枪击发方式按控制方式表达。五金包复用通用种子ID，其余概念只在明确对象内复用，没有自动扩大到2258类。\n\n复杂多值、工况、范围暂以带格式的开放文本表达，数值/单位字段受编译器约束；还没有商品值层面的结构化数值验证。本轮是类目属性模板工作，不填写商品值。\n\n## 复现\n\n\`bun run category-attributes-governance:hardware-pack\`\n\n相同输入复用冻结包；源参考哈希变动会失败并要求重新审阅。概念变化须递增定义revision和包版本。\n\n## 下一步边界\n\n先为holdout-plan.json编写独立参考标签，再测试按ID选配。当前30类曾参与本轮整理，不能用来报告盲测准确率。草坪修剪机对象范围、发热芯电气附加定义、铁路工具性能和防火花声明还有专项问题。此前付费semantic入口仍保留，尚未接入新属性包。\n`;
      await Bun.write(resolve(tmp,'查看样板.md'),md);
      await Bun.write(resolve(tmp,'manifest.json'),JSON.stringify({version,fingerprint,sourceHash:pack.sourceHash,dictionaryHash:pack.dictionaryHash,metrics,inventory:{categories:inventory.categories,branches:inventory.branches,counts:inventory.counts},reviewedAt:'2026-09-15',status:pack.status,files:['property-dictionary.json','property-dictionary.std.txt','templates.json','comparison.json','context-packs.json','holdout-plan.json','unresolved.json','查看对照.html','查看样板.md']},null,2));
      await rename(tmp,output);
    }catch(e){await rm(tmp,{recursive:true,force:true});throw e;}
  });
  console.log(JSON.stringify(pack.metrics,null,2));console.log(`查看：${resolve(output,'查看样板.md')}`);
}
if(import.meta.main)main().catch(e=>{console.error(e.message);process.exitCode=1;});
