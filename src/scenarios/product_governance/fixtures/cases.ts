import type {BrandObservation,CaseInput,Evidence,Expectation,Observed,Quantity} from '../domain/types.ts';
import historicalSnapshot from './historical-products.json';
export const WET='433be34e-e1cc-4b5f-b955-df3d802ed2ec',BOX='1f96cac3-8498-4c32-936c-7a6a54b9320b';
export const BRAND='common.brand',COUNT='wet_wipes.pieces_per_pack';

export function syntheticCases():{cases:CaseInput[];expectations:Expectation[]}{
 const cases:CaseInput[]=[],expectations:Expectation[]=[];
 const make=(id:string,label:string,change:(c:CaseInput,obs:<T>(value:T,quote?:string)=>Observed<T>,q:(value:number,unit:string,scope?:string)=>Quantity)=>void,attributeId:string,status:Expectation['status'],value:Expectation['value'])=>{
  const evidence:Evidence[]=[];const productId='fixture:'+id;
  const obs=<T>(value:T,quote=String(value)):Observed<T>=>{const evidenceId=id+'-e'+(evidence.length+1);evidence.push({id:evidenceId,productId,kind:'fixture',text:quote,sourceRef:'合成规则案例/'+id});return{value,evidenceId,quote};};
  const q=(value:number,unit:string,scope='sale-unit')=>({...obs(value,`${value}${unit}；范围${scope}`),unit,scope});
  const c:CaseInput={id,label,kind:'synthetic',productId,categoryId:WET,categoryBasis:'合成案例指定上下文，不代表真实商品',evidence,brands:[{...obs('清风','商品品牌：清风'),describes:'self'}],direct:[q(50,'片/包','inner-pack')],totals:[],packs:[]};
  change(c,obs,q);cases.push(c);expectations.push({caseId:id,attributeId,status,value});
 };
 const calculation=(c:CaseInput,obs:<T>(value:T,quote?:string)=>Observed<T>,q:(v:number,u:string,s?:string)=>Quantity,total=200)=>{c.direct=[];c.totals=[q(total,'片')];c.packs=[q(4,'包')];c.homogeneous=obs(true,'4包均为相同规格');c.giftsExcluded=obs(true,'总片数不含赠品');};
 make('Q01','明确50片/包',()=>{},COUNT,'filled',50);
 make('Q02','200片共4个同规格包',calculation,COUNT,'filled',50);
 make('Q03','只有总片数', (c,o,q)=>{c.direct=[];c.totals=[q(200,'片')];},COUNT,'needs_evidence',null);
 make('Q04','混合大小包不能平均',(c,o,q)=>{calculation(c,o,q);c.homogeneous=o(false,'包含大小不同的内包装');},COUNT,'needs_evidence',null);
 make('Q05','赠品边界未明',(c,o,q)=>{calculation(c,o,q);delete c.giftsExcluded;},COUNT,'needs_evidence',null);
 make('Q06','201除4不能取整',(c,o,q)=>calculation(c,o,q,201),COUNT,'invalid',null);
 make('Q07','直接50与推导60冲突',(c,o,q)=>{calculation(c,o,q,240);c.direct=[q(50,'片/包','inner-pack')];},COUNT,'conflict',null);
 make('Q08','两个直接值冲突',(c,o,q)=>{c.direct.push(q(60,'片/包','inner-pack'));},COUNT,'conflict',null);
 make('Q09','80抽不能直接当80片',(c,o,q)=>{c.direct=[q(80,'抽/包','inner-pack')];},COUNT,'needs_evidence',null);
 make('Q10','零片数拒绝',(c,o,q)=>{c.direct=[q(0,'片/包','inner-pack')];},COUNT,'invalid',null);
 make('Q11','总量与包数销售范围不一致',(c,o,q)=>{calculation(c,o,q);c.packs=[q(4,'包','different-carton')];},COUNT,'needs_evidence',null);
 make('Q12','跨商品证据拒绝',c=>{c.evidence.find(e=>e.id===c.direct[0]!.evidenceId)!.productId='other-product';},COUNT,'invalid',null);
 make('Q13','伪造引用片段拒绝',c=>{c.direct[0]!.quote='不存在的片段';},COUNT,'invalid',null);
 make('Q14','直接与推导一致',(c,o,q)=>{calculation(c,o,q);c.direct=[q(50,'片/包','inner-pack')];},COUNT,'filled',50);
 make('Q15','纸巾盒不挂湿巾片数',c=>{c.categoryId=BOX;},COUNT,'not_applicable',null);
 make('Q16','引用50片却提供500片拒绝',c=>{c.direct[0]!.value=500;},COUNT,'invalid',null);
 make('Q17','直接值范围不是内包装',c=>{c.direct[0]!.scope='carton';},COUNT,'needs_evidence',null);
 make('Q18','字符串true不能当布尔前提',(c,o,q)=>{calculation(c,o,q);c.homogeneous!.value='true' as any;},COUNT,'invalid',null);
 make('B01','Vinda别名归一',(c,o)=>{c.brands=[{...o('Vinda','商品品牌Vinda'),describes:'self'}];},BRAND,'filled','维达');
 make('B02','适配品牌不能当自身品牌',(c,o)=>{c.categoryId=BOX;c.brands=[{...o('清风','适配清风分配器'),describes:'compatible'}];},BRAND,'needs_evidence',null);
 make('B03','供应商不能当品牌',(c,o)=>{c.brands=[{...o('维达','供应商：维达'),describes:'supplier'}];},BRAND,'needs_evidence',null);
 make('B04','国产不能当品牌',(c,o)=>{c.brands=[{...o('国产','品牌字段：国产'),describes:'self'}];},BRAND,'needs_evidence',null);
 make('B05','字典外品牌保留候选',(c,o)=>{c.brands=[{...o('示例新品牌','商品自身品牌：示例新品牌'),describes:'self'}];},BRAND,'enum_candidate','示例新品牌');
 make('B06','同SKU自身品牌冲突',(c,o)=>{c.brands.push({...o('维达','包装上的商品品牌：维达'),describes:'self'});},BRAND,'conflict',null);
 make('B07','缺品牌不自动无品牌',c=>{c.brands=[];},BRAND,'needs_evidence',null);
 make('B08','明确无品牌声明',(c,o)=>{c.brands=[];c.unbranded=o(true,'本商品无品牌');},BRAND,'filled','无品牌');
 make('B09','自身品牌与适配品牌分开',(c,o)=>{c.categoryId=BOX;c.brands.push({...o('维达','适配维达设备'),describes:'compatible'});},BRAND,'filled','清风');
 make('B10','引用清风却声明维达拒绝',c=>{c.brands[0]!.value='维达';},BRAND,'invalid',null);
 make('B11','无品牌声明与品牌相冲突',(c,o)=>{c.unbranded=o(true,'本商品无品牌');},BRAND,'conflict',null);
 return{cases,expectations};
}

