import {join} from 'node:path';
import type {OpenAiChatRequest,OpenAiChatResponse} from '../../ai/types.ts';
import {hash,journal,read,optional,save} from './storage.ts';
import type {Chat} from './types.ts';
// Official Flash peak tariff checked 2026-09-15. Conservative even off-peak.
export const PRICE={hit:0.04,miss:2,output:8,source:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',checked:'2026-09-15'};
interface Entry {id:number;phase:string;category:string;requestHash:string;reserved:number;charged?:number;state:'pending'|'ok'|'unknown';usage?:OpenAiChatResponse['usage'];error?:string}
export class BudgetError extends Error{}
export class Meter {
 entries:Entry[]=[];queue=Promise.resolve();replies:Record<string,OpenAiChatResponse>={};localReplays=0;
 constructor(readonly directory:string,readonly limit:number,readonly chat:Chat){}
 async init(){this.entries=await optional<Entry[]>(join(this.directory,'usage.json'))??[];this.replies=await optional<Record<string,OpenAiChatResponse>>(join(this.directory,'responses.json'))??{};}
 used(){return this.entries.reduce((n,e)=>n+(e.charged??e.reserved),0);}
 async persist(){this.queue=this.queue.then(()=>save(join(this.directory,'usage.json'),this.entries));return this.queue;}
 async request(req:OpenAiChatRequest,category:string,phase:string):Promise<OpenAiChatResponse>{
  const requestHash=hash(req);if(this.replies[requestHash]){this.localReplays++;return this.replies[requestHash]!;}
  // Byte count is a conservative tokenizer bound, plus message/tool framing allowance.
  const inputBound=Buffer.byteLength(JSON.stringify(req),'utf8')+4096+req.messages.length*64;
  const reserved=(inputBound*PRICE.miss+(req.max_tokens??2048)*PRICE.output)/1e6;
  if(this.used()+reserved>this.limit)throw new BudgetError(`预算不足，保守已占用${this.used().toFixed(4)}元，下一请求预留${reserved.toFixed(4)}元，上限${this.limit}元`);
  const entry:Entry={id:this.entries.length+1,phase,category,requestHash:hash(req),reserved,state:'pending'};this.entries.push(entry);await this.persist();
  await journal(join(this.directory,'trace.jsonl'),{event:'request',id:entry.id,category,phase,request:req});
  try{const result=await this.chat(req);entry.usage=result.usage;entry.state='ok';const u=result.usage;if(u?.prompt_tokens!==undefined&&u.completion_tokens!==undefined){const hit=Math.min(u.prompt_tokens,u.prompt_cache_hit_tokens??0),miss=u.prompt_tokens-hit;entry.charged=(hit*PRICE.hit+miss*PRICE.miss+u.completion_tokens*PRICE.output)/1e6;}this.replies[requestHash]=result;this.queue=this.queue.then(()=>save(join(this.directory,'responses.json'),this.replies));await this.persist();await journal(join(this.directory,'trace.jsonl'),{event:'response',id:entry.id,category,phase,response:result});return result;}
  catch(e){entry.state='unknown';entry.error=e instanceof Error?e.message:String(e);await this.persist();await journal(join(this.directory,'trace.jsonl'),{event:'request_error',id:entry.id,category,phase,error:entry.error});throw e;}
 }
 summary(){const sum=(key:'prompt_tokens'|'completion_tokens'|'prompt_cache_hit_tokens'|'prompt_cache_miss_tokens')=>this.entries.reduce((n,e)=>n+(e.usage?.[key]??0),0);const input=sum('prompt_tokens'),hit=sum('prompt_cache_hit_tokens');return{localReplays:this.localReplays,requests:this.entries.length,input,output:sum('completion_tokens'),hit,miss:sum('prompt_cache_miss_tokens'),hitRate:input?hit/input:0,reasoning:this.entries.reduce((n,e)=>n+(e.usage?.completion_tokens_details?.reasoning_tokens??0),0),conservativeCny:this.used(),budgetCny:this.limit,unknownChargedRequests:this.entries.filter(e=>e.charged===undefined).length,price:PRICE};}
}
