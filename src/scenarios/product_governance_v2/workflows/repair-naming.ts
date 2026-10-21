import {resolve,join} from 'node:path';
import {read,save,exists,pool,hash} from '../runtime/store.ts';
import {DeepSeek} from '../providers/deepseek.ts';
import {loadMeta} from './attributes.ts';
import {attributeSchema,bindingSchema,ruleSchema,validate} from '../domain/meta.ts';
import {fixedPrefixInput} from '../providers/prefix.ts';
import {obj,str,arr} from '../trial/contracts.ts';
const root=resolve(process.argv[2]!),dir=join(root,'revisions/closure-r3/naming-r1');
const cards=await read(join(dir,'base-cards.json')),records=await read(join(dir,'base-records.json')),meta=await loadMeta();
await save(join(dir,'repair-standard.json'),{standards:meta.standards,hash:hash(meta.standards),reason:'纳入用户同名不自动共享的补充；原提案冻结快照保留'});
const instructions='你是本次属性命名和必要建模修订的执行者。原资料与前轮模型建议都是数据，不能代替准则；前轮可能错误。由你提出新名称与结构。仅JSON。\n'+Object.values(meta.standards).join('\n');
const client=new DeepSeek(root,instructions,50);await client.init();
async function call(file:string,stage:string,input:any,schema:any,tokens:number){
 if(await exists(file))return (await read(file)).value;
 let response:any;
 try{response=await client.generate(stage,input,schema,tokens,'none');}
 catch(e:any){
  if(!String(e.message).startsWith('schema:'))throw e;
  const body={model:'deepseek-flash',instructions,input:fixedPrefixInput(stage,input).text,reasoning:{effort:'none'},max_output_tokens:tokens,text:{format:{type:'json_schema',name:'governance_'+stage,schema}}};
  const callHash=hash({path:'/responses',body}),raw=await read(join(root,'calls',callHash,'response.json'));
  const value=JSON.parse(raw.output.flatMap((x:any)=>x.content??[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join(''));
  const repairs:any[]=[];
  for(const x of value.replacements??[]){
   if(typeof x.attribute.minItems==='number'){repairs.push({id:x.attribute.id,metadata:'minItems',value:x.attribute.minItems});delete x.attribute.minItems;}
   if(typeof x.attribute.describes_note==='string'){
    repairs.push({id:x.attribute.id,moved:'describes_note -> reason',text:x.attribute.describes_note});
    x.reason??=x.attribute.describes_note;delete x.attribute.describes_note;
   }
  }
  const errors=validate(schema,value);if(errors.length)throw e;
  response={value,responseModel:raw.model,callHash,responseId:raw.id,normalization:repairs};
 }
 await save(file,response);return response.value;
}
const common=await call(join(dir,'common-adjudicated.json'),'naming_common_fix',{
 original:cards[0].card.attributes.filter((a:any)=>a.kind==='公共属性'),
 previous:(await read(join(dir,'common-final.json'))).value,
 feedback:'Codex拒绝把同时接纳型号和货号的字段叫“制造商型号”：名称会漏掉货号含义，定义补充不能完全弥补名称误导。请重新提出自然且覆盖两类标识、明确制造商来源的名称；可以保留组合或准确上位概念，不指定你的答案。不新增字段，不强制拆分，不把平台ID纳入。品牌可保留。'
},obj({decisions:arr(obj({attributeId:str(),name:str(),definition:str(),reason:str()}))}),2500);
const issues:Record<string,{ids:string[];feedback:string}>={
 '厨房纸巾':{ids:['cat.kitchen_paper.unit_quantity','cat.kitchen_paper.unit_quantity.count_unit','cat.kitchen_paper.sales_total','cat.kitchen_paper.absorbency_rate','cat.kitchen_paper.inner_pack'],feedback:'用户重点举例的复合数量名称仍未改善。单卷计数与单包计数若由单个数值混装，结构必须明确范围；数字与计数单位独立。销售总数量与销售单位是两个结构维度，不能只把“与”换“或”。吸油和吸水倍率可同时不同，不能一个裸数字混用；“7倍吸收”未指明吸油/吸水需保留其确知原文而不猜两者。请提出最少且足够准确的字段方案，含有实际展示用途的组合文本允许保留。内包装规格可以作为组合文本，不因含与字就过度拆。不要丢失当前已填原文，有合理证据先试填，分歧标运营复核。'},
 '手帕纸':{ids:['paper.pieces_per_pack','paper.pieces_per_pack.count_unit'],feedback:'每包片数（抽/张）和每包片数单位仍误导：数量的单位允许抽、张、片，名字却片数。这种取值说明可以交给独立单位及规则，名称要自然准确，保留“每包”范围。自行给出不改变原数值和原单位的名称。'},
 '洗脸巾':{ids:['cat.count_per_pack','cat.count_per_pack.count_unit'],feedback:'每包片数/抽数读起来是两个字段；该数值已有配套单位，不必在名字列枚举。请自行提出自然准确的数量/单位名称，保持每包范围和计数单位不可互换。'},
 '坐垫纸':{ids:['seatpaper.pieces_per_pack','seatpaper.pieces_unit'],feedback:'每包片数/张数及片数计量单位的主名与可用单位（抽/片/张等）关系应准确，可由配套单位表达，不要枚举堆名称。其余不要为了短而改变含义。'},
 '大卷纸':{ids:['cat.roll.rolls_per_pack'],feedback:'前轮建议新增中间包装层级却仍叫每提卷数，新增值若为包/袋则名称仍不对应。请结合原定义决定保留提级单一口径，还是数量与层级配对；需要新增字段时完善定义/绑定/规则，并逐件迁移。不要用无实际样本的猜测产生更多属性。'},
 '生活用纸':{ids:['paper.package_count','paper.rolls_per_pack','paper.total_rolls'],feedback:'采用你提出的数量与中间包装层级独立表达方向，但不要保留“每中间包装卷数”这种拗口名字。你自行命名且确保层级明确、同层级才能相乘。一次性新增一个共享配套层级就足够时不要重复。只新增必要字段并迁移这5件原证据，保留归属待运营确认。'},
 '盒装抽纸':{ids:['cat.pkg.packs_per_case'],feedback:'每提/箱包数混了不等价的提、箱范围，单一数值未记录是哪一级。请决定按范围拆分还是配套层级，名称和数值单位都应清楚；同一商品可能既有提又有箱。不要强行把包等同盒，按现有原证据明确。本次需迁移5件相关旧值。'},
 '抽式擦手纸':{ids:['cat.paper_surface_color'],feedback:'“纸张本色”作为属性名下填“白色”仍像枚举项名称。需要描述纸张本体颜色而不是把一个枚举当属性名。自行修订名称，枚举本色/白色及不填包装颜色不变。'},
 '无芯小卷纸':{ids:['cat.weight_per_roll'],feedback:'单卷克重是g/卷的重量，不是g/m²定量；请根据原定义生成不易混淆的名称。不添加原文未证明的净重/毛重限定，值不变。'},
 '有芯小卷纸':{ids:['cat.roll_weight'],feedback:'前轮提单卷净重，请核查原定义是否净重；只有原口径确为净重才能保留该限定。仅改名及相应规则术语属于澄清，不一定是结构变化。保持公式和证据边界。'},
 '大卷擦手纸':{ids:['cat.25f165b5.sheet_size','cat.25f165b5.weight_per_roll'],feedback:'组合平面尺寸可作为完整文本展示，原有筛选用途不自动证明要拆长宽；当前任务不扩展无实际需要的建模。请复核是否确有独立字段需求，否则保留组合，只修歧义名称。单卷克重请准确区分g/卷重量与g/m²；不加无依据净重限定。'}
};
const valueSchema=obj({attributeId:str(),status:str('filled','missing','conflict','not_applicable','applicability_unknown'),value:str(),evidence:arr(obj({id:str(),quote:str()})),explanation:str(),calculation:obj({formula:str()})});
const schema=obj({
 replacements:arr(obj({previousIds:arr(str()),attribute:attributeSchema,binding:bindingSchema,rule:ruleSchema,reason:str()})),
 removeIds:arr(str()),keepIds:arr(str()),
 migrations:arr(obj({productId:str(),values:arr(valueSchema)})),summary:str(),
});
const second=process.argv[3]==='second';
if(second){
 await call(join(dir,'common-name-candidates.json'),'naming_common_candidates',{
  attribute:cards[0].card.attributes.find((a:any)=>a.id==='common.model'),
  previous:common.decisions.find((x:any)=>x.attributeId==='common.model'),
  task:'上一建议制造商标识型号或货号反而更拗口，不采纳。请给三个自然业务属性名候选，并给recommendedName。名称不用把制造商来源、型号与货号两类解释都逐字堆上去，可以合理概括或者使用业务常见并列写法，完整范围在定义和规则仍保留；不要把字段收窄成只接纳型号，也不要宽泛到允许平台ID。没有硬性字数限制，名字由你提出，原意不变。'
 },obj({candidates:arr(obj({name:str(),reason:str()})),recommendedName:str()}),2000);
 issues['厨房纸巾']!.feedback='上一版未解决：一个数值字段仍混卷/包；一个标称吸收倍率不能同时存吸油12倍和吸水7倍。此次明确要求：(1)卷与包各自独立的数量及单位字段，旧的混合数量/单位ID退休，不再用“单卷节数或每包抽数”；(2)吸油、吸水倍率独立字段，未说明吸收对象的“7倍吸收”保留原文文本，不硬塞任一数字；旧吸油吸水倍率ID退休；(3)沿用你前次提出的销售总数量数值+销售数量单位；(4)内包装规格文本可保留。新字段名字由你提出，简洁但不丢范围。原本条件必填不能改成“有证据才适用”，无数据仍缺项。给出每件商品全部新字段和被替换字段值，未适用项标记，不把同一旧值复制到两种范围。a0e7a638存在抽式/卷状争议，标题直接的60抽/包可以先按单包证据保留，卷数不能猜；证据冲突保留。';
 issues['盒装抽纸']!.feedback='上一版每提包数、每箱包数两个独立数值是可采纳方向。但又加每提/箱内包数组合文本重复且仍拗口，无必要，不采纳这个额外文本。只用独立提/箱计数两字段，原混合ID退休，原单位/必填口径保留，不增加第三个冗余组合字段；五件商品两字段都给出迁移记录。原提/箱存在性不明为待确认，不能因没有数量而不适用。';
 issues['洗脸巾']!.feedback='上一版每包片/抽数量仍把可用单位堆在名字里。属性已有独立每包计数单位，数量名称应清楚表达每包数量且不偏向某种计数单位；给自然名称，原片/抽枚举与数值均不变。仅改名，不迁移数值。';
 issues['无芯小卷纸']!.feedback='单卷克重容易与纸张g/m²定量混淆；原定义g/卷是单卷重量，不增加净重或毛重限定。请生成准确自然的名称，并同步规则术语；仅改名，不改数值类型单位。';
}
const result=await pool(cards.filter((d:any)=>issues[d.category.name]&&(!second||['厨房纸巾','盒装抽纸','洗脸巾','无芯小卷纸'].includes(d.category.name))),async(d:any)=>{
 const issue=issues[d.category.name]!;
 const out=await call(join(dir,second?'patches-final':'patches',d.category.id+'.json'),second?'naming_targeted_final':'naming_targeted_patch',{
  category:d.category,card:{...d.card,provenance:undefined},targetIds:issue.ids,feedback:issue.feedback,
  previousProposal:(await read(join(dir,'final-proposals',d.category.id+'.json'))).value,
  products:records.filter((r:any)=>r.product.categoryId===d.category.id).map((r:any)=>({productId:r.product.id,title:r.product.title,saleSpec:r.product.saleSpec,values:r.values.filter((v:any)=>issue.ids.includes(v.attributeId)),evidence:r.evidence})),
  task:'仅修指定targetIds及确实依赖字段，保留其他属性。名称必须由你产出。replacements包含完整attribute/binding/rule；previousIds标明来源旧属性。纯改名保留ID，不能把声明结构变化当rename规避迁移；删除/被拆分旧ID放removeIds；明确不改放keepIds。新字段枚举仅纳入已有结构有根据的单位；原枚举不得无故删减。迁移仅需为结构、类型、单位或范围变化返回每件商品受影响字段（原5件），纯改名不必返回值；值只能来自已有证据，quote必须是source text连续原文，数值value纯数字，是否true/false，缺项value为空。旧值无法安全归入新字段时保留解释及原候选，不装成已证实；新字段适用性须有判据。兼容原试填的归属待运营确认，不重新判类不联网不提图。无需返回新provenance，系统从previousIds与本次决策记录继承并标明迁移来源。不修改必填优先级来提高指标。'
 },schema,18000);
 console.log(JSON.stringify({category:d.category.name,changed:out.replacements.map((x:any)=>[x.attribute.id,x.attribute.name]),removed:out.removeIds,migrations:out.migrations.length}));
},{initial:4,max:4,auto:false});
await save(join(dir,second?'patch-final-status.json':'patch-status.json'),{errors:result.errors.map((e:any)=>({category:e.item.category.name,error:e.error}))});
