import {join} from 'node:path';
import {callModel,parseObject,type ModelConfig} from '../adapters/models.ts';
import {read,save,digest} from '../runtime/storage.ts';
import {removeExtraClosers,lastAssistantText} from '../batch/model-json.ts';
import {RUN} from './settings.ts';
import {parseOpenCodeGoResponse} from '../adapters/opencode-go.ts';
import {parseCommandCodeResponse} from '../adapters/commandcode.ts';

export async function invoke(stage:string,model:ModelConfig,payload:any,valid:(v:any)=>boolean,runRoot=RUN){
 const r:any=await callModel(runRoot,stage,model,payload);
 let content=r.content,recovery:any=null;
 if(r.status!=='completed'){
  const rawPath=join(runRoot,'models',stage+'-'+model.id+(model.adapter==='kimi_cli'?'.raw.jsonl':'.raw.json'));
  if(await Bun.file(rawPath).exists())try{
   let raw:string|undefined;
   if(model.adapter==='kimi_cli')raw=lastAssistantText(await Bun.file(rawPath).text());
   else {const x:any=await read(rawPath);if(model.adapter==='opencode_go')raw=parseOpenCodeGoResponse(model.model,x).text;else if(model.adapter==='commandcode')raw=parseCommandCodeResponse(model.model,x).text;else if(x.choices?.[0]?.finish_reason==='stop')raw=x.choices[0].message.content;}
   if(raw){try{content=parseObject(raw);recovery={method:'原始响应JSON重新解析；未改内容'};}catch{const x=removeExtraClosers(raw);content=parseObject(x.text);recovery={method:'仅删除字符串外多余结束括号',removed:x.removed};}}
  }catch{/* Original failure is retained; unknown/truncated output is not invented. */}
 }
 if(content&&valid(content)){
  const normalized={model:model.id,stage,sourceRecord:'models/'+stage+'-'+model.id+'.json',originalStatus:r.status,requestHash:r.requestHash,syntaxRecovery:recovery,content};
  await save(join(runRoot,'normalized',stage+'-'+model.id+'.json'),normalized);
  console.log(stage,model.id,recovery?'syntax-recovered':r.status,digest(content).slice(0,10));
  return normalized;
 }
 console.log(stage,model.id,'failed',r.error??'response-schema-or-coverage');
 return null;
}
export const covers=(keys:string[])=>(v:any)=>Array.isArray(v?.products)&&v.products.length===keys.length&&new Set(v.products.map((p:any)=>p.key)).size===keys.length&&keys.every(k=>v.products.some((p:any)=>p.key===k));
