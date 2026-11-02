import {join} from 'node:path';
import {ROOT,save} from './storage.ts';
import {Meter} from './meter.ts';
import {deepseekRuntime} from '../../ai/deepseek-runtime.ts';
import {BASE} from './staged.ts';
import {GROUNDING_TASK} from './grounding.ts';
import {RESOLUTION_TASK,parseResolution} from './review-resolution.ts';
import type {Audit} from './staged.ts';

// Synthetic contrast cases. Expectations are used after inference, never sent to the model.
const cases=[
 {id:'a',attribute:'附带配件名称',source:{field:'包装清单',value:'*1'},expected:false},
 {id:'b',attribute:'配件外形尺寸',source:{field:'尺寸',value:'五根线，两只装'},expected:false},
 {id:'c',attribute:'配件适配整机品牌',source:{field:'配件商品品牌',value:'甲品牌'},expected:false},
 {id:'d',attribute:'附带配件名称',source:{field:'包装清单',value:'主机一台，喷嘴两个，刮刀一把'},expected:true},
 {id:'e',attribute:'配件外形尺寸',source:{field:'规格',value:'长度80mm，外径12mm'},expected:true},
];
export async function regression(){
 const directory=join(ROOT,'output','run-'+new Date().toISOString().replace(/[:.]/g,'-')+'-regression'),runtime=await deepseekRuntime(true),meter=new Meter(directory,0.08,runtime.chat);await meter.init();
 const ask=async(task:string,input:unknown)=>{const r=await meter.request({model:runtime.model,messages:[{role:'system',content:BASE},{role:'user',content:JSON.stringify({task,input})}],thinking:{type:'disabled'},response_format:{type:'json_object'},temperature:0,max_tokens:1600},'regression','contrast');if(r.usage?.completion_tokens_details?.reasoning_tokens||r.choices[0]?.finish_reason==='length')throw new Error('思考或截断');return JSON.parse(r.choices[0]?.message.content??'');};
 const supports=await ask(GROUNDING_TASK+'本次每个case只判断自身提供的唯一source，不跨case引用。输出 {cases:[{id,supported:boolean,reason:string}]}。supported表示该内容直接体现指定属性维度；不是填写SKU值。',cases.map(({expected,...c})=>c));
 if(!Array.isArray(supports.cases)||supports.cases.length!==cases.length||new Set(supports.cases.map((x:{id:string})=>x.id)).size!==cases.length)throw new Error('证据回归响应缺项/重复');
 const checks=cases.map(c=>{const a=supports.cases.find((x:{id:string})=>x.id===c.id);return{id:c.id,attribute:c.attribute,pass:typeof a?.supported==='boolean'&&a.supported===c.expected,expected:c.expected,actual:a};});
 const attrs=[['range','温度范围','text','required','℃',[],'','允许温度区间','如100-200℃',['K']],['accessories','附件清单','text','optional','',[],'','已知无附件填无；未知留空','',['K']],['length','长度','number','required','mm',[],'','单值长度','数值必须以in为单位',['K']]];
 const audit:Audit={checkedKeys:['range','accessories','length'],issues:[{key:'range',field:'format',quote:'如100-200℃',reason:'单位列与示例都有℃，会自动追加成℃℃'},{key:'accessories',field:'description',quote:'未知留空',reason:'选填可以留空，不能同时允许填无'},{key:'length',field:'format',quote:'数值必须以in为单位',reason:'单位列固定mm，格式强制in，对同一数值单位定义矛盾'}],knowledgeGaps:[]};
 const resolved=parseResolution(await ask(RESOLUTION_TASK,{attributes:attrs,legend:'[key,name,type,requirement,unit,options,condition,description,format,refs]',issues:audit.issues}),audit);
 const auditChecks=resolved.decisions.map(d=>({...d,expected:d.issue===2?'confirmed':'dismissed',pass:d.verdict===(d.issue===2?'confirmed':'dismissed')}));
 const result={kind:'synthetic-contrast-regression',checks,auditChecks,pass:checks.every(c=>c.pass)&&auditChecks.every(c=>c.pass),usage:meter.summary(),note:'仅验证这8个对照，不代表全部行业属性合格'};
 await save(join(directory,'regression.json'),result);console.log(JSON.stringify({...result,directory}));
}
if(import.meta.main)regression().catch(e=>{console.error(String(e));process.exitCode=1;});
