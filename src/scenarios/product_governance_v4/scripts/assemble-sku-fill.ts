import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateSkuFill} from '../sku-fill-contract';
import type {SkuFillRow} from '../sku-fill-contract';

export const digest=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export function applyReviewDeltas(rows:SkuFillRow[],changes:any[]):SkuFillRow[]{
 const result=rows.map(r=>structuredClone(r)),indexes=new Map(result.map((r,i)=>[JSON.stringify([r.skuId,r.attributeKey]),i]));
 if(indexes.size!==result.length)throw Error('Duplicate author SKU/attribute');
 const used=new Set<string>();
 for(const c of changes){
  const key=JSON.stringify([c.skuId,c.attributeKey]),i=indexes.get(key);
  if(i===undefined||used.has(key))throw Error('Unknown or repeated review change');used.add(key);
  const before=result[i]!;
  if(digest(JSON.stringify(before))!==c.beforeHash)throw Error('Review no longer matches author row');
  const r=c.replacement;
  if(!r||r.skuId!==before.skuId||r.attributeKey!==before.attributeKey||r.categoryId!==before.categoryId||!c.reason?.trim())throw Error('Review cannot change row identity or omit reason');
  result[i]={...structuredClone(r),independentChange:{reason:c.reason,originalStatus:before.status,originalValue:before.value,beforeHash:c.beforeHash}};
 }
 return result;
}

async function main(){
 const args=process.argv.slice(2),flags:Record<string,string>={};
 for(let i=0;i<args.length;i+=2){if(!['--manifest','--out'].includes(args[i]!)||!args[i+1])throw Error('--manifest file --out dir required');flags[args[i]!.slice(2)]=args[i+1]!;}
 if(!flags.manifest||!flags.out)throw Error('--manifest file --out dir required');
 const manifestPath=path.resolve(flags.manifest),base=path.dirname(manifestPath),out=path.resolve(flags.out),inputs:any[]=[];
 const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
 async function pinned(ref:any){
  if(!ref?.path||!/^[a-f0-9]{64}$/.test(ref.sha256??''))throw Error('Input needs path and SHA-256');
  const file=path.resolve(base,ref.path),bytes=await fs.readFile(file);
  if(digest(bytes)!==ref.sha256)throw Error('Stale input '+ref.path);
  inputs.push({path:file,sha256:ref.sha256});return JSON.parse(bytes.toString());
 }
 const evidence=await pinned(manifest.evidence),authors=[];
 for(const ref of manifest.authors??[])authors.push(await pinned(ref));
 if(!authors.length)throw Error('Authors required');
 const review=await pinned(manifest.review),deltas=await pinned(manifest.deltas);
 const supplemental=manifest.supplemental?await pinned(manifest.supplemental):null;
 if(review.evidenceSha256!==manifest.evidence.sha256||deltas.evidenceSha256!==manifest.evidence.sha256||review.contractSha256!==evidence.expectedContractSha256||deltas.expectedContractSha256!==evidence.expectedContractSha256)throw Error('Review evidence or contract is stale');
 const authorPaths=new Map(inputs.slice(1,1+authors.length).map(i=>[i.path,i.sha256]));
 for(const [file,sha256] of authorPaths){
  if(!deltas.authorHashes?.some((r:any)=>path.resolve(base,r.path)===file&&r.sha256===sha256))throw Error('Review does not pin every author');
 }
 const originalRows=authors.flatMap(a=>a.rows),rows=applyReviewDeltas(originalRows,deltas.changes??[]);
 const sources=[...evidence.sources];
 for(const author of authors)for(const s of author.additionalSources??[]){
  const found=sources.find((x:any)=>x.sourceId===s.sourceId);
  if(found&&JSON.stringify(found)!==JSON.stringify(s))throw Error('Conflicting source IDs');if(!found)sources.push(s);
 }
 const text=await fs.readFile(evidence.contractPath,'utf8'),contract=JSON.parse(text);
 const report=validateSkuFill({contractText:text,expectedContractSha256:evidence.expectedContractSha256,skus:evidence.skus,sources,rows});
 await fs.mkdir(out,{recursive:true});
 await fs.writeFile(path.join(out,'program-checks.json'),JSON.stringify(report,null,2)+'\n');
 if(!report.structureValid)throw Error('SKU checks failed; inspect program-checks.json');
 if(review.reviewedSkuCount!==evidence.skus.length||review.proposedReviewed!==originalRows.filter((r:any)=>r.status==='proposed').length)throw Error('Independent review coverage mismatch');
 const byAttr=new Map(contract.proposals.map((p:any)=>[JSON.stringify([p.categoryId,p.key]),p]));
 const skuNotes=authors.flatMap(a=>a.skuNotes??[]),counts:Record<string,number>={};
 const categories=evidence.skus.reduce((acc:any[],s:any)=>{let c=acc.find(c=>c.categoryId===s.categoryId);if(!c){c={categoryId:s.categoryId,category:s.category,skus:0,rows:0,statuses:{},summaryRead:0};acc.push(c);}c.skus++;if(s.summaryStatus==='ok')c.summaryRead++;return acc;},[]);
 const enriched=rows.map((r,i)=>{
  counts[r.status]=(counts[r.status]??0)+1;const c=categories.find((c:any)=>c.categoryId===r.categoryId);c.rows++;c.statuses[r.status]=(c.statuses[r.status]??0)+1;
  const p:any=byAttr.get(JSON.stringify([r.categoryId,r.attributeKey]));
  return {...r,attribute:p.name,definitionId:p.definitionId,definitionVersion:p.definitionVersion,type:p.type,mode:p.typing?.choice?.mode??null,unit:p.unit??null,definition:p.definition,rule:p.shortRule,programStatus:report.rows[i]!.programStatus,humanDecision:''};
 });
 const result={version:1,createdAt:new Date().toISOString(),contractPath:evidence.contractPath,contractSha256:evidence.expectedContractSha256,selectionSha256:evidence.selectionSha256,sampling:evidence.sampling,supplemental,inputs,authors:authors.map(a=>a.author),review,changes:deltas.changes,skus:evidence.skus,sources,skuNotes,rows:enriched,
 summary:{skus:evidence.skus.length,attributes:rows.length,statuses:counts,categories,humanReviewed:0,accuracy:null,candidateCoverage:{numerator:counts.proposed??0,denominator:rows.length}},
 limitations:[...evidence.limitations,'AI审校与程序检查不等于人工金标准或100%准确率','未获取既有完整参数值，不是可直接写入的差异补丁'],productionWrites:0,deepseekRequests:0,adoption:'pending_human'};
 for(const input of inputs)if(digest(await fs.readFile(input.path))!==input.sha256)throw Error('Input changed during assembly');
 await fs.writeFile(path.join(out,'sku-fill-results.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({out,skus:result.summary.skus,attributes:rows.length,statuses:counts,checks:report.structureValid,productionWrites:0}));
}
if(import.meta.main)await main();
