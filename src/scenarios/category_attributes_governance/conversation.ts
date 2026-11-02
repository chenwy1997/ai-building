import type {OpenAiMessage} from '../../ai/types.ts';

/** Append exact assistant text: reserializing parsed JSON would break the cached prefix. */
export class ProducerConversation {
 private history:OpenAiMessage[];
 constructor(system:string,context:unknown){this.history=[{role:'system',content:system},{role:'user',content:JSON.stringify(context)}];}
 request(task:string,delta:unknown):OpenAiMessage[]{return [...structuredClone(this.history),{role:'user',content:JSON.stringify({task,data:delta})}];}
 commit(sent:OpenAiMessage[],assistantText:string){this.history=[...structuredClone(sent),{role:'assistant',content:assistantText}];}
 snapshot(){return structuredClone(this.history);}
}
export type GenerationMode='independent'|'conversation';
