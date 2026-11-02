import type {OpenAiChatRequest,OpenAiChatResponse} from '../../ai/types.ts';
export type Chat=(request:OpenAiChatRequest)=>Promise<OpenAiChatResponse>;
export interface Category {id:string;parentId:string|null;name:string;enabled:boolean;isLeaf:boolean;pathIds:string[];pathNames:string[];categoryId:string|null}
export type Attribute=[key:string,name:string,type:'text'|'number'|'boolean'|'single'|'multi'|'date',requirement:'required'|'optional'|'conditional',unit:string,options:string[],condition:string,description:string,format:string,refs:string[]];
export interface Patch {upsert:Attribute[];remove:string[];done:boolean;gaps:string[]}
export interface Review {pass:boolean;issues:Array<{key:string;reason:string}>;gaps:string[]}
export interface Evidence {id:string;kind:'jd'|'web';title:string;url:string;sku?:string;retrievedAt:string;fields:Array<[ref:string,name:string,value:string,source?:string]>;scope:string}
export interface Outcome {category:Category;status:'accepted'|'needs_review'|'failed';attributes:Attribute[];evidence:Evidence[];review?:Review;gaps:string[];error?:string;rounds:number;fingerprint:string}
