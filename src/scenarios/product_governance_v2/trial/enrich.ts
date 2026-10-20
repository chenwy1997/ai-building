import {join,resolve} from 'node:path';
import {read,save,pool} from '../runtime/store.ts';
import {trialRuntime} from './runtime.ts';
import {identitySchema,obj,str,arr} from './contracts.ts';
import {JdVopTools,jdEvidence} from '../tools/jd-vop.ts';
const run=resolve(process.argv[2]!),rt=await trialRuntime(run),selected=await read(join(run,'trial/selected-products.json'));
const decisions=await read(join(run,'trial/screen-final.json')),jd=new JdVopTools(run);await jd.init();
const targets=selected.filter((p:any)=>decisions.find((d:any)=>d.productId===p.id).status==='matched');
const outcome=await pool(targets,async(p:any)=>{
 const initial=(await read(join(run,'trial/initial',p.id+'.json'))).value;
 const missing=initial.values.filter((v:any)=>v.status!=='filled'&&v.status!=='not_applicable');
 if(!missing.length){await save(join(run,'trial/enrichment',p.id+'.json'),{status:'not_needed',evidence:[]});return;}
 const direct=String(p.upstream?.name??'').includes('京东')&&/^\d+$/.test(String(p.upstreamSku??''));
 let skus:string[]=[],search:any=null;
 if(direct)skus=[String(p.upstreamSku)];
 else{
  const plan=await rt.call(`search-plan/${p.id}.json`,'trial_same_product_query',{productId:p.id,title:p.title,saleSpec:p.saleSpec,brand:p.brand,
   task:'从已知品牌、型号、规格提取一条京东同品检索关键词，最长80字符。不编造型号，不用整段营销词。仅返回query。'},obj({query:str()}),1000);
  search=await jd.search(plan.query);if(search.status==='ok')skus=search.data.slice(0,3).map((x:any)=>x.skuId);
 }
 const candidates=[];
 for(const skuId of skus){
  const receipt=await jd.detail(skuId),evidence=jdEvidence(receipt);
  if(receipt.status!=='ok'){candidates.push({skuId,status:'error',receipt});continue;}
  const identity=await rt.call(`identity/${p.id}-${skuId}.json`,'trial_same_product_identity',{
   task:'先核对同品，不填写属性。只有相同品牌/型号/主体/颜色规格/销售包装且无冲突才能same。上游SKU关联只是线索，不能忽略型号、件数/包数、颜色等冲突。没有足够信息为uncertain，明确冲突为different；缺少型号但商品名称、品牌、关键规格和包装足以唯一对齐时说明理由。禁止从图片判断。',
   productId:p.id,skuId,sourceEvidence:p.evidence,jdEvidence:evidence,association:direct?'三横上游京东SKU关联':'京东搜索候选'},identitySchema,4000);
  if(identity.productId!==p.id||identity.skuId!==skuId)throw Error('identity key mismatch');
  candidates.push({skuId,status:'ok',identity,evidence});
 }
 const accepted=candidates.filter((c:any)=>c.identity?.status==='same');
 await save(join(run,'trial/enrichment',p.id+'.json'),{productId:p.id,mode:direct?'upstream_sku':'search',search,candidates,
  status:accepted.length===1?'same':accepted.length>1?'multiple_same_candidates':'unconfirmed',
  evidence:accepted.length===1?accepted[0]!.evidence:[]});
 console.log(JSON.stringify({id:p.id.slice(0,8),mode:direct?'upstream':'search',statuses:candidates.map((c:any)=>c.identity?.status??c.status)}));
},{initial:3,max:3,auto:false});
await save(join(run,'trial/enrichment-status.json'),outcome);if(outcome.errors.length)throw Error(JSON.stringify(outcome.errors));
