import { resolve, join } from "node:path";
import { fromStdText } from "./codec.ts";
import { requirementLabel } from "./requirements.ts";
import { stableJson } from "./build.ts";
import type { DraftDocument } from "./types.ts";

const [beforeEdition="agent-draft-v1",afterEdition="agent-draft-v2-required"]=Bun.argv.slice(2);
if (![beforeEdition,afterEdition].every(x=>/^[a-zA-Z0-9_-]+$/.test(x))) throw new Error("版本目录名无效");
const root=resolve(import.meta.dir,"../workspace/output/v1");
const read=async(edition:string)=>fromStdText(await Bun.file(join(root,edition,"templates.std.json")).text());
const before=await read(beforeEdition),after=await read(afterEdition);
const count=(d:DraftDocument)=>["curated-template","curated-core","historical-draft"].map(t=>{
  const cs=d.categories.filter(c=>c.treatment===t),ps=cs.flatMap(c=>[...c.shared,...c.properties]);
  return {treatment:t,categories:cs.length,properties:ps.length,required:ps.filter(p=>p.required).length,conditionalRequired:ps.filter(p=>p.requiredWhenApplicable).length,withoutRequired:cs.filter(c=>![...c.shared,...c.properties].some(p=>p.required)).length};
});
if(stableJson(before.categories.map(c=>c.category))!==stableJson(after.categories.map(c=>c.category)))throw new Error("原类目发生变化");
const old=new Map(before.categories.map(c=>[c.category.id,c]));
const changes=after.categories.flatMap(c=>{
  const prev=old.get(c.category.id)!,byKey=new Map([...prev.shared,...prev.properties].map(p=>[p.key,p]));
  const current=[...c.shared,...c.properties];
  if (byKey.size!==current.length||current.some(p=>!byKey.has(p.key))) throw new Error(`属性集合发生变化：${c.category.name}`);
  return current.flatMap(p=>{const was=byKey.get(p.key)!;return requirementLabel(was)===requirementLabel(p)?[]:[{categoryId:c.category.id,path:c.category.path,property:p.name,key:p.key,before:requirementLabel(was),after:requirementLabel(p),condition:p.condition,reason:p.reason??"保留输入候选原有的必填标记，取消共用定义中的自动降级。",origin:c.provenance[p.key]!.kind}];});
});
const report={beforeEdition,afterEdition,unchangedTaxonomy:true,unchangedPropertySet:true,before:count(before),after:count(after),changedRows:changes.length,changes};
await Bun.write(join(root,afterEdition,".repro/requirements-comparison.json"),JSON.stringify(report,null,2));
const md=`# 必填要求对比\n\n${beforeEdition} → ${afterEdition}。原类目与属性集合保持一致。${changes.length} 行填写要求发生变化。\n\n完整明细见 .repro/requirements-comparison.json。本轮调整限于已有知识包定义，历史来源单独保留。\n\n|类目|属性|原要求|新要求|条件与理由|\n|---|---|---|---|---|\n${changes.filter(c=>["手机","平垫","六角螺母","生鲜灯","吸头","笔记本电脑"].includes(c.path.at(-1)!)).map(c=>`|${c.path.at(-1)}|${c.property}|${c.before}|${c.after}|${[c.condition,c.reason].filter(Boolean).join("；")}|`).join("\n")}\n`;
await Bun.write(join(root,afterEdition,"requirements-comparison.md"),md);
console.log(JSON.stringify({...report,changes:undefined},null,2));
