import {join,resolve} from 'node:path';
import {read,save,exists,hash} from '../runtime/store.ts';
import {checkCard} from '../domain/validate.ts';
const root=resolve(process.argv[2]!),rev=join(root,'revisions/closure-r3'),results=await read(join(rev,'final-cards.json')),ledger=await read(join(root,'ledger.json')),before=await read(join(rev,'ledger-before.json')),reference=await read(join(rev,'local-reference.json')),old=await read(join(root,'report-data.json'));
const data:any={overview:[],cards:[],rules:[],sources:[],samples:[],reviews:[],references:[],calls:[],regression:[],notes:[]};
for(const d of results){
 const c=d.category,card=d.card,dir=join(rev,'categories',c.id),pilot=!!d.regression,legacy=pilot?await read(join(root,'categories',c.id,'result.json')):d,samples=await read(join(rev,'samples',c.id+'.json')),decisions=legacy.sampleDecisions;
 const statuses=decisions.reduce((o:any,s:any)=>(o[s.status]=(o[s.status]??0)+1,o),{}),source=d.sources??await read(join(dir,'evidence.json'));
 if(checkCard(card,c.id,source).length)throw Error('invalid report card '+c.name);
 data.overview.push([c.name,c.id,c.path,card.attributes.length,card.bindings.filter((b:any)=>b.requiredness==='always').length,card.bindings.filter((b:any)=>b.requiredness==='conditional').length,samples.products.length,statuses.matched??0,statuses.wrong??0,statuses.uncertain??0, '已完成完整复核及定点修改',d.operationsQuestions?.length?'边界待运营确认':(statuses.matched??0)<3?'待补样验证及运营审核':'待运营审核',(d.validationLimitations??card.unresolved??[]).join('\n')]);
 for(const dim of card.dimensions)for(const id of dim.attributeIds){
  const a=card.attributes.find((a:any)=>a.id===id),b=card.bindings.find((b:any)=>b.attributeId===id),r=card.rules.find((r:any)=>r.attributeId===id);
  data.cards.push([data.cards.length+1,c.id,c.path,c.name,id,a.name,a.kind,dim.name,a.fieldType,a.unit,{always:'必填',conditional:'条件必填',optional:'可选'}[b.requiredness as string],b.condition,b.valueLevel,b.scope,a.definition,a.describes,b.uses.join('、'),b.rationale,a.enumValues.join('；'),a.enumPolicy,a.excludedMeanings.join('；'),'待运营审核','']);
  data.rules.push([c.name,c.id,id,a.name,r.directRule,r.operator,r.formula,r.inputs.map((x:any)=>x.name+' / '+x.unit+' / '+x.scope).join('\n'),r.preconditions.join('\n'),r.onMissing,r.onConflict,r.examples.map((x:any)=>'输入：'+x.input+'\n预期：'+x.expected+'\n理由：'+x.reason).join('\n\n')]);
  for(const cl of card.provenance.find((p:any)=>p.attributeId===id).claims){const s=source.find((s:any)=>s.id===cl.sourceId);if(!s)throw Error('unknown source');data.sources.push([c.name,id,a.name,cl.relation,cl.claim,s.platform,s.kind,s.locator,cl.quote,s.hash]);}
 }
 for(const p of samples.products){const x=decisions.find((x:any)=>x.productId===p.id);data.samples.push([c.name,c.id,p.id,p.title,typeof p.saleSpec==='string'?p.saleSpec:JSON.stringify(p.saleSpec),{matched:'符合',wrong:'错挂',uncertain:'待确认'}[x?.status as string]??'未纳入',x?.reason??p.detailStatusConflicts.join('；'),samples.fetchedAt]);}
 for(const x of d.dispositions??[])data.reviews.push([c.name,'原末轮复核',x.attributeId,x.issue,x.recommendation??'',x.decision,x.reason]);
 for(const x of d.postReviewDispositions??[])data.reviews.push([c.name,'变更项专项复核',x.attributeId,x.issue,x.recommendation,x.codexDecision,'已按最后版本规则处置；原模型响应保留。']);
 for(const x of [...(d.changes??[]),...(d.finalChanges??[])])data.reviews.push([c.name,'规则与结构修正',x.attributeId??x.from??'',x.reason??x.kind,'',x.to?'ID更新为 '+x.to:'已修正','']);
 for(const x of d.regression??[])data.regression.push([c.name,x.caseId,x.attributeId,x.text,x.expected,x.actual,x.pass?'通过':'未通过','合成规则案例，不是商品准确率样本']);
 if(pilot){for(const row of old.localReference.filter((x:any)=>x[1]===c.id)){
  const rr=structuredClone(row),ids=String(rr[10]).split('、').filter(Boolean).flatMap((id:string)=>id==='surface_embossing'?['has_embossing','has_printing']:[id]);
  if(ids.some((id:string)=>!card.attributes.some((a:any)=>a.id===id)))throw Error('pilot stale refs '+c.name+' '+ids);rr[0]=data.references.length+1;rr[10]=ids.join('、');if(ids.includes('has_embossing'))rr[11]+='；r3将压花与印花拆为独立是否属性。';data.references.push(rr.slice(0,16));
 }}else for(const x of d.localReferenceDecisions){
  const rr=reference.rows.find((r:any)=>r.sourceId===x.sourceId),s=reference.sources.find((r:any)=>r.id===x.sourceId);if(!rr)throw Error('reference missing');
  data.references.push([data.references.length+1,c.id,c.path,c.name,rr.templateId,rr.attribute,rr.requiredRaw,rr.fieldTypeRaw,rr.enumRaw??'',x.action,x.targetAttributeIds.join('、'),x.reason,'以最终属性卡为准，保留本地原行证据',rr.sheet,rr.row,s.locator]);
 }
}
for(const e of ledger.entries){const u=e.usage??{};data.calls.push([e.id,e.kind,e.status,u.input_tokens??null,u.input_tokens_details?.cached_tokens??null,u.output_tokens??null,e.charged??0,e.charged===null?e.reserved:0,e.durationMs?e.durationMs/1000:null,e.startedAt,e.finishedAt??'',before.entries.some((x:any)=>x.id===e.id)?'本轮之前':'本轮新增']);}
const sum=(xs:any[])=>xs.reduce((s:number,x:any)=>s+(x.charged??0),0),increment=ledger.entries.filter((x:any)=>!before.entries.some((b:any)=>b.id===x.id));
data.summary={categories:results.length,attributes:data.cards.length,samples:data.samples.length,matched:data.samples.filter((r:any)=>r[5]==='符合').length,wrong:data.samples.filter((r:any)=>r[5]==='错挂').length,uncertain:data.samples.filter((r:any)=>r[5]==='待确认').length,cost:sum(ledger.entries),beforeCost:sum(before.entries),increment:sum(increment),reserved:ledger.entries.filter((x:any)=>x.charged===null).reduce((n:number,x:any)=>n+x.reserved,0),budget:ledger.limit,references:data.references.length,inputTokens:increment.reduce((n:number,x:any)=>n+(x.usage?.input_tokens??0),0),cacheTokens:increment.reduce((n:number,x:any)=>n+(x.usage?.input_tokens_details?.cached_tokens??0),0)};
data.notes=[
 ['交付范围','清洁纸品21个末级完整属性卡。原3类先固化共用规则，再新增18类建模。当前为待运营审核稿。'],
 ['商品样本','原3类30件参考快照保留，新增18类各随机10件ES在售商品共180件；合计210件标题和规格辅助建模。错挂/待确认不作为有效本类证据。不是本轮商品批量试填。'],
 ['样本限制','枕巾、生活用纸、卷纸配件各10件随机样本中没有确认符合本类的商品；不代表类目下无真实商品。一次性日杂的8件纸杯/纸盘因与餐具承接边界未定，由模型符合改为待确认。有效样本不足的类目须补证，不把候选枚举当已验证枚举。'],
 ['纸巾盒说明','表中仍列原10件随机参考样本。此前补充的有效纸巾盒商品和三类试填结果保留在历史版本，本轮仅重验受影响规则，不重复整批填写。'],
 ['本地震坤行','实际读取用户本地Excel中M45112清洁纸品上位模板，1295分类模板第4184—4195行，12项×21类共252项适用性决策。不是21个完全对齐的专属类目模板，原必填/枚举不直接照搬。'],
 ['审核方法','官方DeepSeek每类完整语义复核，修改项定点复核，Codex裁定异议；程序验证结构、ID、来源引用和映射。模型同意不等于商品准确率。'],
 ['核心必填','按识别、展示、搜索筛选需要确定。缺资料仍计缺项，不能为了填充率降级。条件是否成立、值是否缺失、枚举外候选分别记录。'],
 ['公式与计量','数值和计数单位分离。只使用同SKU同销售组合、同包装层级的独立直接输入；异规格不均摊，未知不猜，盒/包、抽/张、压花/印花不混用。'],
 ['边界待确认','一次性日杂与餐具交叉、生活用纸兜底范围、枕巾是否承接纺织用品、坐垫纸是否纸基一次性，均保留运营确认项，不改V2树。'],
 ['成本','累计沿用50元上限。费用按已返回token与登记单价估算，含历史调用及本轮失败/修复，不等于供应商账单。缓存命中率是实际token口径，不保证每次相同。'],
 ['下一步','先处理边界和有效样本缺口，再按已审核卡开展小批真实商品试填，评估枚举覆盖、总体及必填填充率。本轮不新增18类批量试填，不同步生产。'],
];
if(data.references.length!==252||data.samples.length!==210||data.cards.length!==results.reduce((n:number,d:any)=>n+d.card.attributes.length,0))throw Error('report count mismatch');
await save(join(rev,'report-data.json'),data);console.log(JSON.stringify(data.summary));
