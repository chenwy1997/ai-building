import {join,resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {ROOT,hash,read,save} from './storage.ts';
import type {Category} from './types.ts';
export const SOURCE=resolve(import.meta.dir,'../category_governance/workspace/context/v1/category-tree.json');
type Tree=[id:string,name:string,enabled:boolean,leaf:boolean,categoryId:string|null,children:Tree[]];
interface TextTree {v:'CAT1';ancestors:Array<[string,string]>;tree:Tree[]}
/** Lossless for the identity, hierarchy and flags used by governance. Raw payload stays in the gz snapshot. */
export function toStdText(nodes:Category[],ancestors:Array<[string,string]>=[]):string{
 const ids=new Set(nodes.map(n=>n.id)),children=new Map<string,Category[]>();
 if(ids.size!==nodes.length)throw new Error('类目ID重复');
 for(const n of nodes){const p=n.parentId??'';children.set(p,[...(children.get(p)??[]),n]);}
 const ordered=(list:Category[])=>[...list].sort((a,b)=>a.id.localeCompare(b.id));
 const visit=(n:Category):Tree=>[n.id,n.name,n.enabled,n.isLeaf,n.categoryId,ordered(children.get(n.id)??[]).map(visit)];
 const roots=ordered(nodes.filter(n=>!n.parentId||!ids.has(n.parentId)));
 const result:TextTree={v:'CAT1',ancestors,tree:roots.map(visit)};
 const encoded=JSON.stringify(result);if(fromStdText(encoded).length!==nodes.length)throw new Error('类目树存在环或不可达节点');return encoded;
}
export function fromStdText(text:string):Category[]{
 const d=JSON.parse(text) as TextTree;if(d.v!=='CAT1')throw new Error('未知类目协议');const nodes:Category[]=[];
 const walk=(t:Tree,parents:Array<[string,string]>)=>{const path=[...parents,[t[0],t[1]] as [string,string]];nodes.push({id:t[0],name:t[1],enabled:t[2],isLeaf:t[3],categoryId:t[4],parentId:parents.at(-1)?.[0]??null,pathIds:path.map(x=>x[0]),pathNames:path.map(x=>x[1])});for(const child of t[5])walk(child,path);};
 for(const root of d.tree)walk(root,d.ancestors);return nodes;
}
export const PILOT=['充电式热风枪','插电式热风枪','充电式电钻','六角套筒','防爆六角套筒','热风枪发热芯'];
export async function prepare(category='五金工具',source=SOURCE){
 const raw=await Bun.file(source).text(),doc=JSON.parse(raw) as {nodes:Category[]};
 const roots=doc.nodes.filter(n=>n.enabled&&(n.id===category||n.name===category||n.pathNames.slice(1).join('/')===category));
 if(roots.length!==1)throw new Error(`范围选择必须唯一，命中${roots.length}个：${category}`);
 const root=roots[0]!,nodes=doc.nodes.filter(n=>n.pathIds.includes(root.id));
 const ancestors=root.pathIds.slice(0,-1).map((id,i)=>[id,root.pathNames[i]!] as [string,string]);
 const text=toStdText(nodes,ancestors),sourceHash=hash(raw),contextHash=hash(text),dir=join(ROOT,'context',contextHash.slice(0,16));
 await save(join(dir,'manifest.json'),{source:resolve(source),sourceHash,contextHash,root,leaves:nodes.filter(n=>n.isLeaf&&n.enabled).length,protocol:'CAT1',rawPayload:'category-source.json.gz'});
 await Bun.write(join(dir,'category-source.json.gz'),gzipSync(raw));await Bun.write(join(dir,'categories.std.txt'),text);
 const leaves=nodes.filter(n=>n.enabled&&n.isLeaf).sort((a,b)=>a.pathIds.join('/').localeCompare(b.pathIds.join('/')));
 const branch=(leaf:Category)=>{const id=leaf.pathIds[Math.max(root.pathIds.length-1,leaf.pathIds.length-2)]!;const r=nodes.find(n=>n.id===id)!;return toStdText(nodes.filter(n=>n.pathIds.includes(id)),r.pathIds.slice(0,-1).map((p,i)=>[p,r.pathNames[i]!]));};
 return {root,nodes,leaves,text,contextHash,dir,branch};
}
