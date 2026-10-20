import {join,resolve} from 'node:path';
import {read,save,exists,hash,pool} from '../runtime/store.ts';
import {checkCard} from '../domain/validate.ts';
import {checkSharedRules} from '../domain/shared-rules.ts';
import {registry} from '../domain/registry.ts';
import {DeepSeek} from '../providers/deepseek.ts';
import {obj,str,arr} from '../trial/contracts.ts';
import {usableWebText} from '../domain/normalize.ts';
const root=resolve(process.argv[2]!),rev=join(root,'revisions/closure-r3'),f=await read(join(rev,'frozen.json'));
const selected=await read(join(root,'selected-categories.json')),client=new DeepSeek(root,'你是规则回归执行员，仅输出JSON。按给定新卡判定案例，不使用图片，不把未知当否。\n'+f.meta.standards['07-trial-closure.md'],50);await client.init();
const schema=obj({results:arr(obj({caseId:str(),value:str(),reason:str()}))});
const outcomes=await pool(selected,async(c:any)=>{
 const dir=join(rev,'categories',c.id),d=await read(join(dir,'candidate.json')),card=d.card;
 const rule=(id:string)=>card.rules.find((r:any)=>r.attributeId===id),attr=(id:string)=>card.attributes.find((a:any)=>a.id===id),binding=(id:string)=>card.bindings.find((b:any)=>b.attributeId===id);
 const dispositions=d.review.findings.map((x:any,i:number)=>({index:i,attributeId:x.attributeId,issue:x.issue,decision:'采纳澄清',reason:'将执行口径明确写入对应规则，不改变已有核心必填。'}));
 if(c.name==='软包抽纸'){
  rule('sheets_per_pack').onMissing='单包范围未知则unknown；整箱共100抽、24包不能直接当每包100抽；24包100抽结合语序与销售规格确认，不把抽称作张或层。';
  rule('total_packs').onMissing='只有4提而无每提包数则unknown；出现赠送/混装/加量且范围不明停止计算；独立直接总包数无冲突可保留。';
  attr('scent').enumPolicy+=' 本字段单选；相互矛盾香型记conflict；异香型组合按组件记录，不能硬取一项。';
  attr('raw_material').enumPolicy+=' 对未能归入具体已知枚举的明确原文，试填保留enumStatus=out候选，不用其他掩盖待扩项；缺证unknown，不填其他。';
  binding('packs_per_bundle').condition='明确有提结构时适用；存在但缺每提包数为missing；无法判断是否有提为applicability_unknown；明确没有才not_applicable。';
  for(const id of ['has_embossing','has_printing'])attr(id).enumPolicy='非选项字段，无枚举；明示工艺为true，明确无此工艺为false，缺证留空。';
  dispositions[5].decision='部分采纳';dispositions[5].reason='异规格不能平均单包量；但明示销售总包数可直接保留，不能因异规格就全部清空。';
 }
 if(c.name==='纸巾盒')for(const id of ['style','tissue_compatibility']){
  attr(id).enumPolicy+=' 本轮试填不启用兜底其他：明确但未覆盖原词记enumStatus=out候选，已覆盖的多值逐项in；其他枚举保留供后续运营确认适用边界。';
  rule(id).examples.push({input:'synthetic：来源明示未列入枚举的设计风格或片状纸型',expected:'保留原词（枚举外候选）',reason:'不自动归其他，缺证也不填其他。'});
 }
 if(c.name==='湿纸巾'){
  for(const id of ['pieces_per_pack','total_pieces_sales_unit']){
   const r=rule(id);r.directRule=r.directRule.replaceAll('赠品处理清楚','赠品范围无未解冲突').replaceAll('赠品处理明确','无赠品混装迹象或相关范围已明确');r.preconditions=r.preconditions.map((s:string)=>s==='赠品处理明确'?'无赠品混装加量迹象或相关范围已明确':s);
   r.inputs[0].scope+=' 必须来自商品原文直接明示，禁止引用另一属性的计算结果。';
  }
  binding('pack_components').condition='mixed_pack=true时必填；false时确定不适用；unknown时适用性待确认，不默认不适用。';
  binding('mixed_pack').scope+=' 同SPU下各SKU销售组合分别记录，不跨SKU合并。';
  rule('pieces_per_pack').directRule+=' 只明示抽或张而无片的对应证据时，本字段unknown，原单位不能丢失。';
  const bad=dispositions.find((x:any)=>x.attributeId==='total_pieces_sales_unit'&&x.issue.includes('provenance'));
  if(bad){bad.decision='驳回引用事实、移除无效上下文';bad.reason='检查当前provenance并未引用该登录页，故“被当支持证据”不成立；仍将该页从可用sources移除以降低干扰，不新增无效爬取。';}
 }
 if(rule('mixed_pack')){
  rule('mixed_pack').examples[0]={input:'synthetic：同款每包80'+(c.name==='湿纸巾'?'片':'抽')+'×6包',expected:'false',reason:'完整同质倍数规格，无异规格或赠品冲突迹象；无需额外无赠品四字。'};
  rule('mixed_pack').onMissing+=' 有多规格迹象但范围未知时暂停同质均摊或乘算；直接明确数值保留；mixed_pack=true时按组件记录，不平均单包。';
 }
 // Source data is retained in historical revisions; unusable login pages are excluded from current evidence.
 d.sources=d.sources.filter((s:any)=>s.kind!=='web_page'||usableWebText(s.text));
 const errors=[...checkCard(card,c.id,d.sources),...checkSharedRules(card)];if(errors.length)throw Error(errors.join(';'));
 const cases=c.name==='软包抽纸'?[
  {caseId:'S1',attributeId:'sheets_per_pack',text:'100抽×24包，同款当前SKU',expected:'100'},
  {caseId:'S2',attributeId:'sheets_per_pack',text:'整箱共100抽，24包，每包未知',expected:'unknown'},
  {caseId:'S3',attributeId:'total_packs',text:'同款6包/提×4提',expected:'24'},
  {caseId:'S4',attributeId:'packs_per_bundle',text:'24包，未说明提结构',expected:'applicability_unknown'},
  {caseId:'S5',attributeId:'has_printing',text:'纸张压花，未提印花',expected:'unknown'},
  {caseId:'S6',attributeId:'scent',text:'洁柔百花香抽纸',expected:'花香'},
 ]:c.name==='湿纸巾'?[
  {caseId:'W1',attributeId:'total_pieces_sales_unit',text:'80片/包×7包，同款当前SKU，无其他组合迹象',expected:'560'},
  {caseId:'W2',attributeId:'pieces_per_pack',text:'同规格4包共2000片，直接明示总量和包数',expected:'500'},
  {caseId:'W3',attributeId:'pieces_per_pack',text:'80抽/包，无抽片对应信息',expected:'unknown'},
  {caseId:'W4',attributeId:'pack_components',text:'组合是否异规格未知，组件也未知',expected:'applicability_unknown'},
 ]:[
  {caseId:'B1',attributeId:'style',text:'风格创意可爱',expected:'创意；可爱'},
  {caseId:'B2',attributeId:'tissue_compatibility',text:'适用抽取式纸巾和餐巾纸',expected:'抽取式纸巾；餐巾纸'},
  {caseId:'B3',attributeId:'style',text:'黑色，风格未说明',expected:'unknown'},
 ];
 const input={card,cases:cases.map(({expected,...x})=>x),task:'逐案例返回该单项取值：缺证unknown，条件无法判断applicability_unknown，确实不适用not_applicable；是否用true/false字符串；多值中文分号；数字只给数值。不要返回额外解释字段。'},fp=join(dir,'rule-regression.json');
 let r:any;if(await exists(fp)){r=await read(fp);if(r.inputHash!==hash(input))throw Error('regression changed');}else{r={inputHash:hash(input),...await client.generate('closure_rule_regression',input,schema,3500,'none')};await save(fp,r);}
 const actual=r.value.results;if(actual.length!==cases.length||new Set(actual.map((x:any)=>x.caseId)).size!==cases.length)throw Error('case coverage');
 const checks=cases.map(x=>({...x,actual:actual.find((a:any)=>a.caseId===x.caseId)?.value,pass:actual.find((a:any)=>a.caseId===x.caseId)?.value===x.expected}));
 await save(join(dir,'result.json'),{...d,card,cardHash:hash(card),dispositions,regression:checks,status:checks.every(x=>x.pass)?'codex_reviewed_pending_operations':'regression_needs_codex',programErrors:[]});
 console.log(JSON.stringify({category:c.name,checks}));
},{initial:3,max:3,auto:false});await save(join(rev,'regression-status.json'),outcomes);if(outcomes.errors.length)throw Error(JSON.stringify(outcomes.errors));
const results=await Promise.all(selected.map((c:any)=>read(join(rev,'categories',c.id,'result.json'))));
registry(results.map(x=>x.card));
if(results.some(r=>r.status!=='codex_reviewed_pending_operations'))throw Error('regression gate requires review');
// Benchmark artifacts are experimental. Resolve against the previously adjudicated real record without rewriting it.
const final=await read(join(root,'trial/final.json'));
const resolved=['dfb3c105-8de5-44ca-afeb-5e3b4aff0a0b','dcb096e0-47e5-490e-999b-6d7a5a53b3b3'].map(id=>{
 const record=final.records.find((r:any)=>r.product.id===id);if(!record?.eligible||record.programErrors.length)throw Error('verified record unavailable');
 return {productId:id,action:id.startsWith('dfb')?'隔离实验JSON失败；复用此前已裁定的有效完整商品结果，不重跑。':'采用r3明确百花香→花香；已填值reasonCode=none，模板意见另列。',verifiedRecordHash:hash(record),value:id.startsWith('dcb')?record.values.find((v:any)=>v.attributeId==='scent'):undefined};
});
await save(join(rev,'isolated-issues-resolved.json'),resolved);
await save(join(rev,'pilot-gate.json'),{approved:true,scope:'仅允许剩余18类属性建模；不是运营验收或线上发布批准',standardHash:f.standardHash,cards:results.map(r=>({categoryId:r.category.id,cardHash:r.cardHash})),ruleCases:results.flatMap(r=>r.regression).length,issuesResolved:resolved});
console.log('pilot closure approved for attribute modeling expansion only');
