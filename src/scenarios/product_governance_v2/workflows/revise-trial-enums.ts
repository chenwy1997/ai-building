/** Evidence-backed, scoped enum revision. No provider calls; retain original model outputs. */
import {join,resolve} from 'node:path';
import {read,save,exists,hash,now} from '../runtime/store.ts';
import {checkCard} from '../domain/validate.ts';
const rev=resolve(process.argv[2]!),run=join(rev,'small-trial-five');
const backup=join(run,'before-enum-cards.json'),reportBackup=join(run,'before-enum-report.json');
if(!await exists(backup))await save(backup,await read(join(rev,'final-cards.json')));
if(!await exists(reportBackup))await save(reportBackup,await read(join(run,'report.json')));
const cards=await read(backup),report=await read(reportBackup);
const specs=[
 ['一次性日杂','usage.scene',['商务办公','蒸制垫用','煲汤炖煮'],'蒸笼纸明示的垫用功能规范为蒸制垫用；不把品类名当场景。'],
 ['一次性日杂','category.form',['蒸笼纸','煲汤吸油纸'],'这两项按当前挂载先用于试填；枚举有证不等于归属已确认，与餐厨类的承接边界仍待运营确认。'],
 ['一次性日杂','pack.unit',['张'],'张用于蒸笼纸、吸油纸等片状单件；只计单件总数量，包/箱仍为包装层级。'],
 ['手帕纸','paper.package_form',['条装'],'30包×3条明示条为多包外层包装层级，规范为条装；不由单独销售单位“条”推断袋装、盒装或单包数量。'],
 ['枕巾','attr.main_material',['竹炭纤维','棉'],'棉只表示明示棉材质但纯度未注明，不等同纯棉；竹炭纤维不得合并成竹纤维。'],
 ['枕巾','attr.color',['军绿色','火焰蓝','红色'],'红/蓝规范为红色/蓝色；明确多色按中文分号分别匹配。军绿色、火焰蓝保留商品明示色名，不由系列名猜颜色。'],
 ['洗脸巾','cat.pack_form',['软包装'],'同品京东包装形式明示软包装可直接采用，不强制等同袋装；单包包装与外层提/箱须分别记录，不由“包”这一数量单位推断容器。'],
 ['湿纸巾','fragrance',['有香型'],'有香型仅表示来源明确有香但未注明具体香型；不是无资料时的默认值，不猜柠檬等具体香味。'],
 ['纸巾盒','style',['简约'],'简约不自动扩写为现代简约；与创意等非互斥、明示风格可多值并存。'],
] as const;
const corrections:any={},changes:any[]=[];
for(const [category,aid,add,policy]of specs){
 const d=cards.find((d:any)=>d.category.name===category),a=d.card.attributes.find((a:any)=>a.id===aid),rule=d.card.rules.find((r:any)=>r.attributeId===aid);
 const rows=report.sheets.find((s:any)=>s.name===category).rows.filter((r:any)=>r[3]===aid&&r[13]==='枚举外候选');
 if(!rows.length)throw Error('missing trial evidence '+category+' '+aid);
 const before=structuredClone(a),evs:any[]=[];
 for(const row of rows){
  const sourceId='trial-enum-'+row[5]+'-'+aid,text=row[15];
  const source={id:sourceId,kind:'product_sample',platform:row[16],locator:row[24],text,hash:hash(text),retrievedAt:now(),mode:'existing_trial_evidence_no_new_fetch'};
  d.sources.push(source);
  d.card.provenance.find((p:any)=>p.attributeId===aid).claims.push({sourceId,relation:'修订',claim:policy,quote:text});
  evs.push({productId:row[5],title:row[6],originalValue:row[12],quote:text,source:row[16],locator:row[24]});
  const normalized=aid==='usage.scene'&&row[12]==='蒸制垫纸'?'蒸制垫用':
   category==='手帕纸'?'条装':category==='枕巾'&&aid==='attr.color'&&row[12]==='红；蓝'?'红色；蓝色':row[12];
  corrections[row[5]]??={};
  corrections[row[5]][aid]={value:normalized,explanation:`${policy} 本轮按真实商品证据修订枚举，现已纳入。原始表述：${row[12]}。`};
 }
 a.enumValues=[...new Set([...a.enumValues,...add])];
 if(category==='枕巾'&&aid==='attr.color')a.enumPolicy=a.enumPolicy.replace('单选，只取颜色本义；多色明确并列表述时以中文分号分隔逐项校验','通常单色；仅取颜色本义，明确多色时允许多值，以中文分号分隔逐项校验');
 if(aid==='category.form')a.enumPolicy=a.enumPolicy.replace('纸杯/纸盘/纸碗为样本已证','纸杯/纸盘/纸碗为当前挂载样本已见，归属仍待运营确认');
 a.enumPolicy+=` 本轮修订：${policy} 证据商品：${[...new Set(rows.map((r:any)=>r[5]))].map((id:any)=>id.slice(0,8)).join('、')}；原文及来源见对应商品明细。`;
 rule.directRule+=' '+policy;
 if(aid==='pack.unit')a.definition+=' 张用于蒸笼纸、吸油纸等片状单件。';
 if(category==='湿纸巾')a.definition='描述湿巾液体或商品明示的香型；明确有香但未注明具体香味可填有香型；仅记录明示值。';
 if(category==='洗脸巾'){
  a.definition='商品明示的单包容器或销售外层包装形态；软包装不自动等于袋装，提/箱表示外层包装，多值须区分层级。';
  a.describes='洗脸巾单包及销售外层包装形态';
  d.card.bindings.find((b:any)=>b.attributeId===aid).scope='同SKU商品明示包装；区分单包形态与外层提/箱，未知层级不推断';
 }
 if(category==='手帕纸')a.definition+=' 条装表示明示多包组合的外层条状销售包装。';
 changes.push({category,categoryId:d.category.id,attributeId:aid,added:[...add],before,after:structuredClone(a),policy,evidence:evs});
}
for(const d of cards){
 const own=changes.filter((x:any)=>x.categoryId===d.category.id);
 if(!own.length)continue;
 const errors=checkCard(d.card,d.category.id,d.sources);
 if(errors.length)throw Error(d.category.name+JSON.stringify(errors));
 (d.history??=[]).push({stage:'codex_evidence_enum_revision',previousCardHash:d.cardHash,changes:own.map(x=>({attributeId:x.attributeId,added:x.added,reason:x.policy})),reviewedAt:now()});
 d.cardHash=hash(d.card);
 d.enumRevision={version:'trial-enum-r1',reviewer:'Codex',scope:'仅枚举及关联口径；未重新调用DeepSeek，待运营审核',auditFile:join(run,'enum-revision.json')};
}
await save(join(run,'enum-value-corrections.json'),corrections);
await save(join(run,'enum-revision.json'),{version:'trial-enum-r1',changes,categories:new Set(changes.map(c=>c.category)).size,bindings:changes.length,added:changes.reduce((n,c)=>n+c.added.length,0),trialRows:changes.reduce((n,c)=>n+c.evidence.length,0)});
await save(join(rev,'final-cards.json'),cards);
console.log(JSON.stringify({bindings:changes.length,added:changes.reduce((n,c)=>n+c.added.length,0)}));
