import {join} from 'node:path';
import {exists,hash,read,save,Ledger,tokenCost} from '../runtime/store.ts';
import {validate,type Schema} from '../domain/meta.ts';
import {parseOutput,normalizeModelKnowledgeQuotes} from '../domain/normalize.ts';
import {fixedPrefixInput,layeredPrefixInput} from './prefix.ts';
const ORIGIN='https://api.deepseek.com';
/** REST only. No provider fallback and no credentials in persisted request bodies. */
export class DeepSeek{
 ledger:Ledger;
 inflight=new Map<string,Promise<any>>();
 stoppedReason:string|null=null;
 constructor(public run:string,public instructions:string,limit=50){
  this.ledger=new Ledger(run,limit);
  for(const k of ['NO_PROXY','no_proxy'])process.env[k]=[process.env[k],'api.deepseek.com'].filter(Boolean).join(',');
 }
 async init(){if(!process.env.DEEPSEEK_API_KEY)throw new Error('DEEPSEEK_API_KEY missing');await this.ledger.init();}
 async balance(){
  const r=await fetch(ORIGIN+'/user/balance',{headers:{Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY},signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!r.ok)throw new Error('balance HTTP '+r.status);
  const b:any=await r.json();await save(join(this.run,'balance-latest.json'),b);
  if(b.is_available===false)throw new Error('DeepSeek balance unavailable');return b;
 }
 request(path:string,body:any,kind:string):Promise<any>{
  const key=hash({path,body});
  const existing=this.inflight.get(key);if(existing)return existing;
  const pending=this.perform(path,body,kind).finally(()=>this.inflight.delete(key));this.inflight.set(key,pending);return pending;
 }
 private async perform(path:string,body:any,kind:string){
  const id=hash({path,body}),folder=join(this.run,'calls',id),result=join(folder,'response.json');
  if(await exists(result))return read(result);
  if(this.stoppedReason)throw new Error(this.stoppedReason);
  const attempts=2;
  for(let attempt=0;attempt<attempts;attempt++){
   const attemptId=id+'-'+attempt,receipt=join(folder,`attempt-${attempt}.json`);
   if(await exists(receipt)){
    const old=await read(receipt);if(old.retryable)continue;
    throw new Error(`unresolved or failed request ${id}; inspect receipt, do not repeat`);
   }
   const reserve=kind==='responses'?(Buffer.byteLength(JSON.stringify(body))+4096)*2/1e6+body.max_output_tokens*8/1e6:.005;
   await this.ledger.reserve(attemptId,kind,reserve);
   await save(join(folder,'request.json'),{path,body});
   await save(receipt,{status:'inflight',attemptId});
   let response:Response;
   try{
    response=await fetch(ORIGIN+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY},body:JSON.stringify(body),signal:AbortSignal.timeout(240000),redirect:'error'});
   }catch{
    await this.ledger.finish(attemptId,'unknown',null);
    await save(receipt,{status:'unknown',retryable:false});
    throw new Error(`network outcome unknown ${id}; reservation retained`);
   }
   let raw:any;
   try{raw=await response.json();}catch{
    await this.ledger.finish(attemptId,'unknown',null,undefined,response.status);
    await save(receipt,{status:'unparseable',retryable:false});throw new Error(`unparseable response ${id}`);
   }
   await save(join(folder,`raw-${attempt}.json`),raw);
   if(!response.ok){
    if(response.status===402||response.status===401)this.stoppedReason=`provider stopped: HTTP ${response.status}`;
    const retryable=[429,500,502,503,504].includes(response.status);
    // Errors do not prove the server did no work. Retain the reservation conservatively.
    await this.ledger.finish(attemptId,'http_error',null,undefined,response.status);
    await save(receipt,{status:'http_error',httpStatus:response.status,retryable});
    if(retryable&&attempt+1<attempts){await Bun.sleep(2000*(attempt+1));continue;}
    throw new Error(`DeepSeek ${kind} HTTP ${response.status}; response stored ${id}`);
   }
   const cost=kind==='responses'?tokenCost(raw.usage):.005;
   await this.ledger.finish(attemptId,'received',cost,raw.usage,response.status);
   await save(result,raw);await save(receipt,{status:'received',retryable:false});return raw;
  }
  throw new Error('retry limit reached '+id);
 }
 async generate(stage:string,input:any,schema:Schema,maxTokens=14000,effort:'low'|'none'='none',options:{layout?:'legacy'|'fixed-prefix'|'layered';reuseLegacy?:boolean}={}){
  const legacy={model:'deepseek-flash',instructions:this.instructions,input:JSON.stringify({stage,...input}),reasoning:{effort},max_output_tokens:maxTokens,
   text:{format:{type:'json_schema',name:'governance_'+stage.replace(/[^a-z0-9_]/gi,'_'),schema}}};
  const prefix=options.layout==='layered'?layeredPrefixInput(stage,input):fixedPrefixInput(stage,input);
  let body={...legacy,input:options.layout==='legacy'?legacy.input:prefix.text};
  // Layout optimization must not repay completed or unresolved historical requests.
  const legacyFolder=join(this.run,'calls',hash({path:'/responses',body:legacy}));
  if(options.reuseLegacy!==false){
   const v1={...legacy,input:fixedPrefixInput(stage,input).text},v1Folder=join(this.run,'calls',hash({path:'/responses',body:v1}));
   if(await exists(join(legacyFolder,'response.json'))||await exists(join(legacyFolder,'attempt-0.json')))body=legacy;
   else if(await exists(join(v1Folder,'response.json'))||await exists(join(v1Folder,'attempt-0.json')))body=v1;
  }
  await save(join(this.run,'calls',hash({path:'/responses',body}),'layout.json'),{
   version:body.input===legacy.input?'legacy':body.input===fixedPrefixInput(stage,input).text?'fixed-prefix-v1':'layered-v2',
   prefixHash:prefix.prefixHash,prefixCharacters:prefix.prefixCharacters,
  });
  let raw=await this.request('/responses',body,'responses');
  let effectiveBody=body;
  if(effort!=='none'&&raw.status==='incomplete'&&raw.incomplete_details?.reason==='max_output_tokens'){
   // One explicit recovery for a known incomplete response. No retry of successful stages.
   effectiveBody={...body,reasoning:{effort:'none'}};
   const recovered=await this.request('/responses',effectiveBody,'responses');
   await save(join(this.run,'calls',hash({path:'/responses',body:effectiveBody}),'recovery.json'),{
    originalCallHash:hash({path:'/responses',body}),reason:'reasoning consumed output budget; one non-thinking recovery',stage,
   });
   raw=recovered;
  }
  if(raw.status!=='completed')throw new Error(`response not completed: ${raw.status}`);
  if(raw.output?.some((x:any)=>x.type==='function_call'||x.type==='web_search_call'))throw new Error('unexpected tool execution');
  const text=(raw.output??[]).filter((x:any)=>x.type==='message').flatMap((x:any)=>x.content??[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('');
  let parsed:any;
  try{
   const normalized=parseOutput(text);parsed=normalized.value;
   if(normalized.repairs)await save(join(this.run,'calls',hash({path:'/responses',body:effectiveBody}),'normalization.json'),{
    rawTextHash:hash(text),parsedHash:hash(parsed),rule:'remove dangling empty property token outside strings',repairs:normalized.repairs,
   });
  }catch{throw new Error('response is not valid JSON; no safe repair');}
  // Some structured responses echo JSON Schema's root marker. It is metadata,
  // not a business field. Remove only this exact marker, preserve all other keys.
  if(schema.type==='object'&&!schema.properties?.type&&parsed?.type==='object'){
   const before=hash(parsed);delete parsed.type;
   await save(join(this.run,'calls',hash({path:'/responses',body:effectiveBody}),'root-marker-normalization.json'),{
    inputHash:before,parsedHash:hash(parsed),rule:'remove undeclared root type=object schema marker only',stage,
   });
  }
  const claims=normalizeModelKnowledgeQuotes(parsed);
  if(claims.changes.length){
   await save(join(this.run,'calls',hash({path:'/responses',body:effectiveBody}),'model-claim-normalization.json'),{
    originalHash:hash(parsed),normalizedHash:hash(claims.value),changes:claims.changes,
    rule:'model-knowledge remains an unverified model proposal, never an external quote'});
   parsed=claims.value;
  }
  if(schema.properties?.dimensions?.items?.properties?.candidates&&Array.isArray(parsed?.dimensions)){
   const empty=parsed.dimensions.filter((d:any)=>Array.isArray(d.candidates)&&d.candidates.length===0);
   if(empty.length){
    await save(join(this.run,'calls',hash({path:'/responses',body:effectiveBody}),'empty-outline-groups.json'),{
     originalHash:hash(parsed),removed:empty,rule:'omit empty candidate groups; public definitions remain in shared context; no attribute is added or deleted'});
    parsed={...parsed,dimensions:parsed.dimensions.filter((d:any)=>!Array.isArray(d.candidates)||d.candidates.length>0)};
   }
  }
  const errors=validate(schema,parsed);if(errors.length)throw new Error('schema: '+errors.slice(0,8).join(';'));
  return {value:parsed,responseModel:raw.model,callHash:hash({path:'/responses',body:effectiveBody}),responseId:raw.id};
 }
 search(query:string){return this.request('/v1/tools/search',{query,count:3,need_content:true},'search');}
 fetch(url:string){
  const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(u.hostname))throw new Error('invalid public source URL');
  return this.request('/v1/tools/fetch',{url},'fetch');
 }
}
