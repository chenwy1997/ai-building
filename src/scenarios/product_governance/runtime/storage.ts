import {createHash} from 'node:crypto';
import {mkdir,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
export const stable=(x:unknown):string=>x!==null&&typeof x==='object'
  ?Array.isArray(x)?`[${x.map(stable).join(',')}]`:`{${Object.entries(x).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  :JSON.stringify(x)??'null';
export const digest=(x:unknown)=>createHash('sha256').update(stable(x)).digest('hex');
export async function save(path:string,value:unknown){await mkdir(dirname(path),{recursive:true});const temp=path+'.tmp-'+crypto.randomUUID();await Bun.write(temp,JSON.stringify(value,null,2)+'\n');await rename(temp,path);}
export const read=<T>(path:string)=>Bun.file(path).json() as Promise<T>;
export async function append(path:string,event:unknown){await mkdir(dirname(path),{recursive:true});const {appendFile}=await import('node:fs/promises');await appendFile(path,JSON.stringify({...event as object,at:new Date().toISOString()})+'\n');}
