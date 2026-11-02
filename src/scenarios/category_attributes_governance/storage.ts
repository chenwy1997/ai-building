import {createHash} from 'node:crypto';
import {mkdir,rename,appendFile,open,unlink} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
export const ROOT=resolve(import.meta.dir,'workspace');
export const hash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
export const read=async<T>(path:string):Promise<T>=>JSON.parse(await Bun.file(path).text());
export async function optional<T>(path:string):Promise<T|undefined>{return await Bun.file(path).exists()?read<T>(path):undefined;}
export async function save(path:string,value:unknown){await mkdir(dirname(path),{recursive:true});const tmp=path+'.tmp-'+crypto.randomUUID();await Bun.write(tmp,JSON.stringify(value));await rename(tmp,path);}
export async function journal(path:string,value:unknown){await mkdir(dirname(path),{recursive:true});await appendFile(path,JSON.stringify(value)+'\n');}
export async function locked<T>(directory:string,fn:()=>Promise<T>):Promise<T>{await mkdir(directory,{recursive:true});const p=join(directory,'.lock');const f=await open(p,'wx').catch(()=>{throw new Error('运行目录已被占用；确认原进程停止后方可移除 .lock');});try{await f.writeFile(String(process.pid));return await fn();}finally{await f.close();await unlink(p);}}
