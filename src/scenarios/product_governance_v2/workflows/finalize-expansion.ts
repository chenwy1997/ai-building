/** Final human-readable Codex dispositions; keeps every pre-review artifact immutable. */
import {join,resolve} from 'node:path';
import {read,save,exists,hash} from '../runtime/store.ts';
import {checkCard} from '../domain/validate.ts';
import {registry} from '../domain/registry.ts';
const root=resolve(process.argv[2]!),rev=join(root,'revisions/closure-r3'),f=await read(join(rev,'frozen.json')),gate=await read(join(rev,'pilot-gate.json')),all:any[]=[];
const reasons:Record<string,string[]>={
 '中心抽大卷纸':['采纳：整箱公式示例加整箱证据，提装可计算总量不证明整箱。','采纳：未写提级结构统一记适用性待确认，不能写成明确没有。'],
 '餐巾纸':['不采纳层级冲突判断：SKU承载当前销售款的纸张本体尺寸是合理的，描述对象与承载层级不同；范围明确到当前SKU单张展开纸。'],
 '有芯小卷纸':['采纳：两个中间包装字段统一触发口径与未知状态。','澄清：always的unknown计核心缺项，不能免填。'],
 '无芯小卷纸':['采纳：中间包装关系按真实结构识别，数量缺失与结构未知区分。','采纳：明确层数用于展示筛选，缺层数不剔除商品。','澄清：直接/计算是取值方式，always是必填性；unknown计缺项。','采纳：允许明确袋/包中间层级，必须回带层级原词。'],
 '枕巾':['采纳：补全同SKU同销售组合、同层级独立直接观测前提。','采纳：包装形式是外观描述，不可直接作为公式包装计数层级。','澄清：同质性由包装/组合证据判断；未知不能当不适用，已确认同质但缺数量计缺项。'],
 '平板卫生纸':['不采纳后项会当张数的推断；仍将语序示例重写为明确张/包，避免靠星号猜关系。','采纳：SPU品牌与当前SKU冲突时保留冲突，不覆盖或跨SKU传播。','采纳：独立直接观测及中间包装层级一致写入算式前提。'],
 '生活用纸':['采纳：卷数依赖实际卷状形态，非卷状不适用，统一理由。','不采纳以少有层数证据为由降必填；纸张层数用于展示筛选，缺证计缺项；配件不在本类范围。','采纳：商用大盘纸描述对象包含卷筒/盘纸。','采纳：仅整箱总长或节数不能直接填单卷长度。','采纳：每中间包装卷数和包装数量必须同层级。'],
 '抽式擦手纸':['采纳格式澄清：文本统一长×宽 mm，数值正数且完整；未明确单张对象不填。','不采纳两字段必须同样可填的判断：明确总包数可直取，中间层级未知独立待确认。','采纳：独立直接总包数不受缺提结构阻塞；不能把提直接当包。','部分采纳：公式已有同质独立总量/包数前提，并不要求每包结果先独立观测；修正互相矛盾的两个整箱反例。','采纳：取消按已标注层数限定scope，未标注属于缺项。','采纳：明确单包销售总包数1，未明示单包不默认1。'],
 '大卷擦手纸':['驳回事实误读：提交的最终enumValues已移除其他；枚举外原词候选与正常枚举值分开，不要求候选命中。','采纳：always缺结构值属于缺项，不能改成条件不适用。','澄清：整箱证据可来自原始标题规格或交易单位，不依赖某字段先填；缺证待确认。','采纳：包装层级依据原始商品资料；未写提不证明无提。','不采纳always不允许unknown的理解：必填但缺证仍留空计缺项。'],
 '一次性日杂':['采纳：计量单位与总数量共同设核心必填，缺总数仍可保留已知单位。','部分采纳：条件仅保留同质独立包装这一业务事实；数量规则放rule，条件未知状态仍必须保留。','澄清：包/箱销售不免除单件计数，缺单件数记缺项；边界尚待运营确认。'],
 '大卷纸':['采纳：中间层级是否存在与层级数量是否存在分开。','采纳：销售单位单选，包装形态仅描述容器，不作为数量换算因子。'],
 '洗脸巾':['采纳：材质作用域覆盖全部本类SKU，缺资料计缺项。','采纳：数值示例仅数字，单位由配套字段承载。','采纳：单位收窄为包，只有明确换算因子才能换算。','采纳：完整单片尺寸规范输出，单边或缺单位为候选，不塞入正式尺寸值。','采纳：只认gsm/g/m²面密度，不把裸g或整包重量代入。','部分采纳：原例括号已直接给每提=1包，不是从片数推算；仍换为更明确的同质直接因子例。'],
 '坐垫纸':['采纳：单包明确销售填1，缺包装数不默认1。','采纳：盒为盒不能变包；本属性只计明确包单位，其他容器本轮保留规格原文候选待定义。'],
 '手帕纸':['采纳：所有本类SKU适用，层数缺证计缺项，不剔除。','采纳：总包数scope取消来源齐全限定。','部分采纳：同质性依据包装描述，非依赖本属性值；固定scope避免证据门槛。','澄清：已确认适用但单位缺失就是缺项，不能改不适用。','不采纳必须常量单位的建议：显式配套单位字段可执行；数值与单位共同展示，缺单位不参与跨品比较。'],
 '盒装抽纸':['不采纳必须启用除法：本字段保留直接证据提取，暂不支持的推导记缺项，不冒充已实现；统一规则允许除法不等于每字段必须启用。','采纳：两个输入必须同层级独立明示；直接值优先，一致可保留直接来源，不一致冲突。'],
 '厨房纸巾':['采纳：限定同一款单一形态计数，多形态组合按组件候选、不得一值混记。','采纳：单位补段/张并保留原词，不等同节/抽。','采纳：用途未知只触发商品归属复核，不直接剔除也不默认错挂。'],
 '擦手纸配件':['采纳：改以材质影响清洁维护和采购选择为必填理由。','采纳：改以安装适配为必填理由。','澄清：件为器具本体计数、个是同义口语，包装形态不作为数量，统一件。','采纳：带锁为增强功能可选，按业务价值决定，不因样本有无证据。'],
};
for(const c of f.branch.filter((x:any)=>x.isLeaf)){
 const dir=join(rev,'categories',c.id),pilot=gate.cards.some((x:any)=>x.categoryId===c.id),d=await read(join(dir,pilot?'result.json':'adjudicated.json'));
 if(pilot){all.push(d);continue;}const card=d.card,beforeFinal=structuredClone(d.card),notes:any[]=[];
 const A=(id:string)=>card.attributes.find((x:any)=>x.id===id),B=(id:string)=>card.bindings.find((x:any)=>x.attributeId===id),R=(id:string)=>card.rules.find((x:any)=>x.attributeId===id);
 for(const b of card.bindings){const a=A(b.attributeId),r=R(b.attributeId);
  if(b.requiredness==='always'){b.scope=(b.valueLevel==='SPU'?'当前商品所属SPU的品牌/型号定义；SKU证据冲突时不跨SKU覆盖。':'当前类目当前SKU，具体描述对象为：'+a.describes)+'缺少来源信息不排除适用性。';r.onMissing+=' 已确认适用但无值统一unknown，计入必填缺项；不剔除该商品、不改为不适用。';}
  if(/每提卷数|每包卷数|每提包数|提数|中间包装|每包（每提）卷数/.test(a.name)){b.requiredness='conditional';b.condition='当前SKU实际存在定义对应的包/袋/提中间包装层级时必填；层级依据原始包装描述，不以该字段已有数量为条件。结构存在缺数量为missing，结构未知为applicability_unknown，明确无该层级才not_applicable。';b.scope='当前SKU同一销售组合的明确中间包装层级；记录实际包/袋/提原词，不跨层混算。';a.definition+=' 数量须随实际中间包装层级解释，袋/包/提只有证据明确时按对应层级承载，不默认互等。';}
  if(/每包片数|每包张数|每包装数量|每包数量/.test(a.name)&&b.requiredness==='conditional'){b.scope='当前SKU的同质独立包装，包含没有现成数量资料的商品。';b.condition='当前销售组合为同质独立包装时必填；异规格组合不均摊，按组件记录；组合结构未知为适用性待确认。';}
  if(r.operator!=='direct'){r.preconditions=[...new Set([...r.preconditions,'两个因子均为同SKU同一销售组合的独立原文直接观测，不使用待求值的反推结果','两个因子计量层级对应（如包/提与提）；不得包/箱与提混算','无未解赠品/混装范围冲突；除数非零，计数结果正整数'])];r.directRule+=' 独立明确直接值优先；直接值与计算值一致保留直接来源，不一致记录conflict。';}
  if(a.fieldType==='数值')for(const e of r.examples){const m=e.expected.match(/^\s*(\d+(?:\.\d+)?)\s*(?:片|抽|张|包|卷|层|件|个|条|节|段|g\/m²|g|mm|cm)(?:\/.*)?\s*$/i);if(m){e.expected=m[1];e.reason+=' 数值字段只保存数字，单位见定义或配套单位字段。';}if(e.expected==='')e.expected='unknown';}
 }
 R('common.brand').onConflict+=' 同SPU不同SKU品牌证据冲突单独记录，不自动覆盖其他SKU。';
 const patch=(id:string,text:string)=>{R(id).directRule+=' '+text;notes.push({attributeId:id,reason:text});};
 if(c.name==='中心抽大卷纸'){for(const e of R('cat.rolls_per_case').examples)if(/6卷.*4提/.test(e.input))e.input+='，明确本SKU整箱销售';for(const e of R('cat.rolls_per_pack').examples)e.reason=e.reason.replace('无中间包装层级','未说明中间包装层级');}
 if(c.name==='平板卫生纸')patch('category.sheets_per_pack','350张/包×4包取350；100张×4包仅在语义明确前项为每包张数时取100，整箱共100张不能当每包100张。');
 if(c.name==='生活用纸'){B('paper.commercial_jumbo').scope='当前SKU的卷筒纸或盘纸';B('paper.total_rolls').rationale='当纸张形态为卷筒/盘纸且按卷计数时，销售总卷数用于采购数量比较；缺证计缺项，非卷状不适用。';patch('paper.roll_length','仅给整箱总长、节数或张数不直接当单卷长度，也不做未声明的推导。');}
 if(c.name==='一次性日杂'){
  B('pack.unit').requiredness='always';B('pack.unit').condition='';B('pack.unit').scope='当前SKU单件计数单位，与销售总数量配套；数值缺失不妨碍保留已知单位。';patch('pack.total_qty','按箱或包销售仍应记录单件总量；缺每包单件数为missing，不以外包装销售豁免。');
  for(const x of d.sampleDecisions)if(x.status==='matched'){x.status='uncertain';x.reason='纸杯/纸盘主体可识别，但与V2餐具类目的承接边界待运营确认；不能先按一次性日杂已匹配统计。';}
  d.sampleMatched=0;card.unresolved.push('8件纸杯/纸盘原模型matched改为待确认，本类无最终确认匹配样本；当前属性仅为纸基日用品候选范围建模。');
  for(const p of card.provenance)if(p.claims.some((x:any)=>x.sourceId.startsWith('sample-'))){p.claims=p.claims.filter((x:any)=>!x.sourceId.startsWith('sample-'));p.claims.push({sourceId:'codex-r3-adjudication',relation:'提出',claim:'基于纸基日用品候选范围提出；实际纸杯纸盘归属待确认，不作为本类已验证商品证据。',quote:''});}
 }
 if(c.name==='枕巾')patch('attr.package_form','箱装是外层容器描述；不能仅据该词把箱数充当包数或直接作为数量因子。');
 if(c.name==='大卷纸'){A('cat.roll.sales_unit').enumPolicy='单选当前SKU交易计价单位；枚举外原词作为候选。包装形式描述容器，不能据其换算数量。';}
 if(c.name==='大卷擦手纸'){R('cat.25f165b5.paper_roll_form').onMissing='unknown并计核心必填缺项，不因结构值缺失更改适用性。';B('cat.25f165b5.rolls_per_case').condition+=' 整箱证据可直接来自原始标题、规格或交易计价单位，不依赖属性字段先已填写。';}
 if(c.name==='抽式擦手纸'){
  patch('cat.sheet_size','正式值格式为正数×正数 mm；明确cm先两边各乘10，保留原值证据。');patch('cat.total_packs','独立总包数直值不受提级资料缺失影响；明示单包销售取1，无此证据不默认1。');
  const es=R('cat.sheets_per_pack').examples;es[1]={input:'synthetic：同款同质整箱共4000抽、20包，无混装赠品迹象',expected:'200',reason:'独立总量与包数，同组合同口径整除；不要求待求每包值先存在。'};es[2]={input:'synthetic：混装整箱共100抽、20包，各包规格未知',expected:'unknown',reason:'同质性未知不能均摊。'};
 }
 if(c.name==='洗脸巾'){
  A('cat.package_count').unit='包';R('cat.package_count').examples[0]={input:'synthetic：同款每提1包、共2提',expected:'2',reason:'每提包数及提数均直接明确，不从片数推断。'};
  A('cat.sheet_size').definition='当前SKU单片展开长×宽；正式值需两边完整且单位明确，规范为长×宽 mm；单边或缺单位只保留原文候选。';R('cat.sheet_size').directRule='完整单片长宽和单位明确时换算为长×宽 mm；cm两边乘10；缺一边、缺单位或尺寸对象未知记unknown，原文仅存候选。';R('cat.sheet_size').examples=[{input:'synthetic：单片20*20CM',expected:'200×200 mm',reason:'完整单片尺寸且单位明确。'},{input:'synthetic：单片20×20，单位未知',expected:'unknown',reason:'缺单位不猜。'}];
  patch('cat.gram_weight','只明示60g不能证明面密度；单片、整包重量均不得直接填写或未经规则用总重反推gsm。');
 }
 if(c.name==='坐垫纸'){
  patch('seatpaper.pack_count','明确单包销售取1；盒不能当包，明示仅盒数的原词保留待确认包装单位，包数字段缺证。');for(const e of R('seatpaper.pack_count').examples)if(/24盒/.test(e.input)){e.expected='unknown';e.reason='24盒保留规格原文，不能误填24包。';}
 }
 if(c.name==='厨房纸巾'){
  const id='cat.kitchen_paper.unit_quantity';A(id+'.count_unit').enumValues=['节','段','抽','张'];B(id).requiredness='conditional';B(id).condition='当前SKU为单一形态的同质卷纸或抽取纸时适用；多形态组合按组件记录，本字段不混记。';B(id+'.count_unit').requiredness='conditional';B(id+'.count_unit').condition=B(id).condition;
  patch(id,'当前记录只表示同一形态的单卷或单包；同时含卷与包且分别计数的组合保留组件候选，本字段unknown，不把不同对象塞入单值。');R(id).examples[0].expected='85';R(id).examples[1].expected='60';
  B('cat.kitchen_paper.use_label').rationale='用于归类识别。用途证据不足触发归属待确认及补证，不直接判错挂或删除商品。';
 }
 if(c.name==='擦手纸配件'){
  B('attr.main_material').rationale='主体材质影响清洁维护、耐用性和采购筛选，因此核心必填，缺证计缺项。';B('attr.mounting_type').rationale='安装方式影响场所适配，因此核心必填，缺证计缺项。';B('attr.with_lock').rationale='带锁是增强功能，可选用于功能筛选，不因样本有无证据决定是否保留。';A('attr.sales_quantity').unit='件';patch('attr.sales_quantity','只计器具本体件数，原文个按同一器具计件；箱/包为外层包装，不能当器具件数。');
 }
 const review=(await read(join(dir,'codex-change-recheck.json'))).value,rs=reasons[c.name]??[];if(rs.length!==review.findings.length)throw Error('disposition coverage '+c.name);
 const dispositions=review.findings.map((x:any,i:number)=>({...x,codexDecision:rs[i]}));
 const errors=checkCard(card,c.id,d.sources);if(errors.length)throw Error(c.name+':'+errors.join(';'));
 if(c.name==='洗脸巾')for(const x of d.localReferenceDecisions)if(x.sourceId.endsWith('-4194')){x.action='不采纳';x.targetAttributeIds=[];x.reason='是否套装与同质多包销售不是同一含义，不能以销售总包数作为该参考字段的采纳目标。本卡未建独立异质套装字段；混合规格先按组件待确认，后续发现真实需求再评审。';}
 const finalFieldChanges=['attributes','bindings','rules','provenance'].flatMap(group=>card[group].flatMap((item:any)=>{const key=group==='attributes'?'id':'attributeId',old=beforeFinal[group].find((x:any)=>x[key]===item[key]);return hash(old??null)===hash(item)?[]:[{group,attributeId:item[key],before:old??null,after:item}];}));
 const result={...d,finalFieldChanges,card,cardHash:hash(card),postReview:review,postReviewDispositions:dispositions,finalChanges:notes,programErrors:errors,validationLimitations:card.unresolved,finalizedAt:new Date().toISOString()};await save(join(dir,'final.json'),result);all.push(result);
}
registry(all.map(x=>x.card));await save(join(rev,'final-cards.json'),all);console.log(JSON.stringify({categories:all.length,bindings:all.reduce((n,x)=>n+x.card.attributes.length,0),errors:all.flatMap(x=>x.programErrors??[])}));
