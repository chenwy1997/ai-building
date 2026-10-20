import {descendants} from '../tools/catalog.ts';
import {pool} from './store.ts';
import type {Category} from '../domain/meta.ts';
export function selectLeaves(nodes:Category[],ids:string[]){
 if(!ids.length||ids.some(x=>!x.trim()))throw Error('category IDs required');
 const selected=new Map<string,Category>();
 for(const id of new Set(ids))for(const n of descendants(nodes,id))if(n.isLeaf)selected.set(n.id,n);
 if(!selected.size)throw Error('no leaf categories');
 return [...selected.values()].sort((a,b)=>a.path.localeCompare(b.path,'zh-CN')||a.id.localeCompare(b.id));
}
export function concurrencyValue(raw:string){
 const n=Number(raw);if(!Number.isInteger(n)||n<1||n>128)throw Error('concurrency must be 1..128');return n;
}
/** Global queue, two real pending warmups per shared context. Never repeat done work. */
export async function warmedPool<T>(items:T[],done:(x:T)=>Promise<boolean>,work:(x:T)=>Promise<void>,concurrency:number){
 concurrencyValue(String(concurrency));
 const pending:T[]=[];for(const x of items)if(!await done(x))pending.push(x);
 const errors:any[]=[];
 for(const x of pending.slice(0,2)){try{await work(x);}catch(e:any){errors.push({item:x,error:e.message});if(/budget|unknown|provider stopped/.test(e.message))return{errors,skipped:items.length-pending.length};}}
 const r=await pool(pending.slice(2),work,{initial:concurrency,max:concurrency,auto:false});
 return {errors:[...errors,...r.errors],skipped:items.length-pending.length};
}
