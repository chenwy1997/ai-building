import {join} from 'node:path';
import {read,save,exists,hash} from '../runtime/store.ts';
import {DeepSeek} from '../providers/deepseek.ts';
import {TRIAL_RULES} from './contracts.ts';
export async function trialRuntime(run:string){
 const frozen=await read(join(run,'frozen.json')),categories=await read(join(run,'selected-categories.json'));
 const cards:any={};for(const c of categories)cards[c.id]=(await read(join(run,'categories',c.id,'result.json'))).card;
 const tree=await read(join(run,'tree-original.json'));
 const candidates=tree.nodes.filter((c:any)=>c.isLeaf&&(c.path.includes('清洁纸品')||c.path.includes('行政用品>厨具'))).map(({id,name,path}:any)=>({id,name,path}));
 const instructions='你是商品属性试填执行员，只返回规定JSON，不使用图片。'+TRIAL_RULES;
 const snapshot={version:'trial-text-r1',standardHash:frozen.standardHash,cardHashes:Object.fromEntries(Object.entries(cards).map(([id,c])=>[id,hash(c)])),instructions,candidates};
 const path=join(run,'trial/frozen.json');
 if(await exists(path)){if(hash(await read(path))!==hash(snapshot))throw Error('trial standard changed');}
 else{await save(path,snapshot);await save(join(run,'trial/ledger-before.json'),await read(join(run,'ledger.json')));}
 const client=new DeepSeek(run,instructions,50);await client.init();
 return {frozen,categories,cards,candidates,client,
  async call(file:string,stage:string,input:any,schema:any,tokens=8000){
   const path=join(run,'trial',file),inputHash=hash({instructions,input,schema});
   if(await exists(path)){const r=await read(path);if(r.inputHash!==inputHash)throw Error('trial cached input changed '+file);return r.value;}
   const r=await client.generate(stage,input,schema,tokens,'none');await save(path,{inputHash,...r});return r.value;
  }};
}