export const historicalIds=historicalSnapshot.records.map(r=>r.id);
export async function historicalCases():Promise<CaseInput[]>{
 const relative=historicalSnapshot.source;
 const byId=new Map(historicalSnapshot.records.map(d=>[d.id,d]));
 return historicalIds.map((id,index)=>{
  const d=byId.get(id);if(!d)throw new Error('历史商品不存在：'+id);
  const evidence:Evidence[]=(['title','saleSpec','brand'] as const).map((k,i)=>({id:`H${index+1}-e${i+1}`,productId:id,kind:k==='saleSpec'?'sale_spec':k as 'title'|'brand',text:String(d[k]??''),sourceRef:relative+':'+d.lineNo+'#'+k}));
  // 有限的明确“片/包”抽取，仅用于首步演示；不推断“60片 6包装”的计量范围。
  const direct:Quantity[]=evidence.filter(e=>e.kind!=='brand').flatMap(e=>[...e.text.matchAll(/(\d+)\s*片\s*[\/／]\s*包/gu)].map(m=>({value:Number(m[1]),unit:'片/包',scope:'inner-pack',evidenceId:e.id,quote:m[0]})));
  const brands:BrandObservation[]=d.brand?[{value:String(d.brand),evidenceId:evidence[2]!.id,quote:String(d.brand),describes:'self'}]:[];
  return {id:'H'+String(index+1).padStart(2,'0'),label:d.title,kind:'historical',productId:id,categoryId:WET,categoryBasis:'2026-10-14历史归属复核建议；本轮只验证两个属性，未重新进行全量归属审核。',evidence,brands,direct,totals:[],packs:[]};
 });
}
