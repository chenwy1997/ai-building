import {hash} from '../runtime/store.ts';
import {obj,arr,str,valueSchema} from './contracts.ts';

// Execution dependencies, not new attribute definitions. Keep conditions and quantities together.
const families=[
 ['mixed_pack','pack_components','sheets_per_pack','total_packs','packs_per_bundle','full_case_sale',
  'pieces_per_pack','packs_per_sales_unit','total_pieces_sales_unit','package_form','independent_packaging'],
 ['single_piece_width','single_piece_length'],
 ['length_mm','width_mm','height_mm'],
];
export const patchSchema=obj({productId:str(),baseHash:str(),values:arr(valueSchema)});
export function repairTargets(card:any,errors:string[],findings:any[]){
 const ids:string[]=card.attributes.map((a:any)=>a.id),targets=new Set<string>(),unscoped:string[]=[];
 for(const f of findings){
  if(ids.includes(f.attributeId))targets.add(f.attributeId);
  else unscoped.push('review: '+JSON.stringify(f));
 }
 for(const e of errors){
  const id=ids.find(id=>e.startsWith(id+':'));
  if(id)targets.add(id);else unscoped.push(e);
 }
 if(unscoped.length)throw Error('manual review required: '+unscoped.join(';'));
 let changed=true;
 while(changed){
  const before=targets.size;
  for(const family of families)if(family.some(id=>targets.has(id)))for(const id of family)if(ids.includes(id))targets.add(id);
  for(const r of card.rules??[]){
   const referenced=(r.inputs??[]).map((x:any)=>x.attributeId).filter((x:any)=>ids.includes(x));
   if(referenced.some((id:string)=>targets.has(id)))targets.add(r.attributeId);
  }
  changed=targets.size!==before;
 }
 return ids.filter(id=>targets.has(id));
}
export function patchInput(productId:string,card:any,base:any,evidence:any[],targets:string[],extra:any={}){
 return {
  card:{...card,provenance:undefined},
  task:'只返回targetAttributeIds所列字段（含受影响依赖），每项恰好一次；其他字段不得输出。复核意见也可能有误，证据不支持的建议不要盲从，保留原值并在explanation说明。缺证留空，引用当前商品逐字证据。计算与条件关联字段已纳入目标。数值value为纯数字字符串，是否value只能为字符串true或false；filled的reasonCode必须为none。回传productId和baseHash原值，不修改商品类目或属性卡。',
  ...extra,productId,categoryId:card.categoryId,baseHash:hash(base),targetAttributeIds:targets,
  previousValues:base.values.filter((v:any)=>targets.includes(v.attributeId)),evidence,
 };
}
export function mergePatch(base:any,patch:any,targets:string[]){
 if(patch.productId!==base.productId||patch.baseHash!==hash(base))throw Error('stale patch or wrong product');
 if(new Set(targets).size!==targets.length||targets.some(id=>!base.values.some((v:any)=>v.attributeId===id)))throw Error('invalid patch targets');
 const received=patch.values.map((v:any)=>v.attributeId);
 if(received.length!==targets.length||new Set(received).size!==targets.length||received.some((id:string)=>!targets.includes(id)))throw Error('patch scope mismatch');
 const replacements=new Map(patch.values.map((v:any)=>[v.attributeId,v]));
 return {...base,values:base.values.map((v:any)=>replacements.get(v.attributeId)??v)};
}
