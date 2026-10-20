import {join} from 'node:path';
import {read,save,digest} from '../runtime/storage.ts';
import {ROOT,RUN,AVAILABLE_MODELS,TARGET_NAMES,KEY_PREFIX,COMMON_RULES} from './settings.ts';
import {invoke,covers} from './model-run.ts';
const mode=process.argv[2]??'prepare';
if(mode==='prepare'){
 const standard:any=await read(join(RUN,'design/standard.json'));
 const products:any[]=await read(join(RUN,'inputs/products.json'));
 const ocr:any=await read(join(RUN,'inputs/image-ocr.json'));
 const tree:any=await read(join(ROOT,'scratch-category-baseline-20261010/mapped-tree.json'));
 const leaves=tree.nodes.filter((n:any)=>n.isLeaf),base=leaves.filter((n:any)=>n.path.startsWith('清洁用品>清洁纸品>')).map((n:any)=>({id:n.id,name:n.name,path:n.path}));
 const dictionary=Array.from(new Map(products.filter(p=>p.brandId&&!['国产','通用','未知','无','N/A','其他','其它','无品牌'].includes(p.brand)).map(p=>[p.brandId,{id:p.brandId,name:p.brand,aliases:[p.esBrand?.internationalName,p.esBrand?.alias].flat().filter(Boolean)}])).values());
 const ready=products.map(p=>{
  const selected=p.evidence.filter((e:any)=>e.source==='sanheng_detail');
  const evidence=selected.map((e:any,i:number)=>({...e,originalId:e.id,id:e.field==='title'?'T':e.field==='brandName'?'B':e.field==='saleSpec'?'S':`E${i}`}));
  if(!evidence.some((e:any)=>e.id==='T'))evidence.push({id:'T',productId:p.id,kind:'title',text:p.title,source:'es',sourceRef:'inputs/es-raw/'+p.categoryId+'.json#'+p.id});
  const ox=(ocr.products??ocr.rows??ocr).find((x:any)=>(x.productId??x.id)===p.id),txt=ox?.ocr?.text??ox?.text;
  if(txt)evidence.push({id:'I',productId:p.id,kind:'image_ocr',text:txt,source:'main-image-ocr',sourceRef:ox.url??ox.sourceUrl,note:'未经视觉核验的OCR候选；不等于真实SKU参数'});
  const key=p.key??KEY_PREFIX[p.categoryName]+String(p.sampleRank).padStart(2,'0');
  const extra=leaves.filter((n:any)=>!base.some((b:any)=>b.id===n.id)&&n.name.length>=2&&String(p.title+' '+p.saleSpec).includes(n.name)).sort((a:any,b:any)=>b.name.length-a.name.length).slice(0,16).map((n:any)=>({id:n.id,name:n.name,path:n.path}));
  return {...p,key,evidence,candidateCategories:[...base,...extra],mainImageLocal:ox?.localPath??null};
 });
 const manifestFile=join(RUN,'batch-manifest.json');
 const hash=digest({standard,products:ready});
 if(await Bun.file(manifestFile).exists()){
  const old:any=await read(manifestFile);if(old.inputHash!==hash)throw new Error('已冻结批次输入改变；请创建新版本，不混用规则');
  console.log('prepare replay',old.batches.length);process.exit(0);
 }
 await save(join(RUN,'inputs/model-products.json'),ready);
 await save(join(RUN,'inputs/brand-reference.json'),{source:'本轮ES品牌实体引用，生产主数据待对齐',items:dictionary});
 const batches:any[]=[];
 for(const name of TARGET_NAMES){const cat=standard.categories.find((c:any)=>c.name===name);const ps=ready.filter(p=>p.categoryId===cat.id),bindings=standard.bindings.filter((b:any)=>b.categoryId===cat.id);
  const attrs=bindings.map((b:any)=>({...standard.definitions.find((d:any)=>d.id===b.attributeId),required:b.required,requiredWhen:b.requiredWhen,applicabilityRule:b.applicabilityRule,allowedValues:b.allowedValues,applicability:b.applicability,rationale:b.rationale}));
  for(let i=0;i<ps.length;i+=10){const group=ps.slice(i,i+10),id=group[0].key+'-'+group.at(-1).key;
   const candidates=Array.from(new Map(group.flatMap(p=>p.candidateCategories).map(c=>[c.id,c])).values());
   const payload={task:'逐件独立识别类目，并按冻结属性卡填写当前销售SKU。',standardVersion:standard.releaseId,standardHash:digest(standard),category:cat,attributes:attrs,dictionary,candidateCategories:candidates,rules:COMMON_RULES,
    products:group.map(p=>({key:p.key,id:p.id,upstreamSku:p.upstreamSku,evidence:p.evidence.map((e:any)=>({id:e.id,kind:e.kind,text:e.text}))})),
    requirementGroups:standard.requirementGroups.filter((g:any)=>g.categoryId===cat.id),requirednessContract:standard.requirednessContract,
    output:{products:[{key:'',category:{status:'matched|wrong|uncertain',targetId:'',targetName:'',reason:''},values:{'attribute.id':['规范值','证据ID','精确引文','可选计算式']},missing:{'attribute.id':'未说明|口径不清|来源冲突|枚举待扩充|不适用（理由）'},conditionFacts:[{fact:'',value:true,evidenceId:'',quote:''}],flags:[]}]}};
   await save(join(RUN,'batches',id+'.input.json'),payload);batches.push({id,keys:group.map(p=>p.key),categoryId:cat.id,hash:digest(payload)});
  }
 }
 await save(manifestFile,{runId:'clean-paper-five-20261019',inputHash:hash,standardHash:digest(standard),productsHash:digest(ready),frozenAt:new Date().toISOString(),batches});
 console.log({products:ready.length,batches:batches.length,withOCR:ready.filter(p=>p.evidence.some((e:any)=>e.id==='I')).length});
}else{
 const model=AVAILABLE_MODELS.find(m=>m.id===mode);if(!model)throw new Error('model must be deepseek, kimi, glm or qwen');
 const manifest:any=await read(join(RUN,'batch-manifest.json'));const only=process.argv[3];const batches=manifest.batches.filter((b:any)=>!only||b.id.startsWith(only));let next=0;const failures:any[]=[];
 await Promise.all(Array.from({length:mode==='kimi'?4:3},async()=>{
  while(next<batches.length){const b=batches[next++],input:any=await read(join(RUN,'batches',b.id+'.input.json'));const stage=(mode==='deepseek'?'fill-':'blind-review-')+b.id;
   const payload={...input,role:mode==='deepseek'?'初填模型':'独立复核模型；不给初填答案，独立检查相同证据，后续由Codex对照裁定。'};
   try{
    const r=await invoke(stage,model,payload,covers(b.keys));if(r)continue;
    // A completed failure is retried once in two smaller groups; never replay an unknown in-flight request.
    for(let j=0;j<b.keys.length;j+=5){const products=payload.products.slice(j,j+5);const retry={...payload,products,repair:'前次失败，拆成较小分组。仅输出本组全部key，合法JSON，不得省略。'};
     if(!await invoke(stage+'-repair-'+(j/5+1),model,retry,covers(products.map((p:any)=>p.key))))failures.push({stage,keys:products.map((p:any)=>p.key)});
    }
   }catch(e){failures.push({stage,error:e instanceof Error?e.message:String(e)});console.log(stage,'requires-attention');}
  }
 }));
 await save(join(RUN,'models',mode+'-run-status.json'),{at:new Date().toISOString(),expected:batches.length,failures});console.log({model:mode,failures});if(failures.length)process.exitCode=1;
}
