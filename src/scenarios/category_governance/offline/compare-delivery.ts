import { resolve, join } from "node:path";
import { fromStdText } from "./codec.ts";
import { digest, stableJson } from "./build.ts";
const beforeName=Bun.argv.find(a=>a.startsWith("--before="))?.slice(9)??"agent-draft-v2-required";
const afterName=Bun.argv.find(a=>a.startsWith("--after="))?.slice(8)??"agent-delivery-v3";
for(const name of [beforeName,afterName])if(!/^[a-zA-Z0-9_-]+$/.test(name))throw new Error("无效版本名");
const root=resolve(import.meta.dir,"../workspace/output/v1");
const before=fromStdText(await Bun.file(join(root,beforeName,"templates.std.json")).text());
const after=fromStdText(await Bun.file(join(root,afterName,"templates.std.json")).text());
const by=new Map(before.categories.map(c=>[c.category.id,c]));
let changed=0,added=0,removed=0,requirementsChanged=0,nameTypeOrUnitChanged=0;
for(const c of after.categories){
  const b=by.get(c.category.id);if(!b||stableJson(b.category)!==stableJson(c.category))throw new Error("类目身份变化");
  const previous=new Map([...b.shared,...b.properties].map(p=>[p.key,p]));const now=[...c.shared,...c.properties];
  if(stableJson([...b.shared,...b.properties])!==stableJson(now))changed++;
  for(const p of now){const old=previous.get(p.key);if(!old){added++;continue;}
    if(p.required!==old.required||p.requiredWhenApplicable!==old.requiredWhenApplicable||p.condition!==old.condition)requirementsChanged++;
    if(p.unit!==old.unit||p.type!==old.type||p.name!==old.name)nameTypeOrUnitChanged++;previous.delete(p.key);
  }removed+=previous.size;by.delete(c.category.id);
}
if(by.size)throw new Error("类目遗漏");
const result={before:beforeName,after:afterName,categories:after.categories.length,changed,added,removed,requirementsChanged,nameTypeOrUnitChanged,baselineSha256:digest(new Uint8Array(await Bun.file(join(root,"baseline/attribute-templates-v1.json")).arrayBuffer()))};
await Bun.write(join(root,afterName,".repro/comparison.json"),JSON.stringify(result,null,2));console.log(result);
