import { join } from "node:path";
import { loadJson, saveJson, reproDir } from "./io.ts";
import type { PreparedProduct } from "./prepare.ts";
export interface CategoryIndex {index:number;id:string;path:string[];names:string[]}
export interface ReviewGroup {group:number;jdPath:string;rows:number[];candidates:Array<{index:number;path:string[];score:number}>}
const norm=(s:string)=>s.normalize("NFKC").toLowerCase().replace(/[\s()（）\-_/、]/gu,"");
function grams(s:string){const set=new Set<string>();const v=norm(s);for(let i=0;i<v.length-1;i++)set.add(v.slice(i,i+2));return set;}
export async function buildReview(){
 const products=await loadJson<PreparedProduct[]>(join(reproDir,"products.json"));
 const categories=await loadJson<CategoryIndex[]>(join(reproDir,"category-index.json"));
 const groups=new Map<string,PreparedProduct[]>();
 for(const p of products){const key=p.jdCategory.join("/")||"京东类目缺失";const a=groups.get(key)??[];a.push(p);groups.set(key,a);}
 const sorted=[...groups].sort((a,b)=>b[1].length-a[1].length);
 const catGrams=categories.map(c=>({c,leaf:norm(c.path.at(-1)!),tokens:grams(c.path.join("/"))}));
 const result:ReviewGroup[]=sorted.map(([jdPath,rows],i)=>{
  const leaf=norm(jdPath.split("/").at(-1)!);const q=grams(jdPath),titleTokens=grams(rows.map(r=>r.title).join("/"));
  const candidates=catGrams.map(({c,leaf:name,tokens})=>({index:c.index,path:c.path,score:(name===leaf?100:0)+(name.length>1&&(name.includes(leaf)||leaf.includes(name))?15:0)+[...q].filter(x=>tokens.has(x)).length*2+[...grams(name)].filter(x=>titleTokens.has(x)).length})).sort((a,b)=>b.score-a.score).slice(0,5);
  return {group:i+1,jdPath,rows:rows.map(p=>p.row),candidates};
 });
 await saveJson(join(reproDir,"review.json"),result);return{products,categories,groups:result};
}
if(import.meta.main){
 const products=await loadJson<PreparedProduct[]>(join(reproDir,"products.json"));
 const groups=await loadJson<ReviewGroup[]>(join(reproDir,"review.json")).catch(async()=> (await buildReview()).groups);
 const start=Number(Bun.argv[2]??1),end=Number(Bun.argv[3]??30);
 for(const g of groups.filter(g=>g.group>=start&&g.group<=end)){
 console.log(`G${g.group} ${g.jdPath} (${g.rows.length})`);
 console.log(g.candidates.slice(0,3).map(c=>`${c.index}:${c.path.join("/")}`).join(" | "));
 for(const row of g.rows){const p=products.find(x=>x.row===row)!;console.log(`${p.row} ${p.title}${p.variant?"〔"+p.variant+"〕":""}`);}
 }
}
