import {createHash} from 'node:crypto';
import {mkdir,rename,readFile,writeFile,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
export function canonical(x:any):string{
 if(x===null||typeof x!=='object')return JSON.stringify(x);
 if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';
 return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
}
export const hash=(x:any)=>createHash('sha256').update(typeof x==='string'?x:canonical(x)).digest('hex');
export const now=()=>new Date().toISOString();
export async function read<T=any>(p:string):Promise<T>{return JSON.parse(await readFile(p,'utf8'));}
export async function exists(p:string){return Bun.file(p).exists();}
export async function save(p:string,x:any){await mkdir(dirname(p),{recursive:true});const tmp=p+'.'+crypto.randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(x,null,2));await rename(tmp,p);}
export async function lock<T>(p:string,fn:()=>Promise<T>):Promise<T>{
 await mkdir(dirname(p),{recursive:true});let acquired=false;
 for(let i=0;i<300;i++){try{await mkdir(p);acquired=true;break;}catch(e:any){if(e.code!=='EEXIST')throw e;await Bun.sleep(20);}}
 if(!acquired)throw new Error('lock busy; inspect active run before retry');
 try{return await fn();}finally{await rm(p,{recursive:true});}
}
type Entry={id:string;kind:string;reserved:number;charged:number|null;status:string;startedAt:string;finishedAt?:string;usage?:any;durationMs?:number;httpStatus?:number};
export class Ledger{
 constructor(public dir:string,public limit=50){}
 get path(){return join(this.dir,'ledger.json');}
 async init(){await lock(this.path+'.lock',async()=>{
  if(await exists(this.path)){if((await read(this.path)).limit!==this.limit)throw new Error('budget changed; explicit budget revision required');}
  else await save(this.path,{version:1,limit:this.limit,currency:'CNY',pricing:'2026-10-20 peak upper estimate; not invoice',entries:[]});
 });}
 async reserve(id:string,kind:string,amount:number){
  return lock(this.path+'.lock',async()=>{
   const l=await read(this.path);
   if(l.entries.some((e:Entry)=>e.id===id))throw new Error('request already reserved; no automatic duplicate');
   const used=l.entries.reduce((s:number,e:Entry)=>s+(e.charged??e.reserved),0);
   if(!Number.isFinite(amount)||amount<0||used+amount>l.limit)throw new Error('budget exhausted');
   l.entries.push({id,kind,reserved:amount,charged:null,status:'inflight',startedAt:now()});await save(this.path,l);
  });
 }
 async finish(id:string,status:string,charged:number|null,usage?:any,httpStatus?:number){
  await lock(this.path+'.lock',async()=>{
   const l=await read(this.path),e=l.entries.find((e:Entry)=>e.id===id);
   if(!e)throw new Error('missing reservation');
   if(charged!==null&&(!Number.isFinite(charged)||charged<0))throw new Error('invalid cost');
   Object.assign(e,{status,charged,usage:usage??null,httpStatus:httpStatus??null,finishedAt:now(),durationMs:Date.now()-Date.parse(e.startedAt)});
   await save(this.path,l);
  });
 }
 async status(){const l=await read(this.path);return {...l,committed:l.entries.reduce((s:number,e:Entry)=>s+(e.charged??e.reserved),0)};}
}
export function tokenCost(u:any):number|null{
 const input=u?.input_tokens??u?.prompt_tokens,output=u?.output_tokens??u?.completion_tokens;
 const hit=u?.input_tokens_details?.cached_tokens??u?.prompt_cache_hit_tokens??0;
 if(!Number.isFinite(input)||!Number.isFinite(output)||!Number.isFinite(hit)||hit<0||hit>input)return null;
 return ((input-hit)*2+hit*.04+output*8)/1e6;
}
export async function pool<T>(items:T[],fn:(x:T)=>Promise<void>,options:{initial:number;max:number;auto:boolean}){
 let cursor=0,active=0,cap=options.initial,success=0;const errors:any[]=[];
 await new Promise<void>(resolve=>{
  const launch=()=>{
   if(cursor===items.length&&active===0){resolve();return;}
   while(cursor<items.length&&active<cap){
    const item=items[cursor++]!;active++;
    fn(item).then(()=>{if(options.auto&&++success%8===0)cap=Math.min(options.max,cap*2);}).catch(e=>{
     errors.push({item,error:String(e.message??e)});if(options.auto)cap=Math.max(1,Math.floor(cap/2));
    }).finally(()=>{active--;launch();});
   }
  };launch();
 });
 return {errors,finalConcurrency:cap};
}
