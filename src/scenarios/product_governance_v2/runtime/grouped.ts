import {pool} from './store.ts';

/** Two useful cold tasks per category, then bounded concurrency. Cached work never warms the server. */
export async function groupedPending<T>(items:T[],key:(x:T)=>string,done:(x:T)=>Promise<boolean>,
 work:(x:T)=>Promise<void>,concurrency=8){
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>64)throw Error('concurrency must be 1..64');
 const groups=new Map<string,T[]>();let skipped=0;const errors:any[]=[];
 for(const x of items){
  if(await done(x)){skipped++;continue;}
  const k=key(x);if(!groups.has(k))groups.set(k,[]);groups.get(k)!.push(x);
 }
 for(const group of groups.values()){
  for(const x of group.slice(0,2)){
   try{await work(x);}catch(e:any){errors.push({item:x,error:String(e.message??e)});}
  }
  const result=await pool(group.slice(2),work,{initial:concurrency,max:concurrency,auto:false});
  errors.push(...result.errors);
 }
 return {errors,skipped,pending:items.length-skipped,concurrency};
}
export function trialConcurrency(){
 const i=process.argv.indexOf('--concurrency');
 const n=i<0?8:Number(process.argv[i+1]);
 if(!Number.isInteger(n)||n<1||n>64)throw Error('--concurrency must be 1..64');
 return n;
}
