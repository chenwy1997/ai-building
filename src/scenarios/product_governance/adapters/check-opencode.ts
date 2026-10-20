import {join,resolve} from 'node:path';
import {OPENCODE_MODELS} from './opencode-models.ts';
import {callModel} from './models.ts';
import {save} from '../runtime/storage.ts';
const out=resolve(process.argv[2]??'outputs/product-governance/opencode-integration-20261019');
const selected=process.argv[3]?OPENCODE_MODELS.filter(m=>m.id===process.argv[3]):OPENCODE_MODELS;
const stage=process.argv[4]??'connectivity-v4';
if(!selected.length)throw new Error('可选模型：glm / qwen');
const payload={task:'连接与商品属性JSON验证。仅用下列合成测试文字，品牌不要臆测；数量是每包片数，不乘层数。',cases:[{id:'A',text:'清洁棉柔巾，4包共200片，每片3层，同规格。'},{id:'B',text:'清洁棉柔巾，材质和数量均未写明。'}],output:{cases:[{id:'A',brand:null,piecesPerPack:50,formula:'200/4=50'},{id:'B',brand:null,piecesPerPack:null,formula:null}]}};
const results=await Promise.all(selected.map(async m=>{
 const r=await callModel(out,stage,{...m,maxOutputTokens:4000,maxCalls:5},payload),c:any=r.content;
 const a=c?.cases?.find((x:any)=>x.id==='A'),b=c?.cases?.find((x:any)=>x.id==='B');
 const passed=r.status==='completed'&&a?.piecesPerPack===50&&a.brand===null&&b?.piecesPerPack===null&&b.brand===null;
 return {model:m.id,requestedModel:m.model,responseModel:r.responseModel??null,status:r.status,passed,usage:r.usage??null,error:r.error??null,record:`models/${stage}-${m.id}.json`};
}));
await save(join(out,`connectivity-${process.argv[3]??'all'}.json`),{checkedAt:new Date().toISOString(),subscriptionRoute:'OpenCode Go',results});
console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.passed))process.exitCode=1;
