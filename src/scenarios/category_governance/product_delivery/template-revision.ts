import {join,resolve} from "node:path";
import {homedir} from "node:os";
import {fromStdText} from "../offline/codec.ts";
import {excelRows,HEADERS} from "../offline/excel.ts";
import {outputDir,loadJson,saveJson,sha256} from "./io.ts";
import {templateHash} from "./decisions.ts";
import type {KnowledgeProperty} from "../offline/types.ts";

export const revisionDir=resolve(outputDir,"../product-delivery-v2");
export const revisionRepro=join(revisionDir,".repro");
export interface TemplateRows {headers:string[];rows:string[][];changeHeaders:string[];listedPaths:string[][]}
export interface CategoryDiff {id:string;path:string[];before:string[][];after:string[][];added:string[];removed:string[];updated:Array<{name:string;fields:string[]}>}
export const pathKey=(path:string[])=>JSON.stringify(path);
const grouped=(rows:string[][])=>{const groups=new Map<string,string[][]>();for(const row of rows){const key=pathKey(row.slice(0,4));const group=groups.get(key)??[];group.push(row);groups.set(key,group);}return groups;};

export async function readRevision(template:string,changes:string){
 const source=resolve(template),changeSource=resolve(changes);
 const hash=sha256(new Uint8Array(await Bun.file(source).arrayBuffer())),changeHash=sha256(new Uint8Array(await Bun.file(changeSource).arrayBuffer()));
 const cache=join(revisionRepro,`template-${hash.slice(0,12)}-${changeHash.slice(0,12)}.json`);
 if(!await Bun.file(cache).exists()){
  const python=process.env.ARTIFACT_PYTHON??join(homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3");
  const child=Bun.spawn([python,join(import.meta.dir,"read-template.py"),source,changeSource,cache],{stdout:"inherit",stderr:"inherit"});
  if(await child.exited!==0)throw new Error("修订模板读取失败");
 }
 const data=await loadJson<TemplateRows>(cache);
 if(JSON.stringify(data.headers)!==JSON.stringify(HEADERS)||JSON.stringify(data.changeHeaders)!==JSON.stringify(HEADERS.slice(0,4)))throw new Error("模板或清单表头不符");
 const oldSource=await Bun.file(join(outputDir,"../agent-delivery-v3/templates.std.json")).text();
 if(sha256(oldSource)!==templateHash)throw new Error("原模板基线变化");
 const old=fromStdText(oldSource),before=grouped(excelRows(old)),after=grouped(data.rows);
 const ids=new Map(old.categories.map(c=>[pathKey(c.category.path.slice(1)),c.category.id]));
 const listed=new Set(data.listedPaths.map(pathKey)),diffs:CategoryDiff[]=[];
 for(const [path,rows] of after){
  if(!ids.has(path))throw new Error(`修订模板出现原库没有的类目 ${path}`);
  if(rows.some(r=>r.length!==12))throw new Error(`模板列数错误 ${path}`);
  if(new Set(rows.map(r=>r[4])).size!==rows.length)throw new Error(`重复属性 ${path}`);
 }
 for(const [path,rows] of before){
  const next=after.get(path);if(!next?.length)throw new Error(`修订模板缺少整个类目 ${path}`);
  const prevMap=new Map(rows.map(r=>[r[4]!,r])),nextMap=new Map(next.map(r=>[r[4]!,r]));
  const added=next.filter(r=>!prevMap.has(r[4]!)).map(r=>r[4]!);
  const removed=rows.filter(r=>!nextMap.has(r[4]!)).map(r=>r[4]!);
  const updated=next.flatMap(r=>{const p=prevMap.get(r[4]!);const fields=p?HEADERS.slice(5).filter((_,i)=>r[i+5]!==p[i+5]):[];return fields.length?[{name:r[4]!,fields}]:[];});
  if(added.length||removed.length||updated.length)diffs.push({id:ids.get(path)!,path:JSON.parse(path),before:rows,after:next,added,removed,updated});
 }
 const missingFromList=diffs.filter(d=>!listed.has(pathKey(d.path))).map(d=>d.path);
 const unchangedListed=[...listed].filter(k=>!diffs.some(d=>pathKey(d.path)===k)).map(k=>JSON.parse(k));
 const result={source,sourceHash:hash,changeSource,changeHash,baselineHash:templateHash,categoryCount:after.size,attributeCount:data.rows.length,listedCount:listed.size,diffs,missingFromList,unchangedListed};
 await saveJson(join(revisionRepro,"template-diff.json"),result);
 return result;
}

export function propertyFromRow(row:string[],previous?:KnowledgeProperty):KnowledgeProperty{
 const types:Record<string,KnowledgeProperty["type"]>={文本:"text",数值:"number",布尔:"boolean",单选:"single",多选:"multi",日期:"date",文件:"file"};
 const type=types[row[6]!];if(!type)throw new Error(`未知属性类型 ${row[6]}`);
 if(!["必填","选填","条件必填","条件选填"].includes(row[7]!))throw new Error(`未知填写要求 ${row[7]}`);
 const condition=row[5]!.match(/(?:^|；)适用条件：(.*)$/u)?.[1];
 const conditional=row[7]!.startsWith("条件");
 if(conditional&&!condition)throw new Error(`条件属性缺适用条件 ${row.slice(0,5).join(" > ")}`);
 return {key:previous?.key??`expert_${sha256(row[4]!).slice(0,12)}`,name:row[4]!,description:row[5]!.replace(/(?:^|；)适用条件：.*$/u,""),type,required:row[7]==="必填",...(conditional?{condition,requiredWhenApplicable:row[7]==="条件必填"}:{}),...(row[8]?{unit:row[8]}:{}),...(row[9]?{options:row[9].split(/[;；]/u).map(s=>s.trim()).filter(Boolean)}:{}),...(row[10]?{format:row[10]}:{}),...(row[11]?{example:row[11]}:{})};
}

if(import.meta.main){
 const r=await readRevision(Bun.argv[2]??"属性模板-修订版.xlsx",Bun.argv[3]??"改动类目清单.csv");
 const products=await loadJson<Array<{row:number;category:{id:string;name:string}}>>(join(outputDir,".repro/resolved-products.json"));
 const affected=r.diffs.filter(d=>products.some(p=>p.category.id===d.id));
 await saveJson(join(revisionRepro,"affected-template-diff.json"),affected);
 console.log(JSON.stringify({categories:r.categoryCount,attributes:r.attributeCount,changed:r.diffs.length,listed:r.listedCount,missingFromList:r.missingFromList.length,unchangedListed:r.unchangedListed.length,affectedCategories:affected.length,affectedProducts:products.filter(p=>affected.some(d=>p.category.id===d.id)).length}));
 console.log(affected.map(d=>`${d.path.join("/")} | +${d.added.join(",")} | -${d.removed.join(",")} | ~${d.updated.map(x=>x.name+":"+x.fields.join(",")).join(";")}`).join("\n"));
}
