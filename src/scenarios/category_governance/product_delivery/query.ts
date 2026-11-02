import { join } from "node:path";
import { loadJson, reproDir } from "./io.ts";
import { parseAssignments, groupAssignmentsText, rowAssignmentsText } from "./decisions.ts";
import type { CategoryIndex, ReviewGroup } from "./review.ts";
import type { PreparedProduct } from "./prepare.ts";
const categories=await loadJson<CategoryIndex[]>(join(reproDir,"category-index.json"));
const products=await loadJson<PreparedProduct[]>(join(reproDir,"products.json"));
const groups=await loadJson<ReviewGroup[]>(join(reproDir,"review.json"));
const command=Bun.argv[2];
if(command==="pending"){
 const gm=parseAssignments(groupAssignmentsText),rm=parseAssignments(rowAssignmentsText);
 const rows=products.filter(p=>!rm.has(p.row)&&!gm.has(groups.find(g=>g.rows.includes(p.row))!.group));
 console.log(`待决定 ${rows.length}`);console.log(rows.slice(Number(Bun.argv[3]??0),Number(Bun.argv[4]??1000)).map(p=>`${p.row}|${p.title}|${p.variant}`).join("\n"));
}else if(command==="fields"){
 const requested=new Set(Bun.argv.slice(3).map(Number));
 for(const p of products.filter(p=>requested.has(p.row))) console.log(JSON.stringify(p));
}else if(command==="categories"){
 const requested=new Set(Bun.argv.slice(3).map(Number));
 console.log(categories.filter(c=>requested.has(c.index)).map(c=>`${c.index}:${c.path.join("/")}|${c.names.join(";")}`).join("\n"));
}else{
 const regex=new RegExp(command??"^$","u");
 const hits=categories.filter(c=>regex.test(c.path.at(-1)!));
 console.log(hits.map(c=>`${c.index}:${c.path.join("/")}`).join("\n"));
}
