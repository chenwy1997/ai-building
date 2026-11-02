import {join} from 'node:path';
import {ROOT,read,save,hash} from '../storage.ts';
import type {Attribute,Outcome} from '../types.ts';

/** Offline comparison only: key differences are review aids, never semantic grades. */
export async function compare(runName:string){
 if(!/^run-[\w-]+$/u.test(runName??''))throw new Error('请传入run-运行名');
 const directory=join(ROOT,'output',runName),referencePath=join(ROOT,'reference','pilot-v1','reference.json');
 const raw=await Bun.file(join(directory,'results.json')).text(),baseline=await Bun.file(referencePath).text();
 const results:Outcome[]=JSON.parse(raw),reference=JSON.parse(baseline) as {categories:Array<{category:{id:string};attributes:Attribute[]}>};
 const manifest=await read<{seedRun?:string;protocol:string}>(join(directory,'manifest.json'));
 const differences=results.map(r=>{
  const b=reference.categories.find(c=>c.category.id===r.category.id);if(!b)throw new Error('参考稿中缺少类目：'+r.category.name);
  const expected=new Map(b.attributes.map(a=>[a[0],a])),actual=new Map(r.attributes.map(a=>[a[0],a]));
  return {id:r.category.id,name:r.category.name,status:r.status,modelCount:r.attributes.length,referenceCount:b.attributes.length,
   onlyModel:r.attributes.filter(a=>!expected.has(a[0])),onlyReference:b.attributes.filter(a=>!actual.has(a[0])),
   sameKeyChanged:r.attributes.flatMap(a=>{const before=expected.get(a[0]);return before&&JSON.stringify(before.slice(0,9))!==JSON.stringify(a.slice(0,9))?[{key:a[0],reference:before,model:a}]:[];})};
 });
 await save(join(directory,'reference-diff.json'),{runName,resultHash:hash(raw),referenceHash:hash(baseline),seedRun:manifest.seedRun??null,protocol:manifest.protocol,note:'离线按key比较，不用于判定遗漏或优劣；不同key可能语义相同，参考稿不是唯一正确答案。该文件不输入模型。',differences});
 console.log(JSON.stringify(differences.map(d=>({category:d.name,status:d.status,model:d.modelCount,reference:d.referenceCount,onlyModel:d.onlyModel.map(a=>a[1]),onlyReference:d.onlyReference.map(a=>a[1])}))));
}
if(import.meta.main)compare(Bun.argv[2]??'').catch(e=>{console.error(String(e));process.exitCode=1;});
